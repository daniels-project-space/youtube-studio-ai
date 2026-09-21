import assert from "node:assert/strict";
import Module from "node:module";
import { getFunctionName } from "convex/server";
import { createOperatorSessionToken } from "@/lib/operatorSession";
import { createMusicReviewContext } from "@/engine/acceptedMusicArrangement";
import { YUE2_AUDITION_CHECKS } from "@/engine/yue2Audition";

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
let recordedBasis: unknown;
const material = {
  listeningAudioKey: `owner/review-owner/runs/review-run/music/yue2-evaluation/audio-headroom-${"e".repeat(64)}.wav`,
  candidateSha256: "a".repeat(64),
  candidate: {
    jobId: `yue2-eval-${"d".repeat(64)}`, audioKey: "owner/review-owner/runs/review-run/music/yue2-evaluation/audio.wav",
    audioSha256: "f".repeat(64), headroom: { audioSha256: "e".repeat(64) },
    nativeOutput: { sampleRateHz: 48000, channels: 2, codec: "pcm_f32le", frames: 4800, durationSec: 0.1 },
    executionAccounting: { allocatedCostUsdMicros: 1001 },
    bindingKey: "private-binding-key", endpoint: "https://private-worker.invalid",
  },
  request: { acceptedArrangement: {
    topic: "Quiet overnight rain", sourceBriefFingerprint: "b".repeat(64), fingerprint: "c".repeat(64),
    reviewContext: undefined as ReturnType<typeof createMusicReviewContext> | undefined,
    arrangement: { direction: "Steady, no startling changes", requestedDurationSec: 60, sections: [{ id: "opening" }] },
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
      if (name === "yue2Auditions:latest") return null;
      if (name === "runs:getRun") { assert.deepEqual(input, { runId: "review-run" }); return run; }
      assert.equal(name, "channels:getChannel");
      assert.deepEqual(input, { channelId: "review-channel" });
      return channel;
    }
    async mutation(reference: Parameters<typeof getFunctionName>[0], input: { submission: unknown; sourceBasis?: unknown }) {
      assert.equal(getFunctionName(reference), "yue2Auditions:record"); calls.push("save-audition");
      recordedBasis = input.sourceBasis;
      return { ...input.submission as object, reviewedAt: 123, reviewerId: "review-owner", productionApproved: false,
        sourceApprovalFingerprint: input.sourceBasis ? "9".repeat(64) : null };
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
      assert.equal(key, material.listeningAudioKey, "sign the verified listening artifact, not the original clamped audio");
      assert.deepEqual(options, { bucket: "youtube-studio-ai-private", expiresIn: 600 });
      return "https://signed-fixture.invalid/native.wav";
    },
  };
  return originalLoad.call(this, id, ...args);
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET, POST } = require("./route") as typeof import("./route");

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
  assert.equal(body.review.brief.contextRetained, false);
  assert.equal(body.review.sourceApprovalAvailable, false);
  assert.equal(body.review.brief.reviewContext, null);
  assert.equal(body.review.allocation.providerBilledCostUsdMicros, null);
  assert.equal(body.review.nativeWavUrl, "https://signed-fixture.invalid/native.wav");
  assert.doesNotMatch(JSON.stringify(body), /private-binding-key|private-worker|audioKey|bindingKey/);
  assert.deepEqual(calls.slice(-5), ["runs:getRun", "channels:getChannel", "material", "yue2Auditions:latest", "presign"]);
  material.request.acceptedArrangement.reviewContext = createMusicReviewContext({
    topic: "Quiet overnight rain", family: "music_loop", channelName: "Night rain",
    promptContext: "Unhurried rainfall, restrained texture, no sudden changes.",
  });
  const withContext = await (await GET(request())).json();
  assert.deepEqual(withContext.review.brief.reviewContext, material.request.acceptedArrangement.reviewContext);
  assert.equal(withContext.review.brief.contextRetained, true);
  assert.equal(withContext.review.brief.channelPersonalityVerified, false, "retention is not a creative verdict");
  const audition = { candidateSha256: material.candidateSha256, verdict: "needs_work", listenedEntireSource: false,
    checks: Object.fromEntries(YUE2_AUDITION_CHECKS.map(key => [key, "unreviewed"])),
    sections: [{ id: "opening", judgment: "unreviewed", notes: "" }], notes: "Opening needs a closer listen." };
  const displayedReview: { fingerprint?: string } = {};
  const post = (patch: Record<string, unknown> = {}, origin = "https://studio.invalid") => POST(new Request("https://studio.invalid/api/yue2-evaluations/review", {
    method: "POST", headers: { cookie: `studio_session=${token}`, origin, "Content-Type": "application/json" },
    body: JSON.stringify({ runId: "review-run", audition: { ...audition, ...patch },
      ...(patch.verdict === "approved_for_assembly" ? { sourceApprovalBasisFingerprint: displayedReview.fingerprint } : {}) }),
  }));
  assert.equal((await post({}, "https://foreign.invalid")).status, 403);
  const beforeBodyFailures = calls.length;
  for (const [body, status] of [["{", 400], ["x".repeat(65537), 413]] as const) {
    const result = await POST(new Request("https://studio.invalid/api/yue2-evaluations/review", { method: "POST",
      headers: { cookie: `studio_session=${token}`, origin: "https://studio.invalid" }, body }));
    assert.equal(result.status, status);
  }
  assert.equal(calls.length, beforeBodyFailures, "body validation is bounded before database access");
  assert.equal((await post({ productionApproved: true })).status, 400);
  assert.equal((await post({ candidateSha256: "f".repeat(64) })).status, 409);
  assert.equal((await post({ verdict: "promising" })).status, 409);
  assert.equal((await post({ sections: [{ id: "foreign", judgment: "pass", notes: "Wrong section" }] })).status, 409);
  unavailable = true;
  assert.equal((await post()).status, 503);
  unavailable = false;
  assert.equal(calls.includes("save-audition"), false);
  const saved = await post();
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).audition.productionApproved, false);
  assert.deepEqual(calls.slice(-4), ["runs:getRun", "channels:getChannel", "material", "save-audition"]);
  const positive = { verdict: "approved_for_assembly", listenedEntireSource: true,
    checks: Object.fromEntries(YUE2_AUDITION_CHECKS.map(key => [key, "pass"])),
    sections: [{ id: "opening", judgment: "pass", notes: "Restrained texture fits the retained channel personality." }] };
  const saves = () => calls.filter(call => call === "save-audition").length;
  const beforeInvalidApprovals = saves();
  assert.equal((await post(positive)).status, 409, "blocked source cannot be approved");
  material.quality.status = "needs_audition";
  assert.equal((await post(positive)).status, 409, "a frozen invocation is required");
  run.pipelineInvocationSha256 = "8".repeat(64);
  const approvableReview = (await (await GET(request())).json()).review;
  assert.equal(approvableReview.sourceApprovalAvailable, true);
  assert.equal((await post(positive)).status, 409, "review confirmation cannot be omitted");
  displayedReview.fingerprint = approvableReview.sourceApprovalBasisFingerprint;
  run.pipelineInvocationSha256 = "7".repeat(64);
  assert.equal((await post(positive)).status, 409, "stale browser cannot approve a changed invocation");
  run.pipelineInvocationSha256 = "8".repeat(64);
  const context = material.request.acceptedArrangement.reviewContext;
  material.request.acceptedArrangement.reviewContext = undefined;
  assert.equal((await post(positive)).status, 409, "channel context cannot be waived");
  material.request.acceptedArrangement.reviewContext = context;
  assert.equal((await post({ ...positive, sourceBasis: {} })).status, 400);
  assert.equal((await post({ ...positive, sourceApprovalFingerprint: "9".repeat(64) })).status, 400);
  assert.equal(saves(), beforeInvalidApprovals);
  const approved = await post(positive);
  assert.equal(approved.status, 200);
  const approvedBody = await approved.json();
  assert.equal(approvedBody.audition.sourceApprovalFingerprint, "9".repeat(64));
  assert.equal(approvedBody.audition.productionApproved, false);
  assert.doesNotMatch(JSON.stringify(approvedBody), /listeningAudioKey|invocationSha256|owner\//u);
  assert.deepEqual(recordedBasis, {
    ownerId: "review-owner", channelId: "review-channel", runId: "review-run", invocationSha256: run.pipelineInvocationSha256,
    candidateSha256: material.candidateSha256, arrangementFingerprint: material.request.acceptedArrangement.fingerprint,
    jobId: material.candidate.jobId, listeningAudioKey: material.listeningAudioKey, listeningAudioSha256: "e".repeat(64),
    nativeFrames: 4800, sampleRateHz: 48000, channels: 2, sectionIds: ["opening"], technicalStatus: "needs_audition", contextRetained: true,
  });
  assert.equal((await post({ ...positive, verdict: "promising" })).status, 200);
  assert.equal(recordedBasis, undefined, "historical promising verdict is never source authority");
  console.log("YuE review route PASS: real session auth, ownership, private projection, server-bound source approval, no publishing authority");
}

main().finally(() => {
  loader._load = originalLoad;
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
}).catch((error) => { console.error(error); process.exitCode = 1; });
