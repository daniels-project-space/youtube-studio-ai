import assert from "node:assert/strict";
import Module from "node:module";
import { getFunctionName } from "convex/server";

const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const original = loader._load;
const calls: string[] = [];
let envelope: Record<string, unknown> | undefined;
let staleShell = false;
let owner = "owner-a";
const channel = { ownerId: "owner-a", slug: "test", name: "Test", budget: 40, pipeline: [{ block: "qa_visual" }, { block: "upload_draft" }], moduleConfig: {} };
class AuthError extends Error { status = 403; }
class Client {
  async query(ref: Parameters<typeof getFunctionName>[0]) {
    if (getFunctionName(ref) === "channels:getChannel") return { ...channel, ownerId: owner };
    if (getFunctionName(ref) === "runs:getProbeRunByDispatchKey") return envelope ? { probeDispatchEnvelope: envelope } : staleShell ? { _id: "run-a", manualPrivateRequestFingerprint: "f".repeat(64) } : null;
    if (getFunctionName(ref) === "runs:getRun") return { ownerId: "owner-a", channelId: "channel-a", status: "queued", probeDispatchEnvelope: envelope };
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
  if (name === "@/lib/privateBenchmarkPreflight") return { privatePipelineConfigurationPreflight: () => ({ blockers: [] }) };
  if (name === "@trigger.dev/sdk") return { idempotencyKeys: { create: async () => "same-key" }, tasks: { trigger: async (_name: string, payload: Record<string, unknown>, options: Record<string, unknown>) => {
    calls.push("dispatch"); assert.equal(options.idempotencyKey, "same-key"); assert.equal(payload.channelId, "channel-a"); return { id: "task-a" };
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
  const { POST } = await import("./route");
  const body = { channelId: "channel-a", requestKey: "request-a", maximumCostUsd: 25, confirmPrivateVideo: true };
  const req = (value: unknown) => new Request("http://localhost/api/manual-private-video", { method: "POST", body: JSON.stringify(value) });
  assert.equal((await POST(req({ ...body, confirmPrivateVideo: false }))).status, 400);
  owner = "other-owner";
  assert.equal((await POST(req(body))).status, 404);
  assert.deepEqual(calls, []);
  owner = "owner-a";
  assert.equal((await POST(req(body))).status, 202);
  assert.equal((await POST(req(body))).status, 202);
  assert.deepEqual(calls, ["shell", "claim", "dispatch", "shell", "dispatch"]);
  assert.equal((await POST(req({ ...body, maximumCostUsd: 26 }))).status, 503);
  envelope = undefined; staleShell = true;
  const recovery = await POST(req(body));
  assert.equal(recovery.status, 409);
  assert.equal((await recovery.json()).restartAllowed, true);
  assert.equal(calls.at(-1), "cancel");
  console.log("Owner-confirmed manual private video reuses its sealed run and dispatch key");
}
main().finally(() => { loader._load = original; }).catch(error => { console.error(error); process.exitCode = 1; });
