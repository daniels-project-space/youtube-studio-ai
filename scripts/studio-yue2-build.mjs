#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { directory, worktree } from './studio-render-build.mjs';

const studio = resolve(fileURLToPath(new URL('..', import.meta.url)));
const runtime = '/home/ubuntu/youtube-studio-music-runtime';
const runtimeRevision = '7a3eeaec826be487f05b68b54e0f618b98467111';
const root = '/var/lib/youtube-studio-render';
const project = 'youtube-studio-ai';
const run = (command, args, options = {}) => execFileSync(command, args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options,
});
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });

export function prepareYuE2Build(paths) {
  if (run('git', ['-C', paths.studio, 'status', '--porcelain']).trim()) {
    throw new Error('Commit Studio source before creating an immutable build');
  }
  const studioRevision = run('git', ['-C', paths.studio, 'rev-parse', 'HEAD']).trim();
  directory(paths.root);
  const owner = join(paths.root, 'owner.json');
  if (!existsSync(owner)) writeFileSync(owner, `${JSON.stringify({ project })}\n`, { flag: 'wx', mode: 0o600 });
  if (!lstatSync(owner).isFile() || lstatSync(owner).isSymbolicLink() || json(owner).project !== project) {
    throw new Error('Render root belongs to another project or has redirected ownership');
  }
  for (const suffix of ['worktrees', 'builds', 'volumes/yue2/models', 'volumes/yue2/state']) directory(join(paths.root, suffix));
  const studioTree = join(paths.root, 'worktrees', `studio-${studioRevision}`);
  const runtimeTree = join(paths.root, 'worktrees', `yue2-${paths.runtimeRevision}`);
  worktree(paths.studio, studioRevision, studioTree);
  worktree(paths.runtime, paths.runtimeRevision, runtimeTree);
  const build = join(paths.root, 'builds', `yue2-${paths.runtimeRevision}`);
  directory(build);
  const context = mkdtempSync(join(build, 'context-'));
  const required = ['Dockerfile', '.dockerignore', 'pyproject.toml', 'MANIFEST.in',
    'requirements-inference.lock', 'deploy/stage_cache.py', 'src/music_runtime/manifest.json',
    'src/music_runtime/UPSTREAM_ABC_LICENSE.txt', 'src/music_runtime/UPSTREAM_ABC_NOTICE.txt'];
  const tracked = run('git', ['-C', runtimeTree, 'ls-files', '-z']).split('\0').filter(Boolean);
  for (const path of required) if (!tracked.includes(path)) throw new Error(`Missing runtime build input: ${path}`);
  // Copy only tracked deployment inputs, never ignored credentials or job data.
  for (const path of tracked.filter((path) => required.includes(path) || /^src\/music_runtime\/[A-Za-z0-9_]+\.py$/.test(path))) {
    const input = join(runtimeTree, path);
    if (!lstatSync(input).isFile() || lstatSync(input).isSymbolicLink()) throw new Error('Runtime build inputs must be regular files');
    directory(dirname(join(context, path)));
    copyFileSync(input, join(context, path));
  }
  const receipt = {
    schema: 'youtube-studio-yue2-build/v1', project, studioRevision,
    runtimeRevision: paths.runtimeRevision, studioTree, runtimeTree, context,
    image: `youtube-studio/yue2:${paths.runtimeRevision}`,
    volumes: { models: join(paths.root, 'volumes/yue2/models'), state: join(paths.root, 'volumes/yue2/state') },
    status: 'prepared', gpuQualified: false, modelCacheVerified: false,
  };
  const receiptFile = `${context}.json`;
  save(receiptFile, receipt);
  return { receipt, receiptFile };
}

export function assertYuE2Image(details, revision) {
  if (!/^sha256:[a-f0-9]{64}$/.test(details?.Id) ||
      details.Config?.Labels?.['ai.youtube.render.project'] !== project ||
      details.Config?.Labels?.['ai.youtube.render.lane'] !== 'yue2-rtx3090' ||
      details.Config?.Labels?.['org.opencontainers.image.revision'] !== revision) {
    throw new Error('YuE2 image ownership or revision mismatch');
  }
}

export function assertYuE2Cache(evidence, manifest) {
  assert.equal(evidence.schema, 'youtube-studio-yue2-cache/v1');
  assert.equal(evidence.offline_verified, true);
  assert.equal(evidence.gpu_qualified, false);
  for (const kind of ['model', 'vae']) {
    const pin = manifest[kind];
    const snapshot = evidence.snapshots[kind];
    assert.equal(snapshot.repository, pin.repository);
    assert.equal(snapshot.revision, pin.revision);
    assert.deepEqual(Object.keys(snapshot.files).sort(), Object.keys(pin.files_sha256).sort());
    for (const [name, hash] of Object.entries(pin.files_sha256)) {
      assert.equal(snapshot.files[name].sha256, hash);
      assert.ok(Number.isSafeInteger(snapshot.files[name].bytes) && snapshot.files[name].bytes > 0);
    }
  }
}

function main() {
  const mode = process.argv[2];
  if (!['prepare', 'build', 'build-and-verify-cache'].includes(mode) || process.argv.length !== 3) {
    throw new Error('usage: node scripts/studio-yue2-build.mjs prepare|build|build-and-verify-cache');
  }
  const { receipt, receiptFile } = prepareYuE2Build({ studio, runtime, runtimeRevision, root });
  if (mode !== 'prepare') {
    run('docker', ['build', '--progress=plain', '--build-arg', `SOURCE_REVISION=${runtimeRevision}`,
      '--tag', receipt.image, receipt.context], {
      env: { ...process.env, DOCKER_API_VERSION: '1.44' }, stdio: 'inherit',
    });
    const details = JSON.parse(run('docker', ['image', 'inspect', receipt.image]))[0];
    assertYuE2Image(details, runtimeRevision);
    const sandbox = ['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m'];
    const manifest = json(join(receipt.context, 'src/music_runtime/manifest.json'));
    const actualManifest = JSON.parse(run('docker', [...sandbox, details.Id, 'manifest']));
    assert.deepEqual(actualManifest, manifest, 'Built runtime manifest differs from the pinned source');
    receipt.imageId = details.Id;
    receipt.status = 'built';
    receipt.manifestVerified = true;
    save(receiptFile, receipt);
    if (mode === 'build-and-verify-cache') {
      const evidence = JSON.parse(run('docker', [...sandbox,
        '--mount', `type=bind,src=${receipt.volumes.models},dst=/mnt/yue2-hf-cache,readonly`,
        '--entrypoint', 'python', details.Id, '/opt/youtube-studio/stage_cache.py',
        '--cache-dir', '/mnt/yue2-hf-cache', '--offline']));
      assertYuE2Cache(evidence, manifest);
      receipt.cacheVerificationFile = `${receipt.context}.cache.json`;
      save(receipt.cacheVerificationFile, evidence);
      receipt.modelCacheVerified = true;
      save(receiptFile, receipt);
    }
  }
  console.log(JSON.stringify(receipt, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
