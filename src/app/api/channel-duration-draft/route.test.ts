import assert from "node:assert/strict";
import Module from "node:module";

const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const original = loader._load;
let actor = { ownerId: "owner-a", role: "owner", authKind: "session" };
let channel: { ownerId: string; family: string; pipeline: { block: string; params: Record<string, number> }[]; identity: { programRoute: { frozen: boolean } } } = { ownerId: "owner-a", family: "music_loop", pipeline: [{ block: "assemble", params: { durationSec: 7200 } }], identity: { programRoute: { frozen: true } } };
let writes = 0;
class AuthError extends Error { constructor(message: string, public status: number) { super(message); } }
class Client {
  async query() { return channel; }
  async mutation() { writes++; throw new Error("Unexpected write"); }
}
loader._load = function(name, ...args) {
  if (name === "@/lib/operatorSession") return { StudioAuthError: AuthError, requireStudioActor: async () => actor };
  if (name === "@/lib/studioConvexHttpClient") return { StudioConvexHttpClient: Client };
  return original.call(this, name, ...args);
};
async function main() {
  process.env.YOUTUBE_AUTOMATION_PRIVATE = "1";
  process.env.NEXT_PUBLIC_CONVEX_URL = "http://127.0.0.1:39320";
  const { POST } = await import("./route");
  const post = (body: unknown) => POST(new Request("http://localhost/api/channel-duration-draft", { method: "POST", body: JSON.stringify(body) }));
  const input = { channelId: "channel-a", requestedSeconds: 10800 };
  const before = structuredClone(channel);
  const response = await post(input);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const draft = await response.json();
  assert.deepEqual(draft.saved, { source: "assembly", seconds: 7200 });
  assert.equal(draft.requestedSeconds, 10800);
  assert.equal(draft.deltaSeconds, 3600);
  assert.equal(draft.savedToAccount, false);
  assert.match(draft.baselineFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(channel, before);
  assert.equal((await post({ ...input, requestedSeconds: 3601 })).status, 422);
  assert.equal((await post({ ...input, requestedSeconds: 1 })).status, 422);
  assert.equal((await post({ ...input, requestedSeconds: 1.5 })).status, 400);
  assert.equal((await post({ ...input, activate: true })).status, 400);
  channel = { ...channel, family: "narrated_stock", pipeline: [{ block: "script_gen", params: { maxSeconds: 600 } }] };
  const scriptDraft = await (await post({ ...input, requestedSeconds: 900 })).json();
  assert.deepEqual(scriptDraft.saved, { source: "script_maximum", seconds: 600 });
  assert.equal(scriptDraft.deltaSeconds, null);
  channel = { ...channel, ownerId: "owner-b" };
  assert.equal((await post(input)).status, 403);
  actor = { ownerId: "owner-a", role: "owner", authKind: "service" };
  assert.equal((await post(input)).status, 403);
  assert.equal(writes, 0);
  console.log("Duration draft validates format and ownership without mutating channel data");
}
main().finally(() => { loader._load = original; }).catch(error => { console.error(error); process.exitCode = 1; });
