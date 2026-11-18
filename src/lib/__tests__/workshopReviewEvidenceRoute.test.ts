import assert from "node:assert/strict";
import Module from "node:module";
import { getFunctionName } from "convex/server";

const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const original = loader._load;
let actor: { ownerId: string; role: string; authKind: string } | null = null;
let queries = 0;
class AuthError extends Error { constructor(message: string, readonly status = 401) { super(message); } }
class Client {
  constructor(_url: string, options: { auth: string }) { assert.equal(options.auth, "synthetic-owner-token"); }
  async query(ref: Parameters<typeof getFunctionName>[0], args: unknown) {
    queries++;
    assert.equal(getFunctionName(ref), "workshopReviewEvidence:list");
    assert.deepEqual(args, { ownerId: "owner", channelId: "channel", designFingerprint: "a".repeat(64) });
    return { reviews: [], benchmarks: [], comparisons: [] };
  }
}
loader._load = function(name, ...args) {
  if (name === "@/lib/operatorSession") return { requireStudioActor: async () => { if (!actor) throw new AuthError("authentication required"); return actor; }, StudioAuthError: AuthError };
  if (name === "@/lib/studioConvexAuth") return { issueStudioConvexToken: () => ({ token: "synthetic-owner-token" }) };
  if (name === "@/lib/studioConvexHttpClient") return { StudioConvexHttpClient: Client };
  return original.call(this, name, ...args);
};
async function main() {
  try {
    process.env.YOUTUBE_AUTOMATION_PRIVATE = "1";
    process.env.NEXT_PUBLIC_CONVEX_URL = "http://127.0.0.1:1";
    const { GET } = await import("../../app/api/workshop-review-evidence/route");
    const request = new Request(`http://localhost/api/workshop-review-evidence?channelId=channel&designFingerprint=${"a".repeat(64)}`);
    assert.equal((await GET(request)).status, 401);
    actor = { ownerId: "owner", role: "owner", authKind: "service" };
    assert.equal((await GET(request)).status, 403);
    actor.authKind = "session";
    process.env.YOUTUBE_AUTOMATION_PRIVATE = "0";
    assert.equal((await GET(request)).status, 403);
    assert.equal(queries, 0);
    process.env.YOUTUBE_AUTOMATION_PRIVATE = "1";
    const response = await GET(request);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { reviews: [], benchmarks: [], comparisons: [] });
    assert.equal(queries, 1);
    console.log("Private owner-only review evidence route passed");
  } finally { loader._load = original; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
