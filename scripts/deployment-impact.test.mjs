import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManifest } from "./deployment-inputs.mjs";
import { classifyChanges, impactSince } from "./deployment-impact.mjs";

const evidence = () => ({ version: 1, project: "youtube-studio-ai", globals: ["package.json"],
  website: { files: ["src/app/page.tsx", "src/lib/shared.ts", "docs/runtime.json"], uncertain: [] },
  backend: { files: ["convex/runs.ts", "src/lib/shared.ts"], uncertain: [] },
  trigger: { files: ["src/trigger/pipeline.ts", "src/lib/shared.ts"], uncertain: [] } });
for (const [file, expected] of [
  ["docs/operations.md", [false, false, false]],
  [".github/workflows/ci.yml", [false, false, false]],
  ["src/lib/__tests__/x.test.ts", [false, false, false]],
  ["src/trigger/pipeline.ts", [false, false, true]],
  ["src/trigger/new.ts", [false, false, true]],
  ["convex/runs.ts", [false, true, false]],
  ["convex/new.ts", [false, true, false]],
  ["src/app/new/page.tsx", [true, false, false]],
  ["src/lib/shared.ts", [true, true, true]],
  ["docs/runtime.json", [true, false, false]],
  ["package.json", [true, true, true]],
  ["unknown.config", [true, true, true]],
]) test(`classifies ${file}`, () => {
  const m = evidence(), result = classifyChanges([file], m, m);
  assert.deepEqual([result.website, result.backend, result.trigger], expected);
});
test("retains removed dependencies through the previous manifest", () => {
  const before = evidence(), after = evidence();
  after.website.files = [];
  assert.equal(classifyChanges(["docs/runtime.json"], before, after).website, true);
});
test("missing or uncertain manifests build normally", () => {
  const m = evidence();
  assert.equal(classifyChanges([], null, m).website, true);
  m.website.uncertain.push("computed import");
  assert.equal(classifyChanges([], m, m).website, true);
  assert.equal(impactSince(undefined).website, true);
  assert.equal(impactSince("a".repeat(40), { force: true }).website, true);
});

test("real Git witnesses, imports, removals, stale manifests and missing history", () => {
  const root = mkdtempSync(join(tmpdir(), "studio-deployment-policy-"));
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const put = (file, text) => { mkdirSync(join(root, file, ".."), { recursive: true }); writeFileSync(join(root, file), text); };
  const commit = () => { git(["add", "."]); git(["commit", "-qm", "fixture"]); return git(["rev-parse", "HEAD"]); };
  const generate = () => { git(["add", "."]); put("deployment-inputs.json", JSON.stringify(createManifest(root))); };
  const vercel = (base, force = false) => spawnSync("bash", ["vercel-ignore-build.sh"], {
    cwd: root, env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: base, VERCEL_FORCE_BUILD: force ? "1" : "0" }, encoding: "utf8",
  });
  try {
    git(["init", "-q"]); git(["config", "user.email", "fixture@localhost"]); git(["config", "user.name", "fixture"]);
    git(["config", "core.hooksPath", "/dev/null"]);
    put("package.json", '{"private":true}');
    put("tsconfig.json", '{"compilerOptions":{"module":"esnext","moduleResolution":"bundler","target":"esnext"}}');
    put("scripts/deployment-inputs.mjs", readFileSync(new URL("./deployment-inputs.mjs", import.meta.url)));
    put("scripts/deployment-impact.mjs", readFileSync(new URL("./deployment-impact.mjs", import.meta.url)));
    put("vercel-ignore-build.sh", "node scripts/deployment-impact.mjs --vercel-ignore\n");
    put("src/app/page.tsx", 'import { value } from "../lib/shared"; export default () => value;');
    put("src/lib/shared.ts", 'export const value = "hello";');
    put("src/trigger/job.ts", 'export const job = "same";');
    put("convex/runs.ts", 'export const run = 1;');
    put("trigger.config.ts", 'additionalFiles({files:["requirements/**", ".github/runtime.json"]});');
    put("requirements/model.txt", "exact model"); put(".github/runtime.json", "{}");
    generate(); const base = commit();
    const m = createManifest(root);
    assert.ok(m.website.files.includes("src/lib/shared.ts"));
    assert.ok(m.trigger.files.includes("requirements/model.txt"));
    assert.ok(m.trigger.files.includes(".github/runtime.json"));
    assert.equal(impactSince(base, { cwd: root }).website, false);
    put("docs/operations.md", "metadata"); commit();
    assert.equal(impactSince(base, { cwd: root }).website, false);
    assert.equal(vercel(base).status, 0, "actual preinstall command skips verified metadata");
    assert.equal(vercel(base, true).status, 1, "actual command respects force-build");
    assert.equal(vercel("").status, 1, "actual command builds without history");
    put("src/trigger/job.ts", 'export const job = "changed";');
    generate(); commit();
    assert.equal(impactSince(base, { cwd: root }).website, false);
    assert.equal(impactSince(base, { cwd: root }).trigger, true);
    assert.equal(vercel(base).status, 0, "actual command skips worker-only website rebuild");
    put("src/lib/shared.ts", 'export const value = "new";'); commit();
    assert.equal(impactSince(base, { cwd: root }).reason, "unavailable-or-stale-dependency-evidence");
    assert.equal(vercel(base).status, 1, "actual command builds on stale witnesses");
    generate(); commit();
    assert.equal(impactSince(base, { cwd: root }).website, true);
    assert.equal(vercel(base).status, 1, "actual command builds for changed website imports");
    put("src/app/page.tsx", 'export default () => "unused";');
    rmSync(join(root, "src/lib/shared.ts")); generate(); commit();
    assert.equal(impactSince(base, { cwd: root }).website, true);
    assert.equal(impactSince("f".repeat(40), { cwd: root }).website, true);
    put("src/trigger/job.ts", 'export async function run() { for (const pkg of ["node:fs", "node:path"]) await import(pkg); }');
    git(["add", "."]);
    assert.deepEqual(createManifest(root).trigger.uncertain, []);
    put("src/trigger/job.ts", 'export async function run(name) { for (const pkg of ["node:fs"]) { let pkg = name; await import(pkg); } }');
    assert.ok(createManifest(root).trigger.uncertain.length, "shadowed computed module must remain uncertain");
    put("src/trigger/job.ts", 'export async function run(name) { for (let pkg of ["node:fs"]) { pkg = name; await import(pkg); } }');
    assert.ok(createManifest(root).trigger.uncertain.length, "mutable computed module must remain uncertain");
    put("src/trigger/job.ts", 'export async function run(name) { return import(name); }');
    assert.ok(createManifest(root).trigger.uncertain.length);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
