import assert from "node:assert/strict";
import Module from "node:module";
import { getFunctionName } from "convex/server";

const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const original = loader._load;
const events: string[] = [];
let authorized = true;
let failDispatch = false;
let claimed = false;
class AuthError extends Error { status = 403; }
class Client {
  async query(reference: Parameters<typeof getFunctionName>[0]) {
    const name = getFunctionName(reference);
    if (name === "channels:getChannel") return { ownerId: "owner-a" };
    if (name === "runs:getRun") return { ownerId: "owner-a", channelId: "channel-a", ...(claimed ? {
      routeQualificationBenchmarkRequestApproval: { approved: true }, routeQualificationBenchmarkMaximumCostUsd: 3,
    } : {}) };
    throw new Error(`Unexpected query ${name}`);
  }
  async mutation(reference: Parameters<typeof getFunctionName>[0]) {
    const name = getFunctionName(reference);
    if (name.endsWith(":createShell")) { events.push("shell"); return { state: claimed ? "reused" : "created", runId: "run-a" }; }
    if (name.endsWith(":claimRequestApproval")) { events.push("approval"); claimed = true; return {}; }
    throw new Error(`Unexpected mutation ${name}`);
  }
}
loader._load = function (name, ...args) {
  if (name === "@/lib/operatorSession") return { StudioAuthError: AuthError, requireStudioActor: async () => {
    if (!authorized) throw new AuthError("forbidden");
    return { ownerId: "owner-a", authKind: "session" };
  } };
  if (name === "@/lib/studioConvexHttpClient") return { StudioConvexHttpClient: Client };
  if (name === "@/lib/studioActionApproval") return { issueStudioActionApproval: () => ({ approved: true }) };
  if (name === "@/lib/routeQualificationManualDispatch") return { requestRouteQualificationDispatch: async (payload: unknown) => {
    events.push("dispatch");
    assert.deepEqual(payload, { channelId: "channel-a", runId: "run-a" });
    if (failDispatch) throw new Error("fixture offline");
    return "dispatcher-a";
  } };
  return original.call(this, name, ...args);
};

async function main() {
  process.env.NEXT_PUBLIC_CONVEX_URL = "http://127.0.0.1:39320";
  process.env.TRIGGER_SECRET_KEY = "fixture";
  const { POST } = await import("./route");
  const body = { channelId: "channel-a", requestKey: "request-a", maximumCostUsd: 3, confirmPrivateBenchmark: true };
  const request = (value: unknown) => new Request("http://localhost/api/route-qualification-benchmarks", { method: "POST", body: JSON.stringify(value) });
  authorized = false;
  assert.equal((await POST(request(body))).status, 403);
  assert.deepEqual(events, []);
  authorized = true;
  assert.equal((await POST(request({ ...body, pipelineOverride: [] }))).status, 400);
  assert.deepEqual(events, []);
  failDispatch = true;
  const pending = await POST(request(body));
  assert.equal(pending.status, 202);
  assert.equal((await pending.json()).state, "dispatch_pending");
  assert.deepEqual(events, ["shell", "approval", "dispatch"]);
  failDispatch = false;
  const retry = await POST(request(body));
  const result = await retry.json();
  assert.equal(result.state, "reused");
  assert.equal(result.runId, "run-a");
  assert.equal(result.dispatcherRunId, "dispatcher-a");
  assert.deepEqual(events, ["shell", "approval", "dispatch", "shell", "dispatch"]);
  console.log("Owner benchmark approval wakes only its dispatcher and retries a saved request safely");
}
main().finally(() => { loader._load = original; }).catch(error => { console.error(error); process.exitCode = 1; });
