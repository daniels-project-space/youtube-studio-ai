import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const yaml = require(require.resolve("js-yaml", { paths: [require.resolve("eslint")] }));
const ignore = require(require.resolve("ignore", { paths: [require.resolve("eslint")] }));
const root = process.cwd();
const workflow = yaml.load(readFileSync(".github/workflows/ci.yml", "utf8"));
const job = workflow.jobs["deploy-cloud-runtimes"];
const step = job.steps.find(step => step.name === "Deploy Trigger production tasks");
assert.equal(step.if, "steps.release_policy.outputs.deploy == 'true'");
assert.equal(step.shell, "bash");
assert.ok(job.steps.findIndex(s => s.name === "Deploy canonical Convex runtime") < job.steps.indexOf(step));
assert.ok(workflow.jobs.typecheck.steps.some(s => s.run?.includes("run test:production-readiness")));

const original = readFileSync(".gitignore");
const fixture = mkdtempSync(join(tmpdir(), "studio-trigger-context-"));
try {
  const bin = join(fixture, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "npm"), `#!/bin/bash
set -euo pipefail
cp .gitignore observed-ignore
printf '%s\\n' "$@" > observed-arguments
exit "$FIXTURE_DEPLOY_STATUS"
`, { mode: 0o755 });
  for (const status of [0, 42]) {
    writeFileSync(join(fixture, ".gitignore"), original);
    const result = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", step.run], {
      cwd: fixture, encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE_DEPLOY_STATUS: String(status) },
    });
    assert.equal(result.status, status, result.stderr);
    assert.deepEqual(readFileSync(join(fixture, ".gitignore")), original, "restore exact ignore bytes on success and failure");
    assert.equal(readFileSync(join(fixture, "observed-arguments"), "utf8"), "run\ntrigger:deploy\n--\n--skip-sync-env-vars\n");
    const before = ignore().add(original.toString());
    const after = ignore().add(readFileSync(join(fixture, "observed-ignore"), "utf8"));
    assert.equal(before.ignores("test-fixtures/comic-opening-reveal/baseline.mp4"), false,
      "known-bad baseline must reproduce retained test media entering native context");
    assert.equal(after.ignores("test-fixtures/comic-opening-reveal/baseline.mp4"), true);
    for (const path of ["trigger.config.ts", "package-lock.json", "pnpm-lock.yaml", "src/trigger/pipeline.ts",
      "src/remotion/DocuMotion.tsx", "src/assets/fonts/comic.otf", "public/fonts/documotion/font.woff2",
      "public/golden/lofi/meadow.mp4", "requirements/qa-narration-proof.txt", "scripts/narration_transcript_proof.py",
      "src/lib/__tests__/triggerBuildContext.test.mjs", "nested/test-fixtures/reference.wav", "test-fixtures-lookalike/image.png"]) {
      assert.equal(after.ignores(path), before.ignores(path), `must preserve runtime and unrelated path: ${path}`);
    }
    for (const path of [".env.local", ".git/config", "graphify-out/graph.json", "node_modules/a/index.js"]) {
      // .git is excluded by the CLI's defaults rather than this project's file.
      assert.equal(after.ignores(path), before.ignores(path), `must not weaken existing policy: ${path}`);
    }
  }
  assert.deepEqual(readFileSync(resolve(root, ".gitignore")), original);
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
console.log("Trigger native context: actual CI shell excludes only retained fixtures, preserves runtime inputs, restores policy and failure status");
