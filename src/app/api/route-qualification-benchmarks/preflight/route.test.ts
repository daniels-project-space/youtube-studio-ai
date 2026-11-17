import assert from "node:assert/strict";
import Module from "node:module";

const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const original = loader._load;
let authorized = true;
let ownerId = "owner-a";
let assessments = 0;
class AuthError extends Error { status = 403; }
loader._load = function (name, ...args) {
  if (name === "@/lib/operatorSession") return { StudioAuthError: AuthError, requireStudioActor: async () => {
    if (!authorized) throw new AuthError("forbidden");
    return { ownerId: "owner-a" };
  } };
  if (name === "@/lib/studioConvexHttpClient") return { StudioConvexHttpClient: class {
    async query() { return { ownerId, pipeline: [] }; }
  } };
  if (name === "@/lib/privateBenchmarkPreflight") return { privateBenchmarkPreflight: () => {
    assessments++;
    return { blockers: ["fixture"], removedDeliveryBlocks: [], preflightReceiptChecked: false, providerReadinessChecked: false };
  } };
  return original.call(this, name, ...args);
};

async function main() {
  process.env.NEXT_PUBLIC_CONVEX_URL = "http://127.0.0.1:39320";
  const { GET } = await import("./route");
  const request = () => new Request("http://localhost/api/route-qualification-benchmarks/preflight?channelId=channel-a");
  authorized = false;
  assert.equal((await GET(request())).status, 403);
  authorized = true; ownerId = "another-owner";
  assert.equal((await GET(request())).status, 404);
  assert.equal(assessments, 0);
  ownerId = "owner-a";
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual((await response.json()).blockers, ["fixture"]);
  assert.equal(assessments, 1);
  console.log("Private benchmark preflight enforces owner access and performs no mutations");
}
main().finally(() => { loader._load = original; }).catch(error => { console.error(error); process.exitCode = 1; });
