import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { assertYuE2Cache, assertYuE2Image, prepareYuE2Build } from '../studio-yue2-build.mjs';

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'studio-yue2-build-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  function repository(name, files) {
    const repo = join(base, name);
    mkdirSync(repo);
    git(repo, 'init');
    git(repo, 'config', 'user.email', 'build-test@example.invalid');
    git(repo, 'config', 'user.name', 'Build test');
    for (const [name, content] of Object.entries(files)) {
      const path = join(repo, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'fixture');
    return repo;
  }
  const studio = repository('studio', { 'source.txt': 'studio' });
  const runtime = repository('runtime', Object.fromEntries([
    'Dockerfile', '.dockerignore', 'pyproject.toml', 'MANIFEST.in', 'requirements-inference.lock',
    'deploy/stage_cache.py', 'src/music_runtime/manifest.json', 'src/music_runtime/worker.py',
    'var/job.json', 'graphify-out/graph.json', '.env', 'deploy/private.txt',
  ].map((file) => [file, 'fixture'])));
  return { base, git, paths: { studio, runtime, runtimeRevision: git(runtime, 'rev-parse', 'HEAD'), root: join(base, 'render') } };
}

test('prepares pinned isolated worktrees and excludes even tracked private/runtime data', (t) => {
  const { paths, git } = fixture(t);
  const { receipt, receiptFile } = prepareYuE2Build(paths);
  assert.equal(git(receipt.runtimeTree, 'rev-parse', 'HEAD'), paths.runtimeRevision);
  assert.equal(git(receipt.studioTree, 'rev-parse', 'HEAD'), receipt.studioRevision);
  for (const file of ['Dockerfile', 'src/music_runtime/worker.py', 'deploy/stage_cache.py']) {
    assert.equal(readFileSync(join(receipt.context, file), 'utf8'), 'fixture');
  }
  for (const file of ['.env', 'var', 'graphify-out', 'deploy/private.txt', '.git']) {
    assert.equal(existsSync(join(receipt.context, file)), false);
  }
  assert.equal(receipt.modelCacheVerified, false);
  assert.equal(receipt.gpuQualified, false);
  assert.equal(receipt.status, 'prepared');
  assert.deepEqual(JSON.parse(readFileSync(receiptFile, 'utf8')), receipt);
  assert.ok(existsSync(receipt.volumes.models));
  assert.notEqual(receipt.volumes.models, receipt.volumes.state);
  assert.notEqual(prepareYuE2Build(paths).receipt.context, receipt.context);
});

test('refuses dirty Studio source before allocating build directories', (t) => {
  const { paths } = fixture(t);
  writeFileSync(join(paths.studio, 'source.txt'), 'dirty');
  assert.throws(() => prepareYuE2Build(paths), /Commit Studio/);
  assert.equal(existsSync(paths.root), false);
});

test('does not follow a foreign owner marker or redirected model volume', (t) => {
  const { paths, base } = fixture(t);
  mkdirSync(paths.root);
  writeFileSync(join(paths.root, 'owner.json'), JSON.stringify({ project: 'other-project' }));
  assert.throws(() => prepareYuE2Build(paths), /another project/);
  rmSync(join(paths.root, 'owner.json'));
  const foreignOwner = join(base, 'foreign-owner.json');
  writeFileSync(foreignOwner, JSON.stringify({ project: 'youtube-studio-ai' }));
  symlinkSync(foreignOwner, join(paths.root, 'owner.json'));
  assert.throws(() => prepareYuE2Build(paths), /redirected ownership/);
  rmSync(join(paths.root, 'owner.json'));
  mkdirSync(join(paths.root, 'volumes/yue2'), { recursive: true });
  symlinkSync(base, join(paths.root, 'volumes/yue2/models'));
  assert.throws(() => prepareYuE2Build(paths), /symlinks/);
  assert.equal(existsSync(join(paths.root, 'builds', `yue2-${paths.runtimeRevision}`)), false);
});

test('image admission binds project, lane and exact source revision', () => {
  const revision = 'a'.repeat(40);
  const image = { Id: `sha256:${'b'.repeat(64)}`, Config: { Labels: {
    'ai.youtube.render.project': 'youtube-studio-ai', 'ai.youtube.render.lane': 'yue2-rtx3090',
    'org.opencontainers.image.revision': revision,
  } } };
  assertYuE2Image(image, revision);
  for (const key of Object.keys(image.Config.Labels)) {
    const bad = structuredClone(image);
    bad.Config.Labels[key] = 'other';
    assert.throws(() => assertYuE2Image(bad, revision), /mismatch/);
  }
  assert.throws(() => assertYuE2Image({ ...image, Id: 'tag:latest' }, revision), /mismatch/);
});

test('cache admission requires exact hashes and offline verification without qualification', () => {
  const pin = { repository: 'test/model', revision: 'a'.repeat(40), files_sha256: { 'model.safetensors': 'b'.repeat(64) } };
  const manifest = { model: pin, vae: pin };
  const snapshot = { repository: pin.repository, revision: pin.revision,
    files: { 'model.safetensors': { sha256: 'b'.repeat(64), bytes: 100 } } };
  const evidence = { schema: 'youtube-studio-yue2-cache/v1', offline_verified: true, gpu_qualified: false,
    snapshots: { model: snapshot, vae: snapshot } };
  assertYuE2Cache(evidence, manifest);
  for (const change of [
    (v) => { v.offline_verified = false; },
    (v) => { v.gpu_qualified = true; },
    (v) => { v.snapshots.model.revision = 'other'; },
    (v) => { v.snapshots.vae.files['model.safetensors'].sha256 = '0'.repeat(64); },
    (v) => { v.snapshots.model.files['model.safetensors'].bytes = 0; },
    (v) => { delete v.snapshots.vae.files['model.safetensors']; },
  ]) {
    const bad = structuredClone(evidence);
    change(bad);
    assert.throws(() => assertYuE2Cache(bad, manifest));
  }
});
