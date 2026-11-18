import assert from "node:assert/strict";
import Module from "node:module";
import { channelScheduleWriteFence } from "@/lib/channelScheduleWriteFence";

const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const original = loader._load;
let rejected = true;
class AuthError extends Error { status = 403; }
class Client {
  async query() { return { ownerId: "owner-a", pipeline: [], schedule: { enabled: false, frequency: "daily" } }; }
  async mutation() { return rejected ? { forked: false, state: "channel_locked" } : { forked: false }; }
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
  const actions = [
    { action: "schedule", schedule: { frequency: "daily", enabled: false }, expectedScheduleFence: channelScheduleWriteFence({ enabled: false, frequency: "daily" }) },
    { action: "status", status: "paused" },
    { action: "budget", budget: 5, expectedBudget: null },
    { action: "casefile_auto_research", enabled: false },
  ];
  for (const action of actions) {
    const request = () => new Request("http://localhost/api/channel-settings", { method: "POST", body: JSON.stringify({ channelId: "channel-a", ...action }) });
    rejected = true;
    const conflict = await POST(request());
    assert.equal(conflict.status, 409, `${action.action} must not claim a rejected save succeeded`);
    assert.equal((await conflict.json()).ok, false);
    rejected = false;
    assert.equal((await POST(request())).status, 200, `${action.action} should report an accepted save`);
  }
  console.log("All settings actions report mid-request channel locks honestly");
}
main().finally(() => { loader._load = original; }).catch(error => { console.error(error); process.exitCode = 1; });
