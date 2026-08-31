import assert from "node:assert/strict";

import {
  SELF_HOSTED_LTX_A2VID_BENCHMARK_VERSION,
  SELF_HOSTED_LTX_A2VID_RESERVATION_VERSION,
  admitSelfHostedMusicVideoA2Vid,
  createMusicVideoA2VidAudioSegment,
  createMusicVideoA2VidBenchmark,
  createMusicVideoA2VidReferenceImage,
  createMusicVideoA2VidRuntimePin,
  musicVideoA2VidWorkerProfile,
  musicVideoA2VidSpendIntentFingerprint,
} from "@/engine/selfHostedLtxMusicVideoA2Vid";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { createSelfHostedLtxA2VidWorkerManifest, selfHostedLtxA2VidManifestId } from "@/lib/selfHostedLtxA2VidManifest";

const digest = (letter: string) => letter.repeat(64);
const revision = (letter: string) => letter.repeat(40);

const audioSegment = createMusicVideoA2VidAudioSegment({
  version: "self-hosted-ltx-a2vid-audio-segment/v1",
  sourceMusicKey: "owners/owner-a/runs/run-a/music/master.wav",
  sourceMusicSha256: digest("a"),
  sourceMusicReceiptFingerprint: digest("b"),
  contentType: "audio/wav",
  sourceDurationMs: 180_000,
  startMs: 0,
  endMs: 4_840,
});
const opening = createMusicVideoA2VidReferenceImage({
  version: "self-hosted-ltx-a2vid-reference/v1",
  role: "opening",
  r2Key: "owners/owner-a/studio-assets/music-video/opening.png",
  contentSha256: digest("c"),
  byteLength: 2_048,
  contentType: "image/png",
  approvedAssetFingerprint: digest("d"),
});
const runtime = createMusicVideoA2VidRuntimePin({
  version: "self-hosted-ltx-a2vid-runtime/v2",
  provider: "novita",
  executionPath: "dedicated_self_hosted_ltx_a2vid",
  workerImage: `ghcr.io/daniels-project-space/ltx-a2vid@sha256:${digest("e")}`,
  workerOverlaySha256: digest("f"),
  requiredGpuSku: "RTX 4090",
  minimumVramGb: 24,
  modelRepository: "Lightricks/LTX-2.5",
  modelImmutableRevision: revision("1"),
  modelSha256: digest("2"),
  licenseReceiptFingerprint: digest("3"),
  components: [
    { id: "a2vid-transformer", path: "a2vid/transformer.safetensors", sha256: digest("4"), sizeBytes: 1_000 },
    { id: "a2vid-text-encoder", path: "a2vid/text-encoder.safetensors", sha256: digest("5"), sizeBytes: 1_001 },
    { id: "a2vid-video-vae", path: "a2vid/video-vae.safetensors", sha256: digest("6"), sizeBytes: 1_002 },
    { id: "a2vid-audio-vae", path: "a2vid/audio-vae.safetensors", sha256: digest("7"), sizeBytes: 1_003 },
    { id: "a2vid-spatial-upscaler", path: "a2vid/upscaler.safetensors", sha256: digest("8"), sizeBytes: 1_004 },
    { id: "a2vid-stage2-distilled-lora", path: "a2vid/stage-two.safetensors", sha256: digest("9"), sizeBytes: 1_005 },
  ],
  pipelineRepository: "Lightricks/LTX-2",
  pipelineImmutableRevision: revision("3"),
  pipeline: "a2vid_two_stage",
  supportsApprovedReferenceImages: true,
});
const benchmark = createMusicVideoA2VidBenchmark({
  version: SELF_HOSTED_LTX_A2VID_BENCHMARK_VERSION,
  benchmarkId: "a2vid-fixture-benchmark",
  runtimeFingerprint: runtime.fingerprint,
  referenceConditioningVerdict: "pass",
  musicMotionAlignmentVerdict: "pass",
  temporalStabilityVerdict: "pass",
  outputVideoSha256: digest("a"),
  outputReceiptFingerprint: digest("b"),
  visualReviewReceiptFingerprint: digest("c"),
  matchedComparison: {
    version: "music-video-render-comparison/v1",
    testInputFingerprint: digest("d"),
    baseline: { strategy: "existing_image_to_video", outputVideoSha256: digest("e"), visualReviewReceiptFingerprint: digest("f"), visualQualityScore: 8, musicMotionAlignmentScore: 7.5, referenceContinuityScore: 8, temporalStabilityScore: 8 },
    a2vid: { strategy: "ltx_a2vid", outputVideoSha256: digest("a"), visualReviewReceiptFingerprint: digest("c"), visualQualityScore: 8.1, musicMotionAlignmentScore: 8, referenceContinuityScore: 8, temporalStabilityScore: 8 },
  },
  reviewedBy: "operator-a",
  reviewedAt: "2026-08-23T16:00:00.000Z",
});
const spendIntentFingerprint = musicVideoA2VidSpendIntentFingerprint({ audioSegment, referenceImages: [opening], runtime, benchmark });
const admitted = admitSelfHostedMusicVideoA2Vid({
  audioSegment,
  referenceImages: [opening],
  runtime,
  benchmark,
  reservation: { version: SELF_HOSTED_LTX_A2VID_RESERVATION_VERSION, reservationId: "a2vid-manifest-reservation", spendIntentFingerprint, budgetLedgerFingerprint: digest("d"), reservationReceiptFingerprint: digest("e"), reservedCents: 90, spendCapCents: 100, status: "held" },
});
assert.equal(admitted.status, "ready");
if (admitted.status !== "ready") throw new Error("fixture must be admitted");

