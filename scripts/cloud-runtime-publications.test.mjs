import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { RUNTIMES, REPOSITORY, githubApi, planPublications, requireRuntimeCredentials,
  recordPublication, observeNativeRuntime } from "./cloud-runtime-publications.mjs";

const revision = "a".repeat(40), recipe = "b".repeat(64), nativeHash = "c".repeat(64);
const native = async () => ({ fingerprint: nativeHash, status: "DEPLOYED", revision });
const receipt = layer => ({ id: layer === "backend" ? 11 : 12, sha: revision,
  environment: RUNTIMES[layer].environment, task: RUNTIMES[layer].task, creator: { login: "github-actions[bot]" },
  payload: { version: 1, repository: REPOSITORY, layer, target: RUNTIMES[layer].target,
    revision, recipe, beforeNative: nativeHash, workflowRun: "42", workflowAttempt: "1" } });
const success = () => ({ state: "success", creator: { login: "github-actions[bot]" },
  description: `studio-runtime-native/v1:${nativeHash}` });
function observation({ missing = false, state = "success", changeReceipt = d => d, changeStatus = s => s } = {}) {
  return async path => {
    if (path.includes("/statuses?")) return [changeStatus({ ...success(), state })];
    const layer = path.includes("studio-runtime-convex") ? "backend" : "trigger";
    return missing ? [] : [changeReceipt(receipt(layer))];
  };
}
const options = () => ({ api: observation(), recipe, observe: native,
  impact: () => ({ backend: false, trigger: false, reason: "verified-layer-inputs" }) });

test("unchanged/native-matching publications skip both runtimes", async () => {
  const plan = await planPublications(options());
  assert.equal(plan.any, false);
  assert.equal(plan.backend.deploy, false);
  assert.equal(plan.trigger.deploy, false);
  requireRuntimeCredentials(plan, {});
});
test("each layer compares its own successful revision", async () => {
  const seen = [];
  const plan = await planPublications({ ...options(), api: observation({ changeReceipt: d => {
    if (d.payload.layer === "trigger") d.sha = d.payload.revision = "d".repeat(40);
    return d;
  } }), impact: base => { seen.push(base); return { backend: false, trigger: base !== revision, reason: "verified-layer-inputs" }; } });
  assert.equal(plan.backend.deploy, false); assert.equal(plan.trigger.deploy, true);
  assert.deepEqual(seen.sort(), [revision, "d".repeat(40)].sort());
  assert.equal(plan.trigger.expectedNative, nativeHash);
  requireRuntimeCredentials(plan, { TRIGGER_ACCESS_TOKEN: "fixture" });
  assert.throws(() => requireRuntimeCredentials(plan, {}), /TRIGGER_ACCESS_TOKEN/);
});
test("missing baseline holds ordinary pushes; explicit manual redeploy bootstraps", async () => {
  const plan = await planPublications({ ...options(), api: observation({ missing: true }) });
  assert.equal(plan.any, false); assert.equal(plan.backend.held, true);
  assert.throws(() => requireRuntimeCredentials(plan), /baseline/);
  const manual = await planPublications({ ...options(), force: true });
  assert.equal(manual.backend.deploy, true); assert.equal(manual.trigger.deploy, true);
});
for (const state of ["failure", "pending", "in_progress", "error", "inactive"]) {
  test(`latest ${state} attempt remains eligible instead of falling back to an older success`, async () => {
    const plan = await planPublications({ ...options(), api: observation({ state }) });
    assert.equal(plan.backend.deploy, true); assert.equal(plan.trigger.deploy, true);
    assert.equal(plan.backend.reason, "latest-publication-not-successful");
  });
}
test("native drift protects ongoing manual development", async () => {
  const plan = await planPublications({ ...options(), observe: async () => ({ fingerprint: "d".repeat(64), status: "DEPLOYED" }) });
  assert.equal(plan.backend.held, true); assert.equal(plan.any, false);
  assert.equal(plan.backend.reason, "native-runtime-changed-outside-publisher");
});
test("an interrupted publication with changed native state requires explicit recovery", async () => {
  const plan = await planPublications({ ...options(), api: observation({ state: "in_progress" }),
    observe: async () => ({ fingerprint: "d".repeat(64), status: "DEPLOYED" }) });
  assert.equal(plan.backend.held, true); assert.equal(plan.any, false);
  assert.equal(plan.backend.reason, "native-runtime-changed-during-unfinished-publication");
});
test("recipe changes publish after confirming the native baseline", async () => {
  const plan = await planPublications({ ...options(), recipe: "d".repeat(64) });
  assert.equal(plan.backend.deploy, true); assert.equal(plan.backend.reason, "publisher-recipe-changed");
});
for (const change of [d => { d.creator.login = "someone"; return d; },
  d => { d.payload.target = "other-project"; return d; }, d => { d.payload.revision = "d".repeat(40); return d; }]) {
  test("unqualified receipt cannot authorize a skip or overwrite", async () => {
    const plan = await planPublications({ ...options(), api: observation({ changeReceipt: change }) });
    assert.equal(plan.backend.held, true); assert.equal(plan.any, false);
  });
}
test("unavailable observations and missing native success evidence hold safely", async () => {
  for (const api of [async () => { throw Error("SECRET"); }, observation({ changeStatus: s => ({ ...s, description: "missing" }) })]) {
    const plan = await planPublications({ ...options(), api });
    assert.equal(plan.backend.held, true); assert.doesNotMatch(JSON.stringify(plan), /SECRET/);
  }
});

