#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const studio = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = '/home/ubuntu/salad-media-infra';
const sourceRevision = '42faf114e1088f8ff10369f02095f9ec82493b4d';
const root = '/var/lib/youtube-studio-render';
const project = 'youtube-studio-ai';
const run = (command, args, options = {}) => execFileSync(command, args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options,
});

function directory(path) {
  // Refuse redirected roots: no build may write into another project's cache.
  if (!existsSync(path)) {
    directory(dirname(path));
    mkdirSync(path, { mode: 0o700 });
  }
  if (lstatSync(path).isSymbolicLink() || realpathSync(path) !== path) {
    throw new Error(`Project path must not contain symlinks: ${path}`);
  }
}

function worktree(repository, revision, target) {
  if (!existsSync(target)) run('git', ['-C', repository, 'worktree', 'add', '--detach', target, revision]);
  if (run('git', ['-C', target, 'rev-parse', 'HEAD']).trim() !== revision ||
      run('git', ['-C', target, 'status', '--porcelain']).trim()) {
    throw new Error(`Build worktree must be clean at its recorded revision: ${target}`);
  }
  if (realpathSync(target) !== target) throw new Error('Build worktree must not be redirected');
}

function main() {
  if (!['prepare', 'build'].includes(process.argv[2]) || process.argv.length !== 3) {
    throw new Error('usage: node scripts/studio-render-build.mjs prepare|build');
  }
  if (run('git', ['-C', studio, 'status', '--porcelain']).trim()) {
    throw new Error('Commit Studio source before creating an immutable build');
  }
  const revision = run('git', ['-C', studio, 'rev-parse', 'HEAD']).trim();
  directory(root);
  const ownerFile = join(root, 'owner.json');
  if (!existsSync(ownerFile)) writeFileSync(ownerFile, JSON.stringify({ project }) + '\n', { flag: 'wx', mode: 0o600 });
  if (JSON.parse(readFileSync(ownerFile, 'utf8')).project !== project) throw new Error('Render root belongs to another project');
  for (const suffix of ['worktrees', 'builds', 'volumes/h3/models', 'volumes/h3/state']) directory(join(root, suffix));
  const studioTree = join(root, 'worktrees', `studio-${revision}`);
  const runtimeTree = join(root, 'worktrees', `h3-${sourceRevision}`);
  worktree(studio, revision, studioTree);
  worktree(source, sourceRevision, runtimeTree);
  const build = join(root, 'builds', revision);
  directory(build);
  const context = mkdtempSync(join(build, 'context-'));
  // Only these tracked worker paths enter Docker, never project environments,
  // shared vendor trees, graph output, model weights, inputs, or receipts.
  const paths = ['common', 'routes/h3', 'manifests/minimax-h3-turbo8-5090.source.json', 'profiles/minimax-h3-5090.json'];
  for (const path of paths) {
    directory(resolve(context, path, '..'));
    cpSync(join(runtimeTree, path), join(context, path), { recursive: true });
  }
  cpSync(join(studioTree, 'infra/studio-render/Dockerfile'), join(context, 'Dockerfile'));
  const image = `youtube-studio/h3:${revision}`;
  const receipt = {
    schema: 'youtube-studio-render-build/v1', project, revision, sourceRevision,
    studioTree, runtimeTree, context, image,
    volumes: { models: join(root, 'volumes/h3/models'), state: join(root, 'volumes/h3/state') },
    status: 'prepared', gpuQualified: false, modelCacheVerified: false,
  };
  const receiptFile = `${context}.json`;
  writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  if (process.argv[2] === 'build') {
    run('docker', ['build', '--progress=plain', '--build-arg', `SOURCE_REVISION=${sourceRevision}`,
      '--build-arg', `STUDIO_REVISION=${revision}`, '--tag', image, context], {
      env: { ...process.env, DOCKER_API_VERSION: '1.44' }, stdio: 'inherit',
    });
    const details = JSON.parse(run('docker', ['image', 'inspect', image]))[0];
    if (details.Config.Labels['ai.youtube.render.project'] !== project ||
        details.Config.Labels['org.opencontainers.image.revision'] !== revision) throw new Error('Image ownership mismatch');
    receipt.status = 'built';
    receipt.imageId = details.Id;
    writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  }
  console.log(JSON.stringify(receipt, null, 2));
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