const manifestId = selfHostedLtxA2VidManifestId({ workOrder: admitted.workOrder, runId: "run-a", outputKey: "owners/owner-a/runs/run-a/a2vid/benchmark.mp4" });
const common = {
  workOrder: admitted.workOrder,
  manifestId,
  expiresAt: Date.now() + 120_000,
  maxCostUsd: 1.5,
  maxRuntimeSeconds: 600,
  seed: 42,
  prompt: "A rhythmic slow dolly through a luminous architectural music world",
  audio: { r2Key: audioSegment.sourceMusicKey, getUrl: "https://objects.example/music.wav", sha256: audioSegment.sourceMusicSha256, contentType: audioSegment.contentType, startMs: audioSegment.startMs, endMs: audioSegment.endMs },
  references: [{ r2Key: opening.r2Key, getUrl: "https://objects.example/opening.png", sha256: opening.contentSha256, contentType: opening.contentType }],
  checkpoint: { getUrl: "https://objects.example/checkpoint.json", putUrl: "https://objects.example/checkpoint.json?write=1" },
  heartbeat: { putUrl: "https://objects.example/heartbeat.json" },
  completion: { putUrl: "https://objects.example/completion.json" },
};

// Derive the profile hash through the public builder's same pure fields so the
// artifact URL contract can be represented without a provider.
const resolvedProfileHash = sha256Hex(canonicalJson(musicVideoA2VidWorkerProfile(runtime)));
const artifact = {
  putUrl: "https://objects.example/output.mp4",
  contentType: "video/mp4" as const,
  headers: {
    "x-amz-meta-manifest-id": manifestId,
    "x-amz-meta-profile-sha256": resolvedProfileHash,
    "x-amz-meta-job-id": "a2vid-benchmark",
  },
};
const manifest = createSelfHostedLtxA2VidWorkerManifest({ ...common, artifact });
assert.equal(manifest.phase, "audio_video");
assert.equal(manifest.models.length, 6);
assert.equal(manifest.jobs[0].audio.sha256, audioSegment.sourceMusicSha256);
assert.equal(manifest.jobs[0].openingInput?.sha256, opening.contentSha256);
assert.equal(manifest.manifestId, manifestId);

assert.throws(
  () => createSelfHostedLtxA2VidWorkerManifest({ ...common, audio: { ...common.audio, sha256: digest("f") }, artifact }),
  /does not match the sealed mastered-music segment/i,
  "a presigned URL cannot swap the mastered audio after admission",
);
assert.throws(
  () => createSelfHostedLtxA2VidWorkerManifest({ ...common, references: [], artifact }),
  /reference count/i,
  "approved references cannot disappear between the Studio work order and the worker manifest",
);
assert.throws(
  () => createSelfHostedLtxA2VidWorkerManifest({ ...common, artifact: { ...artifact, headers: { ...artifact.headers, "x-amz-meta-job-id": "other-job" } } }),
  /headers do not bind/i,
  "delivery URLs must remain bound to the one sealed worker job",
);

console.log("SELF-HOSTED LTX A2VID MANIFEST TESTS PASS");
