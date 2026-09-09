import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Execute the actual workflow step, not a duplicate provisioning implementation.
const require = createRequire(import.meta.url);
const yaml = require(require.resolve("js-yaml", { paths: [require.resolve("eslint")] }));
const workflow = yaml.load(readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8"));
const job = workflow.jobs.typecheck;
const step = job.steps.find((candidate) => candidate.name === "Install declared renderer system dependency");
assert.equal(step.shell, "bash");
assert.ok(!step.if && !step["continue-on-error"], "renderer provisioning must remain mandatory");
assert.match(step.run, /ubuntu_sources=\/etc\/apt\/sources\.list\.d\/ubuntu\.sources/);
assert.doesNotMatch(step.run, /allow-unauthenticated|AllowInsecure|AllowWeak|trusted=yes|Check-Valid-Until|fix-missing/);
assert.equal(job.steps.find((candidate) => candidate.name === "Production-readiness tests").run,
  "${{ steps.pm.outputs.pm }} run test:production-readiness");

const root = mkdtempSync(join(tmpdir(), "ysa-renderer apt-"));
try {
  const bin = join(root, "bin");
  mkdirSync(bin);
  // PATH contains only these fakes: no privileged commands, package installs or
  // network access can escape this test. The fake sudo records every APT argv.
  const fake = `#!${process.execPath}
import { appendFileSync } from "node:fs";
import { basename } from "node:path";
const command = basename(process.argv[1]);
const args = process.argv.slice(2);
appendFileSync(process.env.RENDERER_TEST_LOG, JSON.stringify([command, ...args]) + "\\n");
if (command === "sudo") {
  if (args[0] !== "apt-get") process.exit(90);
  const operation = args.includes("update") ? "update" : "install";
  if (process.env.RENDERER_TEST_FAIL === operation) process.exit(100);
} else if (process.env.RENDERER_TEST_FAIL === command) {
  process.exit(1);
}
`;
  for (const command of ["sudo", "ffmpeg", "ffprobe"]) {
    writeFileSync(join(bin, command), fake, { mode: 0o755 });
  }

  function runCase(name, { source = "Types: deb\n", fail = "" } = {}) {
    const directory = join(root, name);
    mkdirSync(directory);
    const sources = join(directory, "ubuntu.sources");
    const log = join(directory, "commands.jsonl");
    if (source !== null) writeFileSync(sources, source);
    writeFileSync(log, "");
    // Substitute only the external filesystem fixture, leaving the shell
    // control flow and every command untouched. Spaces exercise array quoting.
    const script = step.run.replace("ubuntu_sources=/etc/apt/sources.list.d/ubuntu.sources",
      `ubuntu_sources='${sources}'`);
    const result = spawnSync("/bin/bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script], {
      encoding: "utf8",
      env: { PATH: bin, RENDERER_TEST_LOG: log, RENDERER_TEST_FAIL: fail },
    });
    assert.ifError(result.error);
    const commands = readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
    const aptPrefix = ["sudo", "apt-get", "-o", `Dir::Etc::sourcelist=${sources}`, "-o", "Dir::Etc::sourceparts=-"];
    const expected = [
      [...aptPrefix, "update", "--error-on=any", "--no-list-cleanup"],
      [...aptPrefix, "install", "--yes", "--no-install-recommends", "ffmpeg"],
      ["ffmpeg", "-version"],
      ["ffprobe", "-version"],
    ];
    return { result, commands, expected };
  }

  const installed = runCase("installed");
  assert.equal(installed.result.status, 0, installed.result.stderr);
  assert.deepEqual(installed.commands, installed.expected, "both APT commands must exclude unrelated sources and verify both binaries");

  for (const [name, source] of [["missing-source", null], ["empty-source", ""]]) {
    const { result, commands } = runCase(name, { source });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Expected Ubuntu APT sources/);
    assert.deepEqual(commands, [], "invalid source availability must fail closed before APT");
  }

  for (const [fail, commandCount, status] of [["update", 1, 100], ["install", 2, 100], ["ffmpeg", 3, 1], ["ffprobe", 4, 1]]) {
    const { result, commands, expected } = runCase(`failed-${fail}`, { fail });
    assert.equal(result.status, status, `${fail} failure must stop the quality gate`);
    assert.deepEqual(commands, expected.slice(0, commandCount), `${fail} failure must not be swallowed`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log("CI renderer dependency: scoped APT argv, missing/empty sources, update/install failures and both executable checks passed");
