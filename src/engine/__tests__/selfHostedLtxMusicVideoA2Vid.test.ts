import assert from "node:assert/strict";

import {
  SELF_HOSTED_LTX_A2VID_BENCHMARK_VERSION,
  SELF_HOSTED_LTX_A2VID_RESERVATION_VERSION,
  admitSelfHostedMusicVideoA2Vid,
  createMusicVideoA2VidRuntimeAdmission,
  createMusicVideoA2VidAudioSegment,
  createMusicVideoA2VidBenchmark,
  createMusicVideoA2VidReferenceImage,
  createMusicVideoA2VidRuntimePin,
  musicVideoA2VidWorkerProfile,
  musicVideoA2VidSpendIntentFingerprint,
  selfHostedMusicVideoA2VidStudioReadiness,
} from "@/engine/selfHostedLtxMusicVideoA2Vid";

const digest = (character: string) => character.repeat(64);
const revision = (character: string) => character.repeat(40);

const audioSegment = createMusicVideoA2VidAudioSegment({
  version: "self-hosted-ltx-a2vid-audio-segment/v1",
  sourceMusicKey: "owners/owner-a/runs/run-a/music/master.wav",
  sourceMusicSha256: digest("a"),
  sourceMusicReceiptFingerprint: digest("b"),
  contentType: "audio/wav",
  sourceDurationMs: 180_000,
  startMs: 24_000,
  endMs: 34_000,
});

const openingReference = createMusicVideoA2VidReferenceImage({
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
    { id: "a2vid-transformer", path: "a2vid/a2vid-transformer.safetensors", sha256: digest("4"), sizeBytes: 1_000 },
    { id: "a2vid-text-encoder", path: "a2vid/a2vid-text-encoder.safetensors", sha256: digest("5"), sizeBytes: 1_001 },
    { id: "a2vid-video-vae", path: "a2vid/a2vid-video-vae.safetensors", sha256: digest("6"), sizeBytes: 1_002 },
    { id: "a2vid-audio-vae", path: "a2vid/a2vid-audio-vae.safetensors", sha256: digest("7"), sizeBytes: 1_003 },
    { id: "a2vid-spatial-upscaler", path: "a2vid/a2vid-spatial-upscaler.safetensors", sha256: digest("8"), sizeBytes: 1_004 },
    { id: "a2vid-stage2-distilled-lora", path: "a2vid/a2vid-stage2-distilled-lora.safetensors", sha256: digest("9"), sizeBytes: 1_005 },
  ],
  pipelineRepository: "Lightricks/LTX-2",
  pipelineImmutableRevision: revision("3"),
  pipeline: "a2vid_two_stage",
  supportsApprovedReferenceImages: true,
});

const workerProfile = musicVideoA2VidWorkerProfile(runtime);
assert.equal(workerProfile.pipeline, "a2vid_two_stage");
assert.equal(workerProfile.components.length, 6);
assert.equal(workerProfile.components[0]?.id, "a2vid-transformer");
assert.equal(workerProfile.licenseReceiptFingerprint, runtime.licenseReceiptFingerprint);

const benchmark = createMusicVideoA2VidBenchmark({
  version: SELF_HOSTED_LTX_A2VID_BENCHMARK_VERSION,
  benchmarkId: "ltx-a2vid-rhythm-reference-001",
  runtimeFingerprint: runtime.fingerprint,
  referenceConditioningVerdict: "pass",
  musicMotionAlignmentVerdict: "pass",
  temporalStabilityVerdict: "pass",
  outputVideoSha256: digest("4"),
  outputReceiptFingerprint: digest("5"),
  visualReviewReceiptFingerprint: digest("6"),
  matchedComparison: {
    version: "music-video-render-comparison/v1",
    testInputFingerprint: digest("9"),
    baseline: {
      strategy: "existing_image_to_video",
      outputVideoSha256: digest("a"),
      visualReviewReceiptFingerprint: digest("b"),
      visualQualityScore: 8.2,
      musicMotionAlignmentScore: 7.8,
      referenceContinuityScore: 8.1,
      temporalStabilityScore: 8.0,
    },
    a2vid: {
      strategy: "ltx_a2vid",
      outputVideoSha256: digest("4"),
      visualReviewReceiptFingerprint: digest("6"),
      visualQualityScore: 8.5,
      musicMotionAlignmentScore: 8.3,
      referenceContinuityScore: 8.2,
      temporalStabilityScore: 8.2,
    },
  },
  reviewedBy: "operator-a",
  reviewedAt: "2026-08-23T16:00:00.000Z",
});

const runtimeAdmission = createMusicVideoA2VidRuntimeAdmission({
  version: "self-hosted-ltx-a2vid-runtime-admission/v1",
  runtime,
  benchmark,
  admittedBy: "operator-a",
  admittedAt: "2026-08-23T16:05:00.000Z",
});

const unattestedStudioReadiness = selfHostedMusicVideoA2VidStudioReadiness();
assert.equal(unattestedStudioReadiness.status, "not_installed");
const benchmarkedStudioReadiness = selfHostedMusicVideoA2VidStudioReadiness({
  activeRuntimeAdmissions: [runtimeAdmission],
});
assert.equal(benchmarkedStudioReadiness.status, "benchmark_admitted");
assert.equal(benchmarkedStudioReadiness.activeBenchmark?.runtimeFingerprint, runtime.fingerprint);
assert.equal(benchmarkedStudioReadiness.activeBenchmark?.benchmarkFingerprint, benchmark.fingerprint);
assert.match(benchmarkedStudioReadiness.requirements[0] ?? "", /mastered-music/i);

