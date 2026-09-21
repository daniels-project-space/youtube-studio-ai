import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { directory, worktree } from '../studio-render-build.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'studio-build-isolation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('creates separate model and receipt directories', (t) => {
  const root = fixture(t);
  directory(join(root, 'models'));
  directory(join(root, 'state', 'receipts'));
  assert.ok(existsSync(join(root, 'models')));
  assert.ok(existsSync(join(root, 'state', 'receipts')));
});

test('rejects redirected ancestors before creating files in another project', (t) => {
  const root = fixture(t);
  const other = join(root, 'other-project');
  mkdirSync(other);
  symlinkSync(other, join(root, 'redirected'));
  assert.throws(() => directory(join(root, 'redirected', 'models')), /symlinks/);
  assert.equal(existsSync(join(other, 'models')), false);
});

test('rejects regular files used as directory roots', (t) => {
  const root = fixture(t);
  const file = join(root, 'file');
  writeFileSync(file, 'not a directory');
  assert.throws(() => directory(file), /symlinks/);
});

test('pins actual detached worktrees and refuses dirty or changed source', (t) => {
  const root = fixture(t);
  const repo = join(root, 'source');
  mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  git('init');
  git('config', 'user.email', 'build-test@example.invalid');
  git('config', 'user.name', 'Build test');
  writeFileSync(join(repo, 'worker.py'), 'print("first")\n');
  git('add', '.');
  git('commit', '-m', 'first');
  const revision = git('rev-parse', 'HEAD');
  const target = join(root, 'studio-worktree');
  worktree(repo, revision, target);
  worktree(repo, revision, target);
  writeFileSync(join(target, 'worker.py'), 'print("changed")\n');
  assert.throws(() => worktree(repo, revision, target), /clean/);
  assert.equal(git('status', '--porcelain'), '');
  assert.throws(() => worktree(repo, '0'.repeat(40), target), /recorded revision/);
});

test('refuses a redirected worktree before invoking Git there', (t) => {
  const root = fixture(t);
  const other = join(root, 'other-project');
  mkdirSync(other);
  const target = join(root, 'redirected');
  symlinkSync(other, target);
  assert.throws(() => worktree('/does-not-exist', '0'.repeat(40), target), /redirected/);
  assert.equal(existsSync(join(other, '.git')), false);
});
