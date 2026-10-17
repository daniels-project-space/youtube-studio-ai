import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, stat, symlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runReadinessProcess } from "./readiness-process.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "studio-readiness-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const execute = (root, code, extra = {}) => runReadinessProcess({ command: process.execPath,
  args: ["-e", code], cwd: root, tempRoot: root, label: "fixture", timeoutMs: 5_000, ...extra });
const missing = async file => { try { await stat(file); return false; } catch (error) { if (error.code === "ENOENT") return true; throw error; } };
async function stopped(pid) {
  try {
    const value = await readFile(`/proc/${pid}/stat`, "utf8");
    return ["Z", "X"].includes(value.slice(value.lastIndexOf(")") + 2).split(" ")[0]);
  } catch (error) { if (error.code === "ENOENT") return true; throw error; }
}

test("owns disposable files and preserves the shared tsx cache", async t => {
  const root = await fixture(t);
  const cache = join(root, `tsx-${process.geteuid?.() ?? "fixture"}`);
  await mkdir(cache); await writeFile(join(cache, "keep"), "compiled cache");
  const before = process.env.TMPDIR;
  const result = await execute(root, `const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
    fs.writeFileSync(path.join(os.tmpdir(),'scratch'),'temporary');
    console.log(JSON.stringify({directory:os.tmpdir(),cache:fs.realpathSync(path.join(os.tmpdir(),'tsx-'+process.geteuid()))}));`);
  assert.equal(result.status, 0); assert.equal(result.cleanupError, undefined);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.cache, cache); assert.ok(await missing(receipt.directory));
  assert.equal(await readFile(join(cache, "keep"), "utf8"), "compiled cache");
  assert.equal(process.env.TMPDIR, before);
});

test("failure status and diagnostics survive cleanup", async t => {
  const root = await fixture(t);
  const result = await execute(root, `console.log(require('node:os').tmpdir());console.error('diagnostic');process.exit(17)`);
  assert.equal(result.status, 17); assert.equal(result.stderr, "diagnostic\n");
  assert.ok(await missing(result.stdout.trim()));
});

test("spawn failures clean only their owned directory", async t => {
  const root = await fixture(t);
  const result = await runReadinessProcess({ command: join(root, "missing-executable"), args: [], cwd: root,
    tempRoot: root, label: "missing", timeoutMs: 1_000 });
  assert.equal(result.spawnError?.code, "ENOENT");
  assert.equal((await readdir(root)).some(name => name.startsWith("studio-readiness-")), false);
});

test("an unavailable temp root reports a failure without rejecting the suite", async t => {
  const root = await fixture(t);
  const result = await execute(join(root, "missing"), "process.exit(0)");
  assert.equal(result.spawnError?.code, "ENOENT"); assert.equal(result.status, null);
});

test("timeout terminates a SIGTERM-resistant process", async t => {
  const root = await fixture(t);
  const result = await execute(root, `console.log(require('node:os').tmpdir());process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`,
    { timeoutMs: 500, graceMs: 50 });
  assert.equal(result.timedOut, true); assert.equal(result.signal, "SIGKILL");
  assert.equal(result.cleanupError, undefined); assert.ok(await missing(result.stdout.trim()));
});

for (const mode of ["timeout", "success"]) test(`${mode} stops grandchildren after the parent exits`, { skip: process.platform !== "linux" }, async t => {
  const root = await fixture(t);
  const source = `const {spawn}=require('node:child_process');
    const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});
    child.stdout.once('data',()=>{console.log(JSON.stringify({pid:child.pid,directory:require('node:os').tmpdir()}));${mode === "success" ? "process.exit(0)" : ""}});
    process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);`;
  const result = await execute(root, source, { timeoutMs: mode === "timeout" ? 1_000 : 5_000, graceMs: 50 });
  const receipt = JSON.parse(result.stdout);
  t.after(() => { try { process.kill(receipt.pid, "SIGKILL"); } catch {} });
  assert.equal(result.timedOut, mode === "timeout");
  assert.equal(result.cleanupError, undefined); assert.equal(await stopped(receipt.pid), true);
  assert.ok(await missing(receipt.directory));
});

test("abort terminates active work without calling it a timeout", async t => {
  const root = await fixture(t), controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300); t.after(() => clearTimeout(timer));
  const result = await execute(root, `console.log(require('node:os').tmpdir());setInterval(()=>{},1000)`,
    { signal: controller.signal, graceMs: 50 });
  assert.equal(result.interrupted, true); assert.equal(result.timedOut, false);
  assert.equal(result.cleanupError, undefined); assert.ok(await missing(result.stdout.trim()));
});

