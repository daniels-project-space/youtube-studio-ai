import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprintRuntimeInputs, POLICY_VERSION } from "../../../scripts/cloud-runtime-fingerprint.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "ysa-runtime-fingerprint-"));
const originalPackage = JSON.parse(readFileSync(join(repository, "package.json"), "utf8"));
const files = {
  "package.json": JSON.stringify(originalPackage),
  "package-lock.json": '{"lockfileVersion":3,"packages":{}}\n',
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  "pnpm-workspace.yaml": "allowBuilds: {}\n",
  ".github/workflows/ci.yml": "name: fixture\n",
  "convex/schema.ts": "export const schema = {};\n",
  "convex/auth.config.ts": "export default {};\n",
  "convex/crons.ts": "export default {};\n",
  "convex/_generated/api.js": "export const api = {};\n",
  "src/lib/shared.ts": "export const value = 1;\n",
  "src/lib/unused.ts": "export const unused = 1;\n",
  "src/engine/catalog.ts": 'export { value } from "../lib/shared";\n',
  "src/agents/agent.ts": "export const agent = 1;\n",
  "src/remotion/main.ts": "export const frame = 1;\n",
  "src/trigger/task.ts": 'import { value } from "@/lib/shared"; export const task = value;\n',
  "src/assets/palette.json": '{"accent":"red"}\n',
  "public/fonts/font.woff2": Buffer.from([1, 3, 5, 7]),
  "src/app/page.tsx": 'export default function Page() { return "UI one"; }\n',
  "src/app/globals.css": "body { color: white; }\n",
  "src/components/Card.tsx": 'export const Card = "card one";\n',
  "src/components/Card.module.css": ".card { color: white; }\n",
  "docs/readme.md": "Not a packaged build input.\n",
  "requirements/qa-scene-analysis.txt": "scene==1 --hash=sha256:fixture\n",
  "requirements/qa-narration-proof.txt": "narration==1 --hash=sha256:fixture\n",
};
for (const name of ["wb_scribe_sync", "whisper_align", "narration_transcript_proof", "mc_page_render", "mc_textplace", "mc_font", "shot_analysis"]) files[`scripts/${name}.py`] = "print('fixture')\n";
// The closed inventory intentionally requires review of changed build recipes.
// Use the actual approved recipes, never a permissive fixture-only policy.
for (const path of ["trigger.config.ts", "tsconfig.json", "convex/tsconfig.json"]) files[path] = readFileSync(join(repository, path));
let serial = 0, assertions = 0;
function put(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true, mode: 0o755 });
  writeFileSync(join(root, path), content, { mode: 0o644 });
}
function fixture(reverse = false) {
  const root = join(scratch, `case-${serial++}`);
  mkdirSync(root, { mode: 0o755 });
  for (const [path, bytes] of reverse ? Object.entries(files).reverse() : Object.entries(files)) put(root, path, bytes);
  return root;
}
const fingerprints = (result) => Object.fromEntries(Object.entries(result.providers).map(([name, value]) => [name, value.fingerprint]));
function complete(result) {
  assert.equal(result.reuseAuthorized, false);
  for (const provider of Object.values(result.providers)) {
    assert.equal(provider.status, "complete", JSON.stringify(provider.issues));
    assert.match(provider.fingerprint, /^[a-f0-9]{64}$/);
  }
}
function changed(mutator, expected = ["convex", "trigger"]) {
  const root = fixture(), before = fingerprintRuntimeInputs({ root });
  complete(before);
  mutator(root);
  const after = fingerprintRuntimeInputs({ root });
  complete(after);
  for (const provider of ["convex", "trigger"]) {
    assert.equal(before.providers[provider].fingerprint === after.providers[provider].fingerprint, !expected.includes(provider), provider);
  }
  assertions++;
}
function blocked(mutator, code, expected = ["convex", "trigger"]) {
  const root = fixture();
  mutator(root);
  const result = fingerprintRuntimeInputs({ root });
  assert.equal(result.reuseAuthorized, false);
  for (const provider of expected) {
    assert.equal(result.providers[provider].status, "blocked");
    assert.equal(result.providers[provider].fingerprint, null);
    assert.ok(result.providers[provider].issues.some((issue) => issue.code === code), JSON.stringify(result.providers[provider].issues));
  }
  assertions++;
}

