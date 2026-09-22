import assert from "node:assert/strict";
import { test } from "node:test";
import { REQUIRED_FUNCTIONS, STUDIO_DEPLOYMENT, verifyStudioDeployment } from "../../../scripts/verify-studio-deployment.mjs";

const revision = "a".repeat(40), oldRevision = "b".repeat(40), token = "tr_prod_fixture_never_echo";
function fixture() {
  const state = {
    web: { service: "youtube-studio-ai", ok: true, revision },
    cache: "no-store, max-age=0",
    convex: { url: STUDIO_DEPLOYMENT.convexUrl, functions: Object.entries(REQUIRED_FUNCTIONS).map(([identifier, functionType]) =>
      ({ identifier, functionType, visibility: { kind: "public" } })) },
    trigger: { version: "20260922.1", status: "DEPLOYED", git: { commitSha: revision, dirty: false } },
    schedules: [{ id: "schedule_studio", task: "shared-delivery-recovery", active: true, type: "DECLARATIVE",
      generator: { type: "CRON", expression: "* * * * *" }, environments: [{ id: STUDIO_DEPLOYMENT.triggerEnvironmentId, type: "PRODUCTION" }] }],
    calls: [],
  };
  const options = { revision, token, readFunctionSpec: async () => state.convex,
    fetchImpl: async (url, options) => {
      state.calls.push(url);
      assert.equal(options.method, "GET"); assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      if (url === STUDIO_DEPLOYMENT.healthUrl) {
        assert.equal(options.headers, undefined, "no provider credential may go to public health");
        return Response.json(state.web, { headers: { "Cache-Control": state.cache } });
      }
      assert.equal(new URL(url).origin, "https://api.trigger.dev");
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      if (url.endsWith("/deployments/current")) return Response.json(state.trigger);
      assert.equal(url, "https://api.trigger.dev/api/v1/schedules?page=1&perPage=100");
      return Response.json({ data: state.schedules, pagination: { count: state.schedules.length, totalPages: 1, currentPage: 1 } });
    } };
  return { state, options };
}

test("one read-only report verifies exact web/worker identities, backend surface and recovery without claiming runtime quality", async () => {
  const { state, options } = fixture();
  const report = await verifyStudioDeployment(options);
  assert.equal(report.deploymentChecksPassed, true);
  assert.equal(report.productionReadinessVerified, false);
  assert.equal(report.convexRevisionVerified, false);
  assert.equal(report.checks.recovery.scheduledStartsPer30Days, 43200);
  assert.equal(state.calls.length, 4, "one health, one worker, two consistent schedule inventories");
  assert.ok(!JSON.stringify(report).includes(token));
});

const regressions = [
  ["stale web", "web", s => { s.web.revision = oldRevision; }],
  ["cached health", "web", s => { s.cache = "public, max-age=60"; }],
  ["wrong service", "web", s => { s.web.service = "another-app"; }],
  ["wrong backend", "convex", s => { s.convex.url = "https://giddy-spoonbill-697.convex.cloud"; }],
  ["missing function", "convex", s => { s.convex.functions.pop(); }],
  ["query replaced by mutation", "convex", s => { s.convex.functions[0].functionType = "Mutation"; }],
  ["private function", "convex", s => { s.convex.functions[0].visibility.kind = "internal"; }],
  ["duplicate inventory", "convex", s => { s.convex.functions.push(s.convex.functions[0]); }],
  ["stale worker", "trigger", s => { s.trigger.git.commitSha = oldRevision; }],
  ["uncommitted worker", "trigger", s => { s.trigger.git.dirty = true; }],
  ["worker identity absent", "trigger", s => { delete s.trigger.git.commitSha; }],
  ["worker build incomplete", "trigger", s => { s.trigger.status = "BUILDING"; }],
  ["wrong schedule environment", "recovery", s => { s.schedules[0].environments[0].id = "other_environment"; }],
  ["disabled recovery", "recovery", s => { s.schedules[0].active = false; }],
];
for (const [name, component, mutate] of regressions) test(`deployment report rejects ${name}`, async () => {
  const { state, options } = fixture(); mutate(state);
  const report = await verifyStudioDeployment(options);
  assert.equal(report.deploymentChecksPassed, false);
  assert.equal(report.checks[component].verified, false);
  assert.equal(Object.keys(report.checks).length, 4, "one failure must not hide other deployment layers");
});

test("transport errors and CLI stderr cannot expose credentials or suppress remaining observations", async () => {
  const { options } = fixture();
  options.readFunctionSpec = async () => { throw new Error(token); };
  const fetch = options.fetchImpl;
  options.fetchImpl = async (url, config) => {
    if (url.endsWith("/deployments/current")) throw new Error(token);
    return fetch(url, config);
  };
  const report = await verifyStudioDeployment(options);
  assert.equal(report.checks.web.verified, true);
  assert.equal(report.checks.recovery.verified, true);
  assert.equal(report.deploymentChecksPassed, false);
  assert.ok(!JSON.stringify(report).includes(token));
});

test("invalid targets and nonproduction credentials refuse all observations", async () => {
  for (const change of [{ revision: "HEAD" }, { mode: "disabled" }, { token: "tr_dev_fixture" }]) {
    const { state, options } = fixture();
    await assert.rejects(verifyStudioDeployment({ ...options, ...change }));
    assert.equal(state.calls.length, 0);
  }
});

test("oversized provider body fails closed and still inspects schedules", async () => {
  const { options } = fixture();
  const fetch = options.fetchImpl;
  options.fetchImpl = async (url, config) => url.endsWith("/deployments/current")
    ? new Response(" ".repeat(256 * 1024 + 1)) : fetch(url, config);
  const report = await verifyStudioDeployment(options);
  assert.equal(report.checks.trigger.verified, false);
  assert.equal(report.checks.recovery.verified, true);
});
