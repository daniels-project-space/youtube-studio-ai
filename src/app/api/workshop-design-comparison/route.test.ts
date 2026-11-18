import assert from "node:assert/strict";
import Module from "node:module";
import { contentLaneForFamily } from "@/engine/contentLane";

const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const original = loader._load;
let actor = { ownerId: "owner-a", role: "owner", authKind: "session" };
let channelOwner = "owner-a";
let reads = 0;
let moduleConfig: unknown = { quote_overlays: { maxQuotes: 5 } };
let family: string | null = "narrated_stock";
let contentLane: unknown;
class AuthError extends Error { constructor(message: string, public status: number) { super(message); } }
class Client {
  async query() {
    reads++;
    return { ownerId: channelOwner, family, contentLane, pipeline: [{ block: "quote_overlays", version: "1", params: { maxQuotes: 2 } }, { block: "quote_overlays", version: "2", params: { maxQuotes: 3 } }], moduleConfig };
  }
}
loader._load = function(name, ...args) {
  if (name === "@/lib/operatorSession") return { StudioAuthError: AuthError, requireStudioActor: async () => actor };
  if (name === "@/lib/studioConvexHttpClient") return { StudioConvexHttpClient: Client };
  return original.call(this, name, ...args);
};
async function main() {
  process.env.YOUTUBE_AUTOMATION_PRIVATE = "1";
  process.env.NEXT_PUBLIC_CONVEX_URL = "http://127.0.0.1:39320";
  const { GET } = await import("./route");
  const get = (id = "channel-a") => GET(new Request(`http://localhost/api/workshop-design-comparison?channelId=${id}`));
  const response = await get();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const baseline = await response.json();
  assert.equal(baseline.family, "narrated_stock");
  assert.match(baseline.comparisonFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(baseline.comparisonPipeline[0].params.maxQuotes, 5);
  assert.equal(baseline.comparisonPipeline[1].params.maxQuotes, 5);
  assert.deepEqual(baseline.comparisonPipeline.map((entry: { version: string }) => entry.version), ["1", "2"]);
  moduleConfig = undefined;
  const changed = await (await get()).json();
  assert.deepEqual(changed.comparisonPipeline.map((entry: { params: { maxQuotes: number } }) => entry.params.maxQuotes), [3, 3]);
  assert.notEqual(changed.comparisonFingerprint, baseline.comparisonFingerprint);
  family = null;
  contentLane = contentLaneForFamily("music_loop");
  const laneOnly = await (await get()).json();
  assert.equal(laneOnly.family, "music_loop");
  assert.equal(laneOnly.familyWarning, null);
  assert.match(laneOnly.comparisonFingerprint, /^[a-f0-9]{64}$/);
  family = "narrated_stock";
  const conflict = await (await get()).json();
  assert.equal(conflict.family, null);
  assert.match(conflict.familyWarning, /could not be verified/);
  assert.equal(conflict.comparisonFingerprint, null);
  assert.ok(Array.isArray(conflict.comparisonPipeline));
  family = null; contentLane = undefined;
  const missing = await (await get()).json();
  assert.equal(missing.family, null);
  assert.match(missing.familyWarning, /could not be verified/);
  assert.equal(missing.comparisonFingerprint, null);
  channelOwner = "owner-b";
  assert.equal((await get()).status, 403);
  actor = { ownerId: "owner-a", role: "owner", authKind: "service" };
  assert.equal((await get()).status, 403);
  assert.equal(reads, 6);
  console.log("Import comparison resolves saved overrides and enforces owner session and channel ownership");
}
main().finally(() => { loader._load = original; }).catch(error => { console.error(error); process.exitCode = 1; });