try {
  const baseRoot = fixture(), base = fingerprintRuntimeInputs({ root: baseRoot });
  complete(base);
  assert.deepEqual(fingerprints(base), fingerprints(fingerprintRuntimeInputs({ root: fixture(true) })), "root directory and enumeration/creation order must not affect identity");
  assert.deepEqual(base.providers.convex.records.map((record) => record.path), base.providers.convex.records.map((record) => record.path).sort());
  assert.ok(base.providers.convex.records.every((record) => record.type && record.mode && (record.type !== "file" || record.sha256)));
  assert.ok(base.providers.convex.uiExcluded && base.providers.trigger.uiExcluded);

  for (const path of ["src/lib/shared.ts", "src/engine/catalog.ts", "src/agents/agent.ts", "src/remotion/main.ts", "package-lock.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".github/workflows/ci.yml"]) {
    changed((root) => put(root, path, `${files[path]}\n// changed\n`));
  }
  for (const path of ["scripts/mc_font.py", "scripts/shot_analysis.py", "scripts/narration_transcript_proof.py", "requirements/qa-scene-analysis.txt", "requirements/qa-narration-proof.txt", "src/assets/palette.json", "public/fonts/font.woff2"]) {
    changed((root) => put(root, path, Buffer.concat([Buffer.from(files[path]), Buffer.from("changed")])), ["trigger"]);
  }
  changed((root) => put(root, "convex/schema.ts", "export const schema = { changed: true };\n"), ["convex"]);
  changed((root) => put(root, "src/trigger/task.ts", 'export const task = "new";\n'), ["trigger"]);
  changed((root) => put(root, "scripts/new-build-helper.json", "{}\n")); // conservative support bucket
  changed((root) => renameSync(join(root, "public/fonts/font.woff2"), join(root, "public/fonts/renamed.woff2")), ["trigger"]);
  changed((root) => chmodSync(join(root, "scripts/mc_font.py"), 0o755), ["trigger"]);
  changed((root) => chmodSync(join(root, "public/fonts"), 0o700), ["trigger"]);
  changed((root) => rmSync(join(root, "src/lib/unused.ts")));
  changed((root) => {
    put(root, "src/app/page.tsx", "export default function Page() { return 'UI two'; }\n");
    put(root, "src/components/Card.tsx", "export const Card = 'card two';\n");
    put(root, "src/app/globals.css", "body { color: red; }\n");
    put(root, "docs/readme.md", "Changed review notes.\n");
  }, []);

  blocked((root) => put(root, "trigger.config.ts", `${files["trigger.config.ts"]}\n// expanded recipe\n`), "unreviewed-input-recipe", ["trigger"]);
  blocked((root) => put(root, "tsconfig.json", `${files["tsconfig.json"]}\n// alias change\n`), "unreviewed-input-recipe");
  blocked((root) => rmSync(join(root, "scripts/mc_font.py")), "missing-or-empty-required-file", ["trigger"]);
  blocked((root) => put(root, "requirements/qa-narration-proof.txt", ""), "missing-or-empty-required-file", ["trigger"]);
  blocked((root) => rmSync(join(root, "package-lock.json")), "missing-or-empty-required-file");
  blocked((root) => put(root, "future-build-input.json", "{}"), "unknown-path");
  blocked((root) => put(root, "src/future-runtime/task.ts", "export {};"), "unknown-path");
  blocked((root) => symlinkSync(join(root, "src/lib/shared.ts"), join(root, "src/components/Linked.tsx")), "unsupported-file-type");
  blocked((root) => symlinkSync("/must-not-be-read", join(root, "src/lib/linked")), "unsupported-file-type");
  blocked((root) => { rmSync(join(root, "package.json")); symlinkSync("/must-not-be-read", join(root, "package.json")); }, "unsupported-file-type");
  blocked((root) => put(root, "src/lib/shared.ts", 'import "../../../../outside";\n'), "escaping-module-path");
  blocked((root) => put(root, "src/trigger/task.ts", "const path = process.env.MODULE; import(path);\n"), "unresolved-dynamic-import", ["trigger"]);
  blocked((root) => put(root, "package.json", JSON.stringify({ ...originalPackage, imports: { "#ui": "./src/components/Card.tsx" } })), "unreviewed-local-package-resolution");
  blocked((root) => put(root, "package.json", JSON.stringify({ ...originalPackage, scripts: { ...originalPackage.scripts, "pretrigger:deploy": "node ui-transform.js" } })), "unreviewed-package-lifecycle");

  for (const edge of ['export { Card } from "@/components/Card";', 'const Card = require("../components/Card");', 'import { createRequire as factory } from "node:module"; const load = factory(import.meta.url); const Card = load("../components/Card");']) {
    const root = fixture();
    put(root, "src/lib/shared.ts", edge);
    const before = fingerprintRuntimeInputs({ root });
    complete(before);
    assert.ok(!before.providers.convex.uiExcluded && !before.providers.trigger.uiExcluded);
    put(root, "src/components/Card.module.css", ".card { color: red; }\n");
    const after = fingerprintRuntimeInputs({ root });
    complete(after);
    for (const provider of ["convex", "trigger"]) assert.notEqual(before.providers[provider].fingerprint, after.providers[provider].fingerprint);
    assertions++;
  }
  const crossRoot = fixture();
  put(crossRoot, "convex/schema.ts", 'export { task } from "../src/trigger/task";\n');
  const crossBefore = fingerprintRuntimeInputs({ root: crossRoot });
  complete(crossBefore);
  put(crossRoot, "src/trigger/task.ts", "export const task = 3;\n");
  const crossAfter = fingerprintRuntimeInputs({ root: crossRoot });
  complete(crossAfter);
  assert.notEqual(crossBefore.providers.convex.fingerprint, crossAfter.providers.convex.fingerprint, "cross-provider import must join the consumer inventory");
  const finiteRoot = fixture();
  put(finiteRoot, "src/trigger/task.ts", 'for (const pkg of ["@mastra/core", "@mastra/langfuse"]) { await import(pkg); }\n');
  complete(fingerprintRuntimeInputs({ root: finiteRoot }));

  const targets = { convex: { deployment: "astute-camel-689", kind: "dev" }, trigger: { project: "proj_vorkjqmnnpkzoiqqgbuu", environment: "prod" } };
  for (const provider of ["convex", "trigger"]) {
    const alternate = structuredClone(targets);
    if (provider === "convex") alternate.convex.kind = "prod";
    else alternate.trigger.environment = "staging";
    const result = fingerprintRuntimeInputs({ root: baseRoot, targets: alternate });
    complete(result);
    for (const name of ["convex", "trigger"]) assert.equal(result.providers[name].fingerprint === base.providers[name].fingerprint, name !== provider);
  }
  for (const options of [{ policyVersion: `${POLICY_VERSION}-next` }, { environmentEpoch: "owner-reviewed-rotation-2" }]) {
    const result = fingerprintRuntimeInputs({ root: baseRoot, ...options });
    complete(result);
    for (const provider of ["convex", "trigger"]) assert.notEqual(result.providers[provider].fingerprint, base.providers[provider].fingerprint);
  }
  const envTarget = fingerprintRuntimeInputs({ root: baseRoot, env: { TRIGGER_PROJECT_REF: "proj_alternate" } });
  complete(envTarget);
  assert.notEqual(envTarget.providers.trigger.fingerprint, base.providers.trigger.fingerprint);
  assert.equal(envTarget.providers.convex.fingerprint, base.providers.convex.fingerprint);
  assert.throws(() => fingerprintRuntimeInputs({ root: baseRoot, targets: { trigger: { project: "secret\nvalue", environment: "prod" } } }), /target/);
  symlinkSync(baseRoot, join(scratch, "root-link"));
  assert.throws(() => fingerprintRuntimeInputs({ root: join(scratch, "root-link") }), /symlinks/);

  const cli = spawnSync(process.execPath, [join(repository, "scripts/cloud-runtime-fingerprint.mjs"), "--root", baseRoot], { encoding: "utf8", env: { PATH: "/no-executable-tools" }, timeout: 15000 });
  assert.equal(cli.status, 0, cli.stderr);
  const report = JSON.parse(cli.stdout);
  assert.equal(report.reuseAuthorized, false);
  assert.equal(report.providers.trigger.records, undefined);
  assert.deepEqual(fingerprints(report), fingerprints(base));
  for (const args of [["--deploy"], ["--root"], ["--root", baseRoot, "--root", baseRoot], ["--files", "--files"], ["--root", baseRoot, "--unexpected"]]) {
    const invalidCli = spawnSync(process.execPath, [join(repository, "scripts/cloud-runtime-fingerprint.mjs"), ...args], { encoding: "utf8", env: { PATH: "/no-executable-tools" }, timeout: 15000 });
    assert.equal(invalidCli.status, 2);
    assert.doesNotMatch(invalidCli.stdout, /fingerprint|authorized.*true/);
  }
  console.log(`Runtime fingerprint foundation passed ${assertions} mutation/failure cases plus ordering, cross-provider/UI import propagation, finite imports, target/policy/epoch binding and actual no-tools CLI.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
