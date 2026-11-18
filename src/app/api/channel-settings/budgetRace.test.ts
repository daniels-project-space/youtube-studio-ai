import assert from "node:assert/strict";
import Module from "node:module";

const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const original = loader._load;
let calls = 0;
let race = false;
let observed: unknown;
class AuthError extends Error { status = 403; }
class Client {
  async query() { return { ownerId: "owner-a", budget: 10 }; }
  async mutation(_fn: unknown, args: unknown) {
    calls++; observed = args;
    if (race) throw new Error("channel budget changed; reload to review the current value and retry");
    return { forked: false };
  }
}
loader._load = function(name, ...args) {
  if (name === "@/lib/operatorSession") return { StudioAuthError: AuthError, requireStudioActor: async () => ({ ownerId: "owner-a", authKind: "test" }) };
  if (name === "@/lib/studioConvexHttpClient") return { StudioConvexHttpClient: Client };
  if (name === "@/lib/vault") return { hydrateEnv: async () => {} };
  return original.call(this, name, ...args);
};
async function main() {
  process.env.NEXT_PUBLIC_CONVEX_URL = "http://127.0.0.1:39320";
  const { POST } = await import("./route");
  const request = (expectedBudget: unknown) => new Request("http://localhost/api/channel-settings", {
    method: "POST", body: JSON.stringify({ channelId: "channel-a", action: "budget", budget: 15, expectedBudget }),
  });
  assert.equal((await POST(request(5))).status, 409);
  assert.equal((await POST(request(undefined))).status, 400, "missing form baseline must not be replaced with the current budget");
  assert.equal(calls, 0, "a stale form must not write");
  race = true;
  assert.equal((await POST(request(10))).status, 409, "a database race must report a conflict");
  assert.deepEqual(observed, { channelId: "channel-a", budget: 15, expectedBudget: 10 });
  race = false;
  assert.equal((await POST(request(10))).status, 200);
  console.log("Budget updates reject stale form and transaction races");
}
main().finally(() => { loader._load = original; }).catch(error => { console.error(error); process.exitCode = 1; });
