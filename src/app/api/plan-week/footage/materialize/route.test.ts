import assert from "node:assert/strict";
import Module from "node:module";
const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const original = loader._load;
let authorized = true;
const calls: unknown[][] = [];
class AuthError extends Error { status = 403; }
loader._load = function (name, ...args) {
  if (name === "@/lib/operatorSession") return { StudioAuthError: AuthError, requireStudioActor: async () => {
    if (!authorized) throw new AuthError("forbidden");
    return { ownerId: "owner-real" };
  } };
  if (name === "@trigger.dev/sdk") return { tasks: { trigger: async (...args: unknown[]) => { calls.push(args); return { id: "run-1" }; } } };
  return original.call(this, name, ...args);
};
async function main() {
  const { POST } = await import("./route");
  const req = (body: unknown) => new Request("https://studio.test/api/plan-week/footage/materialize", { method: "POST", body: JSON.stringify(body) });
  const body = { channelSlug: "archive", batchId: "batch-1", itemId: "item-1" };
  process.env.TRIGGER_SECRET_KEY = "fixture";
  authorized = false;
  assert.equal((await POST(req(body))).status, 403);
  authorized = true;
  assert.equal((await POST(req({ ...body, ownerId: "victim" }))).status, 422);
  assert.equal((await POST(req({ ...body, itemId: "../escape" }))).status, 422);
  delete process.env.TRIGGER_SECRET_KEY;
  assert.equal((await POST(req(body))).status, 503);
  assert.equal(calls.length, 0);
  process.env.TRIGGER_SECRET_KEY = "fixture";
  const response = await POST(req(body));
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(calls[0], ["render-engine-h3-materialize-prepared-footage", { ownerId: "owner-real", ...body }]);
  await POST(req(body));
  assert.equal(calls.length, 2, "manual retry must not replay an earlier pending-job failure");
  assert.match((await response.json()).sidecarKey, /^owner\/owner-real\//);
  console.log("manual footage materialization handler passed");
}
main().finally(() => { loader._load = original; }).catch((error) => { console.error(error); process.exitCode = 1; });
