import assert from "node:assert/strict";
import Module from "node:module";
import { getFunctionName } from "convex/server";

const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const original = loader._load;
const calls: string[] = [];
let keyCalls = 0;
let clientCreations = 0;
let envelope: Record<string, unknown> | undefined;
let staleShell = false;
let runStatus = "queued";
let existingOwner = "owner-a";
let owner = "owner-a";
let preflightBlockers: string[] = [];
const channel = { ownerId: "owner-a", slug: "test", name: "Test", budget: 40, pipeline: [{ block: "qa_visual" }, { block: "upload_draft" }], moduleConfig: {} };
class AuthError extends Error { status = 403; }
class Client {
  constructor() { clientCreations++; }
  async query(ref: Parameters<typeof getFunctionName>[0]) {
    if (getFunctionName(ref) === "channels:getChannel") return { ...channel, ownerId: owner };
    if (getFunctionName(ref) === "runs:getProbeRunByDispatchKey") return envelope ? { _id: "run-a", ownerId: existingOwner, channelId: "channel-a", status: runStatus, probeDispatchEnvelope: envelope } : staleShell ? { _id: "run-a", manualPrivateRequestFingerprint: "f".repeat(64) } : null;
    if (getFunctionName(ref) === "runs:getRun") return { ownerId: "owner-a", channelId: "channel-a", status: runStatus, probeDispatchEnvelope: envelope };
    throw Error("unexpected query");
  }
  async mutation(ref: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) {
    if (getFunctionName(ref) === "runs:createProbeRun") { calls.push("shell"); return "run-a"; }
    if (getFunctionName(ref) === "runs:claimProbeDispatchEnvelope") { calls.push("claim"); envelope = args.envelope as Record<string, unknown>; return { envelope }; }
    if (getFunctionName(ref) === "runs:cancelUnsealedManualPrivateRun") { calls.push("cancel"); return true; }
    throw Error("unexpected mutation");
  }
}
loader._load = function(name, ...args) {
  if (name === "@/lib/operatorSession") return { StudioAuthError: AuthError, requireStudioActor: async () => ({ ownerId: "owner-a" }) };
  if (name === "@/lib/studioConvexHttpClient") return { StudioConvexHttpClient: Client };
  if (name === "@/lib/privateBenchmarkPreflight") return { privatePipelineConfigurationPreflight: () => ({ blockers: preflightBlockers }) };
  if (name === "@trigger.dev/sdk") return { idempotencyKeys: { create: async () => { keyCalls++; return "same-key"; } }, tasks: { trigger: async (_name: string, payload: Record<string, unknown>, options: Record<string, unknown>, request: { clientConfig: { baseURL: string } }) => {
    calls.push("dispatch"); assert.equal(options.idempotencyKey, "same-key"); assert.equal(payload.channelId, "channel-a"); assert.equal(request.clientConfig.baseURL, "http://127.0.0.1:8030"); return { id: "task-a" };
  } } };
  if (name === "@/engine/contentLane") return { resolveContentLane: () => ({ family: "narrated_stock" }) };
  if (name === "@/lib/manualPrivateVideoPipeline") return { buildManualPrivateVideoPipeline: () => [{ block: "qa_visual" }] };
  if (name === "@/lib/channelInceptionProbe") return {
    freezeChannelInceptionProbeContext: () => ({ channelBudgetUsd: 40, keyPrefix: "private", seedStore: {}, madeForKids: false }),
    freezeChannelInceptionProbeInput: (input: Record<string, unknown>) => ({ ...input, overrideFingerprint: "a".repeat(64) }),
    prepareChannelInceptionProbeAttempt: (value: Record<string, unknown>) => ({ ...value, dispatchEnvelopeFingerprint: "b".repeat(64) }),
    assertChannelInceptionProbeAttempt: () => {},
  };
  if (name === "@/lib/studioActionApproval") return { issueStudioActionApproval: () => ({ fixture: true }), pipelineProbeApprovalSubject: () => "subject" };
  return original.call(this, name, ...args);
};
async function main() {
  process.env.YOUTUBE_AUTOMATION_PRIVATE = "1";
  process.env.NEXT_PUBLIC_CONVEX_URL = "http://127.0.0.1:39320";
  process.env.TRIGGER_API_URL = "http://127.0.0.1:8030";
  const { GET, POST } = await import("./route");
  const body = { channelId: "channel-a", requestKey: "request-a", maximumCostUsd: 25, confirmPrivateVideo: true };
  const req = (value: unknown) => new Request("http://localhost/api/manual-private-video", { method: "POST", body: JSON.stringify(value) });
  for (const [bodyText, headers, expected] of [
    ["{", {}, 400],
    ["x".repeat(100_001), {}, 413],
    ["x".repeat(100_001), { "content-length": "1" }, 413],
    ["{}", { "content-length": "100001" }, 413],
  ] as const) {
    const response = await POST(new Request("http://localhost/api/manual-private-video", { method: "POST", body: bodyText, headers }));
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(clientCreations, 0, "invalid bodies must not open a database client");
    assert.equal(keyCalls, 0, "invalid bodies must not access the Trigger SDK");
    assert.deepEqual(calls, []);
  }
  assert.equal((await POST(req({ ...body, confirmPrivateVideo: false }))).status, 400);
  owner = "other-owner";
  assert.equal((await POST(req(body))).status, 404);
  assert.equal((await GET(new Request("http://localhost/api/manual-private-video?channelId=channel-a&maximumCostUsd=25"))).status, 404);
  assert.deepEqual(calls, []);
  owner = "owner-a";
  const check = await GET(new Request("http://localhost/api/manual-private-video?channelId=channel-a&maximumCostUsd=25"));
  assert.equal(check.status, 200);
  const checkBody = await check.json();
  assert.equal(checkBody.ok, true);
  assert.equal(checkBody.workerCapabilityChecked, false);
  assert.match(checkBody.warning, /worker.*duration.*not been verified/i);
  assert.equal(check.headers.get("cache-control"), "no-store");
  assert.deepEqual(calls, [], "preflight must never allocate or dispatch a run");
  preflightBlockers = ["Fixture structural incompatibility"];
  const blocked = await GET(new Request("http://localhost/api/manual-private-video?channelId=channel-a&maximumCostUsd=25"));
  assert.equal(blocked.status, 422);
  assert.equal((await blocked.json()).error, "Fixture structural incompatibility");
  assert.equal((await POST(req(body))).status, 422);
  assert.deepEqual(calls, [], "a proven configuration blocker must prevent dispatch");
  preflightBlockers = [];
  for (const target of [undefined, "https://api.trigger.dev", "http://example.com:8030", "http://127.0.0.1:8030/path"]) {
    if (target === undefined) delete process.env.TRIGGER_API_URL;
    else process.env.TRIGGER_API_URL = target;
    assert.equal((await GET(new Request("http://localhost/api/manual-private-video?channelId=channel-a&maximumCostUsd=25"))).status, 503);
    assert.equal((await POST(req(body))).status, 503);
    assert.deepEqual(calls, [], "invalid private Trigger target must never write or dispatch");
  }
  process.env.TRIGGER_API_URL = "http://127.0.0.1:8030";
  const queued = await POST(req(body));
  assert.equal(queued.status, 202);
  assert.equal((await queued.json()).workerCapabilityChecked, false);
  preflightBlockers = ["Changed settings after sealing"];
  assert.equal((await POST(req(body))).status, 202);
  preflightBlockers = [];
  assert.deepEqual(calls, ["shell", "claim", "dispatch", "shell", "dispatch"]);
  assert.equal((await POST(req({ ...body, maximumCostUsd: 26 }))).status, 503);
  calls.length = 0;
  const keysBeforeRecovery = keyCalls;
  runStatus = "running";
  delete process.env.TRIGGER_API_URL;
  const running = await POST(req(body));
  assert.equal(running.status, 200);
  assert.deepEqual(await running.json(), { ok: true, state: "running", runId: "run-a", privateOnly: true });
  assert.equal(running.headers.get("cache-control"), "no-store");
  assert.deepEqual(calls, [], "recovering an existing running run must not write or call Trigger");
  runStatus = "failed";
  const failed = await POST(req(body));
  assert.equal(failed.status, 200);
  assert.equal((await failed.json()).state, "failed");
  assert.deepEqual(calls, []);
  assert.equal(keyCalls, keysBeforeRecovery, "read-only recovery must not call the Trigger SDK");
  assert.equal((await POST(req({ ...body, maximumCostUsd: 26 }))).status, 503);
  existingOwner = "other-owner";
  assert.equal((await POST(req(body))).status, 503);
  assert.deepEqual(calls, []);
  existingOwner = "owner-a"; runStatus = "queued";
  assert.equal((await POST(req(body))).status, 503, "queued runs must not dispatch without a valid target");
  assert.deepEqual(calls, []);
  process.env.TRIGGER_API_URL = "http://127.0.0.1:8030";
  envelope = undefined; staleShell = true;
  const recovery = await POST(req(body));
  assert.equal(recovery.status, 409);
  assert.equal((await recovery.json()).restartAllowed, true);
  assert.equal(calls.at(-1), "cancel");
  console.log("Owner-confirmed manual private video reuses its sealed run and dispatch key");
}
main().finally(() => { loader._load = original; }).catch(error => { console.error(error); process.exitCode = 1; });
