import assert from "node:assert/strict";
import Module from "node:module";

const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const original = loader._load;
let owner = "owner-a", mutations = 0;
class AuthError extends Error { constructor(message: string, public status: number) { super(message); } }
class Client {
  async query(_reference: unknown, args: Record<string, unknown>) {
    return "channelId" in args && !("ownerId" in args) ? { ownerId: owner, pipeline: [{ block: "quote_overlays", params: { maxQuotes: 2 } }], moduleConfig: { quote_overlays: { maxQuotes: 5 } } } : [];
  }
  async mutation() { mutations++; return { id: "candidate", fingerprint: "fingerprint", reused: false }; }
}
loader._load = function(name, ...args) {
  if (name === "@/lib/operatorSession") return { StudioAuthError: AuthError, requireStudioActor: async () => ({ ownerId: "owner-a" }) };
  if (name === "@/lib/studioConvexHttpClient") return { StudioConvexHttpClient: Client };
  return original.call(this, name, ...args);
};
async function main() {
  process.env.YOUTUBE_AUTOMATION_PRIVATE = "1";
  process.env.NEXT_PUBLIC_CONVEX_URL = "http://127.0.0.1:39320";
  const { GET, POST } = await import("./route");
  const get = () => GET(new Request("http://localhost/api/retained-pipeline-candidates?channelId=channel-a"));
  const post = (body: unknown) => POST(new Request("http://localhost/api/retained-pipeline-candidates", { method: "POST", body: JSON.stringify(body) }));
  const body = { channelId: "channel-a", runId: "run-a", receiptId: "receipt-a" };
  const result = await get();
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  const evidence = await result.json();
  assert.equal(evidence.evidenceOnly, true);
  assert.deepEqual(evidence.candidates, []);
  assert.equal(evidence.comparisonPipeline[0].params.maxQuotes, 5);
  assert.equal((await post({ ...body, activate: true })).status, 400);
  owner = "other-owner";
  assert.equal((await get()).status, 403);
  assert.equal((await post(body)).status, 403);
  assert.equal(mutations, 0);
  owner = "owner-a";
  assert.equal((await post(body)).status, 200);
  assert.equal(mutations, 1);
  process.env.YOUTUBE_AUTOMATION_PRIVATE = "0";
  assert.equal((await post(body)).status, 403);
  assert.equal(mutations, 1);
  console.log("Candidate evidence API enforces owner scope, private mode and evidence-only inputs");
}
main().finally(() => { loader._load = original; }).catch(error => { console.error(error); process.exitCode = 1; });
