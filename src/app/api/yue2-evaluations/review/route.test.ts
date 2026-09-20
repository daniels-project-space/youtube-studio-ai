import assert from "node:assert/strict";
import Module from "node:module";
import { getFunctionName } from "convex/server";
import { createOperatorSessionToken } from "@/lib/operatorSession";

const env = { ...process.env };
process.env.STUDIO_OWNER_ID = "review-owner";
process.env.STUDIO_SESSION_SECRET = Buffer.alloc(32, 7).toString("base64");
process.env.NEXT_PUBLIC_CONVEX_URL = "https://review-fixture.convex.cloud";
delete process.env.STUDIO_INTERNAL_API_TOKEN;

let run: Record<string, unknown> | null = { _id: "review-run", ownerId: "review-owner", channelId: "review-channel" };
let channel: Record<string, unknown> | null = { _id: "review-channel", ownerId: "review-owner" };
let unavailable = false;
let absent = false;
const calls: string[] = [];
const material = {
  candidateSha256: "a".repeat(64),
  candidate: {
    jobId: "job", audioKey: "owner/review-owner/runs/review-run/music/yue2-evaluation/audio.wav",
    nativeOutput: { sampleRateHz: 48000, channels: 2, codec: "pcm_f32le", frames: 4800, durationSec: 0.1 },
    executionAccounting: { allocatedCostUsdMicros: 1001 },
    bindingKey: "private-binding-key", endpoint: "https://private-worker.invalid",
  },
  request: { acceptedArrangement: {
    topic: "Quiet overnight rain", sourceBriefFingerprint: "b".repeat(64),
    arrangement: { direction: "Steady, no startling changes", requestedDurationSec: 60 },
  } },
  quality: { status: "blocked", durationMatches: false, productionApproved: false },
};
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (id, ...args) {
  if (id.endsWith("/studioConvexHttpClient")) return { StudioConvexHttpClient: class {
    async query(reference: Parameters<typeof getFunctionName>[0], input: unknown) {
      const name = getFunctionName(reference);
      calls.push(name);
      if (name === "runs:getRun") { assert.deepEqual(input, { runId: "review-run" }); return run; }
      assert.equal(name, "channels:getChannel");
      assert.deepEqual(input, { channelId: "review-channel" });
      return channel;
    }
  } };
  if (id.endsWith("/yue2DurableEvaluation")) return {
    readDurableYuE2Candidate: async (scope: unknown) => {
      calls.push("material");
      assert.deepEqual(scope, { ownerId: "review-owner", channelId: "review-channel", runId: "review-run" });
      if (unavailable) throw new Error("private-worker credential private-binding-key");
      return absent ? null : material;
    },
  };
  if (id.endsWith("/storage")) return {
    presignDownload: async (key: string, options: unknown) => {
      calls.push("presign");
      assert.equal(key, material.candidate.audioKey);
      assert.deepEqual(options, { expiresIn: 600 });
      return "https://signed-fixture.invalid/native.wav";
    },
  };
  return originalLoad.call(this, id, ...args);
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET } = require("./route") as typeof import("./route");

async function main() {
  const token = await createOperatorSessionToken();
  const request = (query = "runId=review-run", authenticated = true) => new Request(
    `https://studio.invalid/api/yue2-evaluations/review?${query}`,
    { headers: authenticated ? { cookie: `studio_session=${token}` } : {} },
  );
  assert.equal((await GET(request(undefined, false))).status, 401);
  assert.equal((await GET(request("runId=../other"))).status, 400);
  assert.equal(calls.length, 0, "authentication and input validation precede all data access");
  run = null;
  assert.equal((await GET(request())).status, 404);
  run = { _id: "review-run", ownerId: "other-owner", channelId: "review-channel" };
  assert.equal((await GET(request())).status, 404);
  run.ownerId = "review-owner";
  channel = { _id: "review-channel", ownerId: "other-owner" };
  assert.equal((await GET(request())).status, 404);
  assert.ok(!calls.includes("material") && !calls.includes("presign"));
  channel.ownerId = "review-owner";
  absent = true;
  let response = await GET(request());
  assert.deepEqual(await response.json(), { ok: true, review: null });
  assert.ok(!calls.includes("presign"));
  absent = false; unavailable = true;
  response = await GET(request());
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private-worker|credential|private-binding-key/);
  assert.ok(!calls.includes("presign"));
  unavailable = false;
  response = await GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.review.candidateSha256, material.candidateSha256);
  assert.equal(body.review.quality.status, "blocked");
  assert.equal(body.review.brief.channelPersonalityVerified, false);
  assert.equal(body.review.allocation.providerBilledCostUsdMicros, null);
  assert.equal(body.review.nativeWavUrl, "https://signed-fixture.invalid/native.wav");
  assert.doesNotMatch(JSON.stringify(body), /private-binding-key|private-worker|audioKey|bindingKey/);
  assert.deepEqual(calls.slice(-4), ["runs:getRun", "channels:getChannel", "material", "presign"]);
  console.log("YuE review route PASS: real session auth, ownership, verified-material-only signing, private projection, no approval");
}

main().finally(() => {
  loader._load = originalLoad;
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
}).catch((error) => { console.error(error); process.exitCode = 1; });