assert.throws(
  () => {
    const { fingerprint, ...benchmarkCore } = benchmark;
    assert.ok(fingerprint, "fixture benchmark must be sealed before cross-runtime checks");
    const mismatchedRuntimeBenchmark = createMusicVideoA2VidBenchmark({
      ...benchmarkCore,
      runtimeFingerprint: digest("f"),
    });
    return createMusicVideoA2VidRuntimeAdmission({
      version: "self-hosted-ltx-a2vid-runtime-admission/v1",
      runtime,
      benchmark: mismatchedRuntimeBenchmark,
      admittedBy: "operator-a",
      admittedAt: "2026-08-23T16:05:00.000Z",
    });
  },
  /does not bind the exact pinned runtime/i,
  "a Studio runtime admission must not reuse a benchmark from a different open-weight LTX runtime",
);

const spendIntentFingerprint = musicVideoA2VidSpendIntentFingerprint({
  audioSegment,
  referenceImages: [openingReference],
  runtime,
  benchmark,
});

const reservation = {
  version: SELF_HOSTED_LTX_A2VID_RESERVATION_VERSION,
  reservationId: "a2vid-reservation-001",
  spendIntentFingerprint,
  budgetLedgerFingerprint: digest("7"),
  reservationReceiptFingerprint: digest("8"),
  reservedCents: 120,
  spendCapCents: 150,
  status: "held" as const,
};

const ready = admitSelfHostedMusicVideoA2Vid({
  audioSegment,
  referenceImages: [openingReference],
  runtime,
  benchmark,
  reservation,
});
assert.equal(ready.status, "ready");
if (ready.status === "ready") {
  assert.equal(ready.workOrder.audioSegment.sourceMusicSha256, digest("a"));
  assert.equal(ready.workOrder.referenceImages[0]?.role, "opening");
  assert.equal(ready.workOrder.runtime.executionPath, "dedicated_self_hosted_ltx_a2vid");
  assert.ok(!("sourceAudioBytes" in (ready.workOrder as unknown as Record<string, unknown>)));
}

const noRuntime = admitSelfHostedMusicVideoA2Vid({ audioSegment, referenceImages: [openingReference] });
assert.equal(noRuntime.status, "blocked");
if (noRuntime.status === "blocked") assert.ok(noRuntime.blockers.some((blocker) => /dedicated self-hosted/i.test(blocker)));

const directWorker = admitSelfHostedMusicVideoA2Vid({
  audioSegment,
  referenceImages: [openingReference],
  runtime: {
    ...runtime,
    executionPath: "novita_direct_ltx_pipelines" as never,
  },
  benchmark,
  reservation,
});
assert.equal(directWorker.status, "blocked");
if (directWorker.status === "blocked") assert.ok(directWorker.blockers.some((blocker) => /dedicated self-hosted Novita worker/i.test(blocker)));

const mismatchedReservation = admitSelfHostedMusicVideoA2Vid({
  audioSegment,
  referenceImages: [openingReference],
  runtime,
  benchmark,
  reservation: { ...reservation, spendIntentFingerprint: digest("9") },
});
assert.equal(mismatchedReservation.status, "blocked");
if (mismatchedReservation.status === "blocked") assert.ok(mismatchedReservation.blockers.some((blocker) => /reservation/i.test(blocker)));

assert.throws(
  () => createMusicVideoA2VidAudioSegment({ ...audioSegment, startMs: 0, endMs: 1_000 }),
  /2–20 second/i,
  "a full or tiny music master cannot be silently used as an A2Vid clip input",
);
assert.throws(
  () => createMusicVideoA2VidReferenceImage({ ...openingReference, role: "middle" as never }),
  /opening or ending/i,
);
assert.throws(
  () => {
    const { fingerprint, ...runtimeCore } = runtime;
    assert.ok(fingerprint, "fixture runtime must be sealed before tamper checks");
    return createMusicVideoA2VidRuntimePin({
      ...runtimeCore,
      components: [...runtime.components].reverse(),
    });
  },
  /component 0 must be a2vid-transformer/i,
  "the control plane cannot reorder or substitute the worker's sealed A2Vid component set",
);

assert.throws(
  () => {
    const { fingerprint, ...benchmarkCore } = benchmark;
    assert.ok(fingerprint, "fixture benchmark must be sealed before tamper checks");
    return createMusicVideoA2VidBenchmark({
    ...benchmarkCore,
    matchedComparison: {
      ...benchmark.matchedComparison,
      a2vid: {
        ...benchmark.matchedComparison.a2vid,
        musicMotionAlignmentScore: benchmark.matchedComparison.baseline.musicMotionAlignmentScore,
      },
    },
  });
  },
  /material music-motion improvement/i,
  "A2Vid is not admitted merely for matching the old visual path; it must improve music-motion on the same test input",
);

assert.throws(
  () => {
    const { fingerprint, ...benchmarkCore } = benchmark;
    assert.ok(fingerprint, "fixture benchmark must be sealed before tamper checks");
    return createMusicVideoA2VidBenchmark({
    ...benchmarkCore,
    matchedComparison: {
      ...benchmark.matchedComparison,
      a2vid: {
        ...benchmark.matchedComparison.a2vid,
        outputVideoSha256: digest("f"),
      },
    },
  });
  },
  /same reviewed A2Vid output/i,
  "the paired comparison must bind the benchmark's exact output and reviewer receipt",
);

console.log("SELF-HOSTED LTX A2VID MUSIC-VIDEO CONTRACT TESTS PASS");
