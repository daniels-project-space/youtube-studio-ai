import assert from "node:assert/strict";
import Module from "node:module";
import { getFunctionName } from "convex/server";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const original = loader._load;
let actor = { ownerId: "owner-a", role: "owner", authKind: "session" };
let channelOwner = "owner-a";
let corrupt = false;
const content = { version: "workshop-design-snapshot/v1", name: "Draft", family: "narrated_stock", entries: [{ block: "script_gen", params: { count: 2 } }] };
const design = { ...content, fingerprint: sha256Hex(canonicalJson(content)) };
const candidate = { ownerId: "owner-a", channelId: "channel-a", sourceRunId: "run-a", entries: [{ block: "script_gen", version: "1", params: { count: 1 } }], workerDeployment: { version: "worker-1" } };
class AuthError extends Error { constructor(message: string, public status: number) { super(message); } }
class Client {
  async query(ref: Parameters<typeof getFunctionName>[0]) {
    const name = getFunctionName(ref);
    if (name === "channels:getChannel") return { ownerId: channelOwner };
    if (name === "workshopDesignImports:list") return [{ _id: "design-a", ownerId: "owner-a", design }];
    if (name === "retainedPipelineCandidates:list") return [{ ownerId: "owner-a", channelId: "channel-a", createdAt: 1, candidate, fingerprint: corrupt ? "invalid" : sha256Hex(canonicalJson(candidate)) }];
    throw new Error("unexpected query");
  }
}
loader._load = function(name, ...args) {
  if (name === "@/lib/operatorSession") return { StudioAuthError: AuthError, requireStudioActor: async () => actor };
  if (name === "@/lib/studioConvexAuth") return { issueStudioConvexToken: () => ({ token: "synthetic" }) };
  if (name === "@/lib/studioConvexHttpClient") return { StudioConvexHttpClient: Client };
  return original.call(this, name, ...args);
};
async function main() {
  process.env.YOUTUBE_AUTOMATION_PRIVATE = "1";
  process.env.NEXT_PUBLIC_CONVEX_URL = "http://127.0.0.1:39320";
  const { GET } = await import("./route");
  const get = (designId = "design-a") => GET(new Request(`http://localhost/api/workshop-design-evidence?channelId=channel-a&designId=${designId}`));
  const response = await get();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const result = await response.json();
  assert.equal(result.designFingerprint, design.fingerprint);
  assert.deepEqual(result.evidence[0].comparison.differences[0].changes, ["Version omitted", "Settings changed"]);
  assert.equal((await get("other")).status, 403);
  channelOwner = "owner-b";
  assert.equal((await get()).status, 403);
  channelOwner = "owner-a"; corrupt = true;
  assert.equal((await get()).status, 503);
  corrupt = false; actor = { ownerId: "owner-a", role: "viewer", authKind: "session" };
  assert.equal((await get()).status, 403);
  actor = { ownerId: "owner-a", role: "owner", authKind: "service" };
  assert.equal((await get()).status, 403);
  console.log("Workshop evidence comparison is owner-scoped and rejects invalid evidence");
}
main().finally(() => { loader._load = original; }).catch(error => { console.error(error); process.exitCode = 1; });