test("an already aborted run never starts a test", async t => {
  const root = await fixture(t), controller = new AbortController(); controller.abort();
  const flag = join(root, "must-not-start");
  const result = await execute(root, `require('node:fs').writeFileSync(${JSON.stringify(flag)},'bad')`, { signal: controller.signal });
  assert.equal(result.interrupted, true); assert.ok(await missing(flag));
  assert.equal((await readdir(root)).some(name => name.startsWith("studio-readiness-")), false);
});

test("cleanup unlinks fixture symlinks without deleting their targets", async t => {
  const root = await fixture(t), outside = join(root, "outside"); await mkdir(outside);
  await writeFile(join(outside, "keep"), "preserved");
  const result = await execute(root, `require('node:fs').symlinkSync(${JSON.stringify(outside)},require('node:path').join(require('node:os').tmpdir(),'external'),'dir')`);
  assert.equal(result.status, 0); assert.equal(result.cleanupError, undefined);
  assert.equal(await readFile(join(outside, "keep"), "utf8"), "preserved");
});

test("the actual installed tsx entrypoint still runs TypeScript as its main file", async t => {
  const root = await fixture(t), file = join(root, "probe.ts");
  await writeFile(file, `import os from 'node:os';const value:number=42;console.log(JSON.stringify({value,directory:os.tmpdir()}));`);
  const result = await runReadinessProcess({ command: join(process.cwd(), "node_modules/.bin/tsx"), args: [file],
    cwd: process.cwd(), tempRoot: root, label: "tsx", timeoutMs: 5_000 });
  assert.equal(result.status, 0, result.stderr); const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.value, 42); assert.ok(await missing(receipt.directory));
});

for (const mode of ["success", "failure", "abort"]) test(`actual readiness runner preserves ${mode} behavior and cleans its files`, async t => {
  const root = await fixture(t), temporary = join(root, "temporary"), ready = join(root, "ready");
  const put = async (file, body) => { const path = join(root, file); await mkdir(join(path, ".."), { recursive: true }); await writeFile(path, body); };
  await mkdir(temporary);
  await put("scripts/run-production-readiness-tests.mjs", await readFile(new URL("../../scripts/run-production-readiness-tests.mjs", import.meta.url)));
  await put("scripts/readiness-test-selection.mjs", await readFile(new URL("../../scripts/readiness-test-selection.mjs", import.meta.url)));
  await put(".github/scripts/readiness-process.mjs", await readFile(new URL("./readiness-process.mjs", import.meta.url)));
  // pnpm's .bin wrapper resolves its real .pnpm runtime beside node_modules;
  // linking just the wrapper would test a broken fixture installation.
  await symlink(join(process.cwd(), "node_modules"), join(root, "node_modules"), "dir");
  const script = mode === "abort"
    ? `require('node:fs').appendFileSync(process.env.FIXTURE_READY,process.pid+'\\n');setInterval(()=>{},1000);`
    : `const os=require('node:os');require('node:fs').writeFileSync(require('node:path').join(os.tmpdir(),'scratch'),'fixture');console.log(JSON.stringify({directory:os.tmpdir()}));`;
  for (const file of ["src/a.test.ts", "src/b.test.ts", "scripts/assembly-parity.ts", "scripts/quizyear-pipeline-dryrun.ts"]) {
    await put(file, script + (mode === "failure" && file === "src/a.test.ts" ? "process.exit(19);" : ""));
  }
  const child = spawn(process.execPath, [join(root, "scripts/run-production-readiness-tests.mjs")], {
    cwd: root, env: { ...process.env, TMPDIR: temporary, FIXTURE_READY: ready }, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", value => { stdout += value; }); child.stderr.on("data", value => { stderr += value; });
  const completion = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", status => resolve(status)); });
  const kill = setTimeout(() => child.kill("SIGKILL"), 15_000);
  t.after(async () => {
    clearTimeout(kill); child.kill("SIGKILL");
    try { for (const pid of (await readFile(ready, "utf8")).trim().split("\n")) { try { process.kill(Number(pid), "SIGKILL"); } catch {} } } catch {}
  });
  if (mode === "abort") {
    const deadline = Date.now() + 10_000;
    while (await missing(ready)) { assert.ok(Date.now() < deadline, "fixture must start"); await delay(25); }
    child.kill("SIGTERM");
  }
  const status = await completion;
  assert.equal(status, mode === "success" ? 0 : mode === "failure" ? 1 : 143, stdout + stderr);
  assert.match(stdout, /Running 4 direct readiness tests/);
  if (mode === "success") assert.match(stdout, /All 4 direct production-readiness tests passed/);
  if (mode === "failure") assert.match(stderr, /1 of 4 direct production-readiness tests FAILED/);
  if (mode === "abort") {
    assert.match(stderr, /COMPLETE PRODUCTION READINESS NOT VERIFIED/);
    for (const pid of (await readFile(ready, "utf8")).trim().split("\n")) assert.equal(await stopped(Number(pid)), true);
  }
  assert.equal((await readdir(temporary)).some(name => name.startsWith("studio-readiness-")), false);
});
