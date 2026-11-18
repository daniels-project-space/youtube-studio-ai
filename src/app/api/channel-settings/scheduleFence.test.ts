import assert from "node:assert/strict";
import Module from "node:module";
import { channelScheduleWriteFence } from "@/lib/channelScheduleWriteFence";

const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const original = loader._load;
const current = { ownerId: "owner-a", pipeline: [], schedule: { enabled: true, frequency: "daily", timezone: "UTC" } };
let race = false, writes = 0;
class AuthError extends Error { status = 403; }
class Client {
  async query() { return structuredClone(current); }
  async mutation(_reference: unknown, args: { schedule: typeof current.schedule; expectedScheduleFence: string }) {
    if (race) current.schedule.enabled = false;
    if (args.expectedScheduleFence !== channelScheduleWriteFence(current.schedule)) throw new Error("stale schedule");
    current.schedule = structuredClone(args.schedule); writes++; return { forked: false };
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
  const request = (fence?: string) => new Request("http://localhost/api/channel-settings", { method: "POST", body: JSON.stringify({ channelId: "channel-a", action: "schedule", expectedScheduleFence: fence, schedule: { timezone: "Europe/London" } }) });
  assert.equal((await POST(request())).status, 400);
  assert.equal((await POST(request("0".repeat(64)))).status, 409);
  race = true;
  const conflict = await POST(request(channelScheduleWriteFence(current.schedule)));
  assert.equal(conflict.status, 409);
  assert.match((await conflict.json()).error, /schedule changed/);
  assert.equal(current.schedule.enabled, false, "a stale timezone change cannot undo a concurrent disable");
  assert.equal(writes, 0);
  race = false;
  assert.equal((await POST(request(channelScheduleWriteFence(current.schedule)))).status, 200);
  assert.equal(current.schedule.enabled, false);
  assert.equal(current.schedule.timezone, "Europe/London");
  console.log("Schedule edits preserve concurrent disables and report conflicts");
}
main().finally(() => { loader._load = original; }).catch(error => { console.error(error); process.exitCode = 1; });