const root = mkdtempSync(join(tmpdir(), "studio-publication-fixture-"));
after(() => rmSync(root, { recursive: true, force: true }));
const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
git(["init", "-q"]); git(["config", "user.name", "Fixture"]); git(["config", "user.email", "fixture@localhost"]);
git(["config", "core.hooksPath", "/dev/null"]);
writeFileSync(join(root, "package-lock.json"), JSON.stringify({ packages: { "node_modules/convex": { version: "1.43.0" } } }));
git(["add", "."]); git(["commit", "-qm", "offline fixture"]);
const actualSha = git(["rev-parse", "HEAD"]);
const env = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: REPOSITORY, GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: actualSha, GITHUB_EVENT_NAME: "push", GITHUB_RUN_ID: "42", GITHUB_RUN_ATTEMPT: "1",
  PUBLICATION_EXPECTED_NATIVE: nativeHash };
function publicationApi() {
  const calls = []; let deployment;
  const api = async (path, body) => {
    calls.push({ path, body });
    if (body?.ref) { deployment = { id: 71, sha: body.ref, ...body, creator: { login: "github-actions[bot]" } }; return deployment; }
    if (body) return { id: 99, ...body };
    return deployment;
  };
  return { api, calls };
}
test("real trusted checkout issues a pending attempt and native-bound success only afterward", async () => {
  const { api, calls } = publicationApi();
  const base = { api, layer: "backend", cwd: root, env, recipe, observe: native, admit: () => ({ deploy: true }) };
  const deploymentId = await recordPublication(base);
  assert.equal(deploymentId, 71); assert.equal(calls[0].body.auto_merge, false);
  assert.equal(calls[1].body.state, "in_progress");
  assert.ok(!calls.some(c => c.body?.state === "success"));
  await recordPublication({ ...base, deploymentId, complete: true });
  assert.equal(calls.at(-1).body.state, "success");
  assert.equal(calls.at(-1).body.description, `studio-runtime-native/v1:${nativeHash}`);
  assert.equal(calls.at(-1).body.auto_inactive, false);
});
test("stale main, changed native state and untrusted branch perform no receipt writes", async () => {
  for (const override of [{ admit: () => ({ deploy: false }) }, { env: { ...env, GITHUB_REF: "refs/heads/other" } },
    { observe: async () => ({ fingerprint: "d".repeat(64), status: "DEPLOYED" }) }]) {
    const { api, calls } = publicationApi();
    await assert.rejects(recordPublication({ api, layer: "backend", cwd: root, env, recipe, observe: native,
      admit: () => ({ deploy: true }), ...override }));
    assert.equal(calls.length, 0);
  }
});
test("completion cannot certify another workflow attempt or an unready native runtime", async () => {
  const { api, calls } = publicationApi();
  const base = { api, layer: "backend", cwd: root, env, recipe, observe: native, admit: () => ({ deploy: true }) };
  const deploymentId = await recordPublication(base);
  await assert.rejects(recordPublication({ ...base, deploymentId, complete: true, env: { ...env, GITHUB_RUN_ATTEMPT: "2" } }));
  await assert.rejects(recordPublication({ ...base, deploymentId, complete: true,
    observe: async () => ({ fingerprint: nativeHash, status: "BUILDING" }) }));
  assert.ok(!calls.some(c => c.body?.state === "success"));
});
test("a Trigger success receipt requires the exact deployed Git revision", async () => {
  const { api, calls } = publicationApi();
  const base = { api, layer: "trigger", cwd: root, env, recipe,
    observe: async () => ({ fingerprint: nativeHash, status: "DEPLOYED", revision: actualSha }), admit: () => ({ deploy: true }) };
  const deploymentId = await recordPublication(base);
  await assert.rejects(recordPublication({ ...base, deploymentId, complete: true, observe: native }), /workflow revision/);
  assert.ok(!calls.some(c => c.body?.state === "success"));
  await recordPublication({ ...base, deploymentId, complete: true });
  assert.equal(calls.at(-1).body.state, "success");
});
test("native Convex fingerprint includes all module hashes and ignores object/module ordering", async () => {
  const state = { config: { functions: "convex/" }, moduleHashes: [{ name: "b", hash: "b" }, { name: "a", hash: "a" }], udfServerVersion: "1.43.0", nodeVersion: "22" };
  let requests = 0;
  const fetchImpl = async (url, options) => {
    requests++; assert.equal(url, "https://astute-camel-689.convex.cloud/api/get_config_hashes");
    assert.equal(JSON.parse(options.body).adminKey, "fixture-key");
    return { ok: true, json: async () => structuredClone(state) };
  };
  const args = { env: { CONVEX_DEPLOY_KEY: "fixture-key" }, cwd: root, fetchImpl };
  const first = await observeNativeRuntime("backend", args);
  state.moduleHashes.reverse(); assert.deepEqual(await observeNativeRuntime("backend", args), first);
  state.moduleHashes[0].hash = "changed"; assert.notEqual((await observeNativeRuntime("backend", args)).fingerprint, first.fingerprint);
  assert.equal(requests, 3);
});
test("native Trigger observation is fixed to the actual prod project and records the deployment source", async () => {
  let count = 0;
  const result = await observeNativeRuntime("trigger", { env: { TRIGGER_ACCESS_TOKEN: "fixture-pat" }, fetchImpl: async (url, opts) => {
    count++;
    if (count === 1) { assert.match(url, /proj_vorkjqmnnpkzoiqqgbuu\/prod$/); assert.equal(opts.headers.Authorization, "Bearer fixture-pat"); return { ok: true, json: async () => ({ apiKey: "fixture-env-key" }) }; }
    assert.equal(url, "https://api.trigger.dev/api/v1/deployments"); assert.equal(opts.headers.Authorization, "Bearer fixture-env-key");
    return { ok: true, json: async () => ({ data: [{ id: "deployment_fixture", version: "1", status: "DEPLOYED", git: { commitSha: revision } }] }) };
  } });
  assert.equal(result.revision, revision); assert.equal(result.status, "DEPLOYED"); assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
});
test("GitHub API errors do not expose response bodies or follow credential redirects", async () => {
  const api = githubApi({ token: "SECRET", fetchImpl: async (_url, opts) => {
    assert.equal(opts.redirect, "error"); return { ok: false, status: 403, json: async () => ({ secret: "SECRET" }) };
  } });
  await assert.rejects(api(`/repos/${REPOSITORY}/deployments`), e => !e.message.includes("SECRET") && e.message.includes("403"));
});
