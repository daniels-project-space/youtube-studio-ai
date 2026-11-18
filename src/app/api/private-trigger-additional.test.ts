import assert from "node:assert/strict";
import Module from "node:module";
import { readFileSync } from "node:fs";

const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const original = loader._load;
const originalFetch = globalThis.fetch;
let sdkCalls: unknown[][] = [];
let keyCalls = 0;
let writes = 0;
let networkCalls = 0;
globalThis.fetch = (async () => { networkCalls++; throw new Error("network disabled in synthetic test"); }) as typeof fetch;
class StudioAuthError extends Error { status = 403; }
class Client {
  async mutation() { writes++; return null; }
  async query() { return null; }
}
loader._load = function(name, ...args) {
  if (name === "@/lib/operatorSession") return { StudioAuthError, requireStudioActor: async () => ({ ownerId: "owner-a", authKind: "session" }), getStudioActor: async () => ({ ownerId: "owner-a", authKind: "session", role: "owner" }), authorizeStudioRoute: async () => null };
  if (name === "@trigger.dev/sdk") return { idempotencyKeys: { create: async () => { keyCalls++; return "key"; } }, tasks: { trigger: async (...args: unknown[]) => { sdkCalls.push(args); return { id: "synthetic" }; } } };
  if (name === "@/lib/studioConvexHttpClient") return { StudioConvexHttpClient: Client };
  if (name === "@/lib/vault") return { hydrateEnv: async () => {} };
  if (name === "@/lib/youtubeConnector") return { requireInternalQuerySecret: () => "synthetic" };
  if (name === "@/lib/studioActionApproval") return { issueStudioActionApproval: () => ({}), studioActionApprovalFingerprint: () => "b".repeat(64) };
  if (/^@\/lib\/planWeekPrepared(?:Narration|Images|Music|Script)Args$/.test(name)) {
    const base = name.slice(name.lastIndexOf("/") + 1);
    const key = `assert${base[0]!.toUpperCase()}${base.slice(1)}`;
    return { [key]: (value: unknown) => value };
  }
  return original.call(this, name, ...args);
};

async function main() {
  process.env.TRIGGER_SECRET_KEY = "synthetic";
  process.env.NEXT_PUBLIC_CONVEX_URL = "http://127.0.0.1:39320";
  process.env.YOUTUBE_AUTOMATION_PRIVATE = "1";
  const modules = await Promise.all([
    import("./plan-week/narration/route"), import("./plan-week/images/route"),
    import("./plan-week/music/route"), import("./plan-week/script/route"),
    import("./plan-week/footage/materialize/route"),
  ]);
  const publish = await import("./publish-intents/route");
  const create = await import("./youtube-create/route");
  const retire = await import("./youtube-video-retire/route");
  const thumbnail = await import("./thumbnail-refresh/route");
  const accept = await import("./thumbnail-refresh/accept/route");
  const ernie = await import("./thumbnail-refresh/ernie-batch/route");
  const payload = { manifestKey: "owner/owner-a/fixture", manifestSha256: "a".repeat(64), channelId: "channel-a", channelSlug: "archive", batchId: "batch-1", itemId: "item-1" };
  const footage = { channelSlug: "archive", batchId: "batch-1", itemId: "item-1" };
  const req = (body: unknown) => new Request("http://localhost/test", { method: "POST", body: JSON.stringify(body) });
  const plan = async () => Promise.all(modules.map((module, index) => module.POST(req(index === 4 ? footage : payload))));
  for (const target of [undefined, "https://api.trigger.dev"]) {
    if (target === undefined) delete process.env.TRIGGER_API_URL;
    else process.env.TRIGGER_API_URL = target;
    for (const response of await plan()) assert.equal(response.status, 503);
    assert.equal((await publish.POST(req({ action: "approve", intentId: "intent-a" }))).status, 503);
    assert.equal((await create.POST(req({ name: "Fixture", channelId: "channel-a", intentKey: "fixture-intent-key", confirmedCreateNewChannel: true }))).status, 503);
    assert.equal((await retire.POST(req({ runId: "run-12345", youtubeVideoId: "video-12345", reason: "failed_run_uploaded", confirmPermanentDeletion: "video-12345" }))).status, 503);
    assert.equal((await thumbnail.POST(req({ sourceRunId: "a".repeat(32), confirmCandidateSpend: true }))).status, 503);
    assert.equal((await accept.POST(req({ sourceRunId: "run-12345", candidateRunId: "run-67890", youtubeVideoId: "video-12345", confirmYoutubeVideoId: "video-12345" }))).status, 503);
    assert.equal((await ernie.POST(req({}))).status, 503);
    assert.equal(writes, 0, "invalid target must not persist approvals or retirement shells");
    assert.equal(sdkCalls.length, 0);
    assert.equal(keyCalls, 0);
    assert.equal(networkCalls, 0);
  }
  const cancel = await publish.POST(req({ action: "cancel", intentId: "intent-a" }));
  assert.equal(cancel.status, 200, "cancel remains available without a dispatch target");
  assert.equal(writes, 1);
  process.env.TRIGGER_API_URL = "http://127.0.0.1:8030";
  for (const response of await plan()) assert.equal(response.status, 202);
  assert.equal((await ernie.POST(req({}))).status, 202);
  assert.equal(sdkCalls.length, 6);
  for (const call of sdkCalls) assert.deepEqual(call[3], { clientConfig: { baseURL: "http://127.0.0.1:8030" } });
  sdkCalls = [];
  delete process.env.YOUTUBE_AUTOMATION_PRIVATE;
  for (const response of await plan()) assert.equal(response.status, 202);
  assert.equal((await ernie.POST(req({}))).status, 202);
  for (const call of sdkCalls) assert.equal(call[3], undefined);
  assert.equal(networkCalls, 0);
  for (const file of ["publish-intents", "youtube-create", "youtube-video-retire", "youtube-callback"]) {
    const source = readFileSync(`src/app/api/${file}/route.ts`, "utf8");
    assert.match(source, /privateTriggerRequestOptions\(process\.env\)/);
    assert.match(source, /tasks\.trigger\([\s\S]*?requestOptions/);
  }
  console.log("Additional private dispatch routes reject unsafe targets before SDK and durable writes");
}
main().finally(() => { loader._load = original; globalThis.fetch = originalFetch; }).catch(error => { console.error(error); process.exitCode = 1; });
