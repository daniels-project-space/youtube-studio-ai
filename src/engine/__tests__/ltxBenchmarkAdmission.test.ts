import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { generationProfile } from "@/engine/generationProfiles";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { ltx25Native720X2SmokeProfile } from "../../../scripts/lib/ltx25BenchmarkSmokeProfile.mjs";
import {
  LTX_25_IMMUTABLE_BENCHMARK_REPORT_PROOF_CONTRACT,
  LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE,
  LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE_FINGERPRINT,
  LTX_25_NATIVE_720P_X2_BENCHMARK_REPORT_CONTRACT,
  LTX_BENCHMARK_REVIEW_CONTRACT,
  LTX_BENCHMARK_REVIEW_EVIDENCE_CONTRACT,
  MANUAL_LTX_BENCHMARK_RELEASE_APPROVAL_CONTRACT,
  RELEASE_CONTROLLED_REVIEWED_LTX_BENCHMARK_REGISTRY,
  REVIEWED_LTX_BENCHMARK_ADMISSION_CONTRACT,
  assessLtx25Native720pX2BenchmarkProfile,
  deriveImmutableLtxBenchmarkReportProof,
  assertImmutableLtxBenchmarkReportProof,
  assertReviewedLtxBenchmarkAdmission,
  ltx25Native720pX2BenchmarkProfileFingerprint,
  ltxBenchmarkReportProofFingerprint,
  resolveReviewedLtxBenchmarkRegistry,
  reviewedLtxBenchmarkAdmissionFingerprint,
  type ImmutableLtxBenchmarkReportProof,
  type ImmutableLtxBenchmarkReportProofCore,
  type ReviewedLtxBenchmarkAdmission,
  type ReviewedLtxBenchmarkAdmissionCore,
} from "@/engine/ltxBenchmarkAdmission";
import {
  NOVITA_LOCKED_VIDEO_RUNTIME,
  assessNovitaVideoProfileRuntime,
  novitaVideoProfileIdentity,
} from "@/engine/runtimeCapability";
import { reviewedLtxRuntimeTarget } from "@/engine/reviewedLtxRuntimeTarget";
import { familyProductionReadiness } from "@/engine/families";
import { certifiedFamilyAdmission } from "@/engine/certifiedFamilyAdmission";
import { formatPreflight } from "@/engine/creative/selectFormat";

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const HEX_C = "c".repeat(64);
const RELEASE_REVISION = "d".repeat(40);

function reportProofCore(): ImmutableLtxBenchmarkReportProofCore {
  return {
    contract: LTX_25_IMMUTABLE_BENCHMARK_REPORT_PROOF_CONTRACT,
    reportContract: LTX_25_NATIVE_720P_X2_BENCHMARK_REPORT_CONTRACT,
    reportKey: "novita/benchmarks/ltx-2.5-720p-native-x2-smoke/0123456789abcdef01234567/report.json",
    immutableObjectVersionId: "r2-version-20260821-0001",
    reportContentSha256: HEX_A,
    reportSha256: HEX_B,
    terminalStatus: "complete",
    profileFingerprint: LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE_FINGERPRINT,
    outputProofSha256: HEX_C,
    outputCount: 1,
    outputId: "mannequin-archive",
    outputKey: "novita/benchmarks/ltx-2.5-720p-native-x2-smoke/0123456789abcdef01234567/video/outputs/mannequin-archive.mp4",
    outputVideoSha256: HEX_A,
  };
}

function reportProof(): ImmutableLtxBenchmarkReportProof {
  const core = reportProofCore();
  return {
    ...core,
    proofFingerprint: ltxBenchmarkReportProofFingerprint(core),
  };
}

function terminalReport(): Record<string, unknown> {
  const profile = LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE;
  const benchmarkRoot = "novita/benchmarks/ltx-2.5-720p-native-x2-smoke/0123456789abcdef01234567";
  const core = {
    contract: LTX_25_NATIVE_720P_X2_BENCHMARK_REPORT_CONTRACT,
    ok: true,
    status: "complete",
    nonce: "0123456789abcdef01234567",
    ltxModelManifestKey: "novita/model-manifests/ltx-2.5-acde-1234.json",
    stageMaxUsd: 0.68,
    spotRateUsdPerHour: 0.17,
    phaseMaxSeconds: 1_800,
    zImage: {
      model: "Tongyi-MAI/Z-Image-Turbo",
      revision: "f332072aa78be7aecdf3ee76d5c247082da564a6",
      volumeReceipt: {
        contract: "zimage-volume-probe/v1",
        ok: true,
        sourcePath: "models/z-image",
        manifestSha256: HEX_A,
        fileCount: 5,
      },
    },
    ltx: {
      model: profile.model,
      revision: profile.revision,
      runtimeRepository: profile.runtimeRepository,
      runtimeRevision: profile.runtimeRevision,
      runtimeBundleKey: profile.runtimeBundleKey,
      runtimeBundleSha256: profile.runtimeBundleSha256,
      workerImage: profile.workerImage,
      gpuSku: profile.gpuSku,
      gpuCount: 1,
      vramGb: profile.vramGb,
      checkpoint: profile.checkpoint,
      textEncoderCheckpoint: profile.textEncoderCheckpoint,
      videoVaeCheckpoint: profile.videoVaeCheckpoint,
      audioVaeCheckpoint: profile.audioVaeCheckpoint,
      spatialUpscalerCheckpoint: profile.spatialUpscalerCheckpoint,
      pipeline: profile.pipeline,
      stageOne: `${profile.stageOneWidth}x${profile.stageOneHeight}`,
      output: `${profile.outputWidth}x${profile.outputHeight}@${profile.fps}`,
      frames: profile.frameCount,
      steps: profile.steps,
      guidanceScale: profile.guidanceScale,
      precision: profile.precision,
      twoStageRefine: profile.twoStageRefine,
      spatialUpscaleFactor: profile.spatialUpscaleFactor,
      quantization: profile.quantization,
      offload: profile.offload,
      maxSampledPeakVramMib: 22_000,
      workerOverlaySha256: profile.workerOverlaySha256,
      videoManifestKey: `${benchmarkRoot}/video/control/manifest.json`,
      videoManifestSha256: HEX_B,
      videoProfileSha256: HEX_C,
    },
    outputs: [{
      id: "mannequin-archive",
      key: `${benchmarkRoot}/video/outputs/mannequin-archive.mp4`,
      inputArtifact: {
        key: `${benchmarkRoot}/image/outputs/mannequin-archive.png`,
        sha256: HEX_B,
      },
      proof: {
        outputWidth: profile.outputWidth,
        outputHeight: profile.outputHeight,
        hasAudio: true,
        frameCount: profile.frameCount,
        frameRate: profile.fps,
        stageOneWidth: profile.stageOneWidth,
        stageOneHeight: profile.stageOneHeight,
        spatialUpscaleFactor: profile.spatialUpscaleFactor,
        pipeline: profile.pipeline,
        quantization: profile.quantization,
        offload: profile.offload,
        sampledPeakVramMib: 21_500,
        inputGeometry: {
          initial: { sha256: HEX_B, width: profile.stageOneWidth, height: profile.stageOneHeight },
        },
      },
      controllerProof: {
        sha256: HEX_A,
        sizeBytes: 12_345,
        media: {
          container: "mov,mp4,m4a,3gp,3g2,mj2",
          durationSeconds: 0.68,
          video: {
            codec: "h264",
            pixelFormat: "yuv420p",
            width: profile.outputWidth,
            height: profile.outputHeight,
            frameRate: profile.fps,
            frameCount: profile.frameCount,
          },
          audio: { present: true, codec: "aac", channels: 2, sampleRate: 48_000 },
        },
      },
    }],
  };
  return { ...core, reportSha256: sha256Hex(canonicalJson(core)) };
}

function resealTerminalReport(report: Record<string, unknown>): Record<string, unknown> {
  const { reportSha256: _ignored, ...core } = report;
  void _ignored;
  return { ...core, reportSha256: sha256Hex(canonicalJson(core)) };
}

function reviewedAdmissionCore(): ReviewedLtxBenchmarkAdmissionCore {
  const report = reportProof();
  return {
    contract: REVIEWED_LTX_BENCHMARK_ADMISSION_CONTRACT,
    admissionId: "ltx-native-720p-x2-review-001",
    profile: LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE,
    profileFingerprint: LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE_FINGERPRINT,
    report,
    review: {
      contract: LTX_BENCHMARK_REVIEW_CONTRACT,
      verdict: "pass",
      reviewId: "ltx-visual-review-001",
      reviewedBy: "operator-reviewer",
      reviewedAt: "2026-08-21T10:00:00Z",
      profileFingerprint: LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE_FINGERPRINT,
      reportProofFingerprint: report.proofFingerprint,
      evidence: {
        contract: LTX_BENCHMARK_REVIEW_EVIDENCE_CONTRACT,
        evidenceKey: "novita/benchmarks/ltx-2.5-720p-native-x2-smoke/0123456789abcdef01234567/review/evidence.json",
        immutableEvidenceObjectVersionId: "r2-version-20260821-0003",
        evidenceSha256: HEX_B,
        visualReviewReceiptFingerprint: HEX_C,
        outputId: report.outputId,
        outputKey: report.outputKey,
        outputVideoSha256: report.outputVideoSha256,
        criterionEvidence: [
          { id: "artifact-freedom", scope: "global", verdict: "pass", reviewFrames: [{ artifactId: "review-frame-001", tSec: 0.05 }, { artifactId: "review-frame-002", tSec: 0.24 }, { artifactId: "review-frame-003", tSec: 0.46 }, { artifactId: "review-frame-005", tSec: 0.65 }] },
          { id: "camera-motion-and-temporal-integrity", scope: "global", verdict: "pass", reviewFrames: [{ artifactId: "review-frame-001", tSec: 0.05 }, { artifactId: "review-frame-002", tSec: 0.24 }, { artifactId: "review-frame-004", tSec: 0.46 }, { artifactId: "review-frame-005", tSec: 0.65 }] },
          { id: "final-image-and-audio-fidelity", scope: "global", verdict: "pass", reviewFrames: [{ artifactId: "review-frame-001", tSec: 0.05 }, { artifactId: "review-frame-003", tSec: 0.24 }, { artifactId: "review-frame-004", tSec: 0.46 }, { artifactId: "review-frame-005", tSec: 0.65 }] },
          { id: "story-and-subject-continuity", scope: "frame", verdict: "pass", reviewFrames: [{ artifactId: "review-frame-001", tSec: 0.05 }, { artifactId: "review-frame-003", tSec: 0.46 }, { artifactId: "review-frame-005", tSec: 0.65 }] },
        ],
      },
    },
    releaseApproval: {
      contract: MANUAL_LTX_BENCHMARK_RELEASE_APPROVAL_CONTRACT,
      decision: "approved",
      approvalId: "ltx-release-approval-001",
      approvedBy: "release-operator",
      approvedAt: "2026-08-21T11:00:00Z",
      releaseRevision: RELEASE_REVISION,
      profileFingerprint: LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE_FINGERPRINT,
      reportProofFingerprint: report.proofFingerprint,
    },
  };
}

function reviewedAdmission(): ReviewedLtxBenchmarkAdmission {
  const core = reviewedAdmissionCore();
  return {
    ...core,
    admissionFingerprint: reviewedLtxBenchmarkAdmissionFingerprint(core),
  };
}

function exactProfileIsFullySealed(): void {
  const profile = LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE;
  const exact = assessLtx25Native720pX2BenchmarkProfile(LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE);
  assert.equal(exact.exact, true);
  assert.deepEqual(exact.blockers, []);
  assert.equal(exact.profileFingerprint, LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE_FINGERPRINT);
  assert.equal(
    ltx25Native720pX2BenchmarkProfileFingerprint(LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE),
    LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE_FINGERPRINT,
  );
  assert.equal(
    createHash("sha256").update(readFileSync("infra/novita/worker.py")).digest("hex"),
    LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE.workerOverlaySha256,
    "a changed worker overlay needs a new explicit benchmark profile and review; it cannot inherit this proof",
  );
  const scriptSmokeProfile = ltx25Native720X2SmokeProfile({
    model: profile.model,
    revision: profile.revision,
    infrastructure: { provider: "novita" },
  });
  assert.deepEqual(
    {
      model: scriptSmokeProfile.model,
      revision: scriptSmokeProfile.revision,
      checkpoint: scriptSmokeProfile.checkpoint,
      textEncoderCheckpoint: scriptSmokeProfile.textEncoderCheckpoint,
      videoVaeCheckpoint: scriptSmokeProfile.videoVaeCheckpoint,
      audioVaeCheckpoint: scriptSmokeProfile.audioVaeCheckpoint,
      spatialUpscalerCheckpoint: scriptSmokeProfile.spatialUpscalerCheckpoint,
      stageOneWidth: scriptSmokeProfile.stageOneWidth,
      stageOneHeight: scriptSmokeProfile.stageOneHeight,
      outputWidth: scriptSmokeProfile.width,
      outputHeight: scriptSmokeProfile.height,
      fps: scriptSmokeProfile.fps,
      frameCount: scriptSmokeProfile.maxFrames,
      steps: scriptSmokeProfile.steps,
      guidanceScale: scriptSmokeProfile.guidanceScale,
      precision: scriptSmokeProfile.precision,
      pipeline: scriptSmokeProfile.pipeline,
      twoStageRefine: scriptSmokeProfile.twoStageRefine,
      spatialUpscaleFactor: scriptSmokeProfile.spatialUpscaleFactor,
      quantization: scriptSmokeProfile.quantization,
      offload: scriptSmokeProfile.offload,
    },
    {
      model: profile.model,
      revision: profile.revision,
      checkpoint: profile.checkpoint,
      textEncoderCheckpoint: profile.textEncoderCheckpoint,
      videoVaeCheckpoint: profile.videoVaeCheckpoint,
      audioVaeCheckpoint: profile.audioVaeCheckpoint,
      spatialUpscalerCheckpoint: profile.spatialUpscalerCheckpoint,
      stageOneWidth: profile.stageOneWidth,
      stageOneHeight: profile.stageOneHeight,
      outputWidth: profile.outputWidth,
      outputHeight: profile.outputHeight,
      fps: profile.fps,
      frameCount: profile.frameCount,
      steps: profile.steps,
      guidanceScale: profile.guidanceScale,
      precision: profile.precision,
      pipeline: profile.pipeline,
      twoStageRefine: profile.twoStageRefine,
      spatialUpscaleFactor: profile.spatialUpscaleFactor,
      quantization: profile.quantization,
      offload: profile.offload,
    },
    "the benchmark script's smoke profile must remain exactly equal to the sealed admission profile",
  );
  const benchmarkScript = readFileSync("scripts/run-ltx25-benchmark.mjs", "utf8");
  assert.match(benchmarkScript, /createLtx25BenchmarkReviewBrief/);
  assert.match(benchmarkScript, /review\/brief\.json/);
  assert.match(benchmarkScript, /pending review task/i);
  for (const [constant, value] of [
    ["LTX_MODEL", profile.model],
    ["LTX_REVISION", profile.revision],
    ["LTX_RUNTIME_REPOSITORY", profile.runtimeRepository],
    ["LTX_RUNTIME_REVISION", profile.runtimeRevision],
    ["BASE_IMAGE", profile.workerImage],
    ["SEALED_RUNTIME_BUNDLE_KEY", profile.runtimeBundleKey],
    ["SEALED_RUNTIME_BUNDLE_SHA256", profile.runtimeBundleSha256],
  ]) {
    assert(
      benchmarkScript.includes(`const ${constant} = ${JSON.stringify(value)};`),
      `${constant} in the paid benchmark script must remain equal to the sealed admission profile`,
    );
  }

  for (const [field, value, expectedBlocker] of [
    ["revision", "e".repeat(40), "ltx_benchmark_profile_revision_mismatch"],
    ["runtimeRevision", "f".repeat(40), "ltx_benchmark_profile_runtimeRevision_mismatch"],
    ["runtimeBundleSha256", "f".repeat(64), "ltx_benchmark_profile_runtimeBundleSha256_mismatch"],
    ["workerImage", "pytorch/pytorch@sha256:" + "e".repeat(64), "ltx_benchmark_profile_workerImage_mismatch"],
    ["workerOverlaySha256", "f".repeat(64), "ltx_benchmark_profile_workerOverlaySha256_mismatch"],
    ["stageOneWidth", 640, "ltx_benchmark_profile_stageOneWidth_mismatch"],
    ["outputHeight", 704, "ltx_benchmark_profile_outputHeight_mismatch"],
    ["fps", 24, "ltx_benchmark_profile_fps_mismatch"],
    ["spatialUpscaleFactor", 1, "ltx_benchmark_profile_spatialUpscaleFactor_mismatch"],
    ["quantization", "none", "ltx_benchmark_profile_quantization_mismatch"],
    ["offload", "gpu", "ltx_benchmark_profile_offload_mismatch"],
  ] as const) {
    const assessment = assessLtx25Native720pX2BenchmarkProfile({
      ...LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE,
      [field]: value,
    });
    assert.equal(assessment.exact, false, `${field} may not drift`);
    assert(assessment.blockers.includes(expectedBlocker), `${field} must have an exact mismatch blocker`);
  }

  const smuggled = assessLtx25Native720pX2BenchmarkProfile({
    ...LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE,
    hiddenFallback: true,
  });
  assert.equal(smuggled.exact, false);
  assert(smuggled.blockers.includes("ltx_benchmark_profile_unrecognized_hiddenFallback"));
}

function immutableReportAndReviewBindingsRejectTampering(): void {
  const proof = reportProof();
  assert.deepEqual(assertImmutableLtxBenchmarkReportProof(proof), proof);

  assert.throws(
    () => assertImmutableLtxBenchmarkReportProof({ ...proof, reportContentSha256: "d".repeat(64) }),
    /fingerprint does not match/,
    "report byte digest must be sealed by the proof fingerprint",
  );
  assert.throws(
    () => assertImmutableLtxBenchmarkReportProof({ ...proof, immutableObjectVersionId: "short" }),
    /immutableObjectVersionId is invalid/,
    "a terminal report needs an immutable-object version binding",
  );
  assert.throws(
    () => assertImmutableLtxBenchmarkReportProof({ ...proof, terminalStatus: "incomplete" }),
    /terminalStatus must be complete/,
    "a failed/incomplete benchmark cannot become evidence",
  );

  const terminal = terminalReport();
  const derived = deriveImmutableLtxBenchmarkReportProof({
    reportKey: "novita/benchmarks/ltx-2.5-720p-native-x2-smoke/0123456789abcdef01234567/report.json",
    immutableObjectVersionId: "r2-version-20260821-0002",
    reportJson: JSON.stringify(terminal),
  });
  assert.equal(derived.profileFingerprint, LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE_FINGERPRINT);
  assert.equal(derived.reportContentSha256, sha256Hex(JSON.stringify(terminal)));
  const changedRuntime: Record<string, unknown> = {
    ...terminal,
    ltx: { ...(terminal.ltx as Record<string, unknown>), workerImage: "pytorch/pytorch@sha256:" + "e".repeat(64) },
  };
  const resealedChangedRuntime = resealTerminalReport(changedRuntime);
  assert.throws(
    () => deriveImmutableLtxBenchmarkReportProof({
      reportKey: "novita/benchmarks/ltx-2.5-720p-native-x2-smoke/0123456789abcdef01234567/report.json",
      immutableObjectVersionId: "r2-version-20260821-0002",
      reportJson: JSON.stringify(resealedChangedRuntime),
    }),
    /workerImage does not match/,
    "a self-consistent terminal report still cannot substitute a worker image",
  );
  const changedCheckpoint = resealTerminalReport({
    ...terminal,
    ltx: { ...(terminal.ltx as Record<string, unknown>), checkpoint: "unsealed-checkpoint.safetensors" },
  });
  assert.throws(
    () => deriveImmutableLtxBenchmarkReportProof({
      reportKey: "novita/benchmarks/ltx-2.5-720p-native-x2-smoke/0123456789abcdef01234567/report.json",
      immutableObjectVersionId: "r2-version-20260821-0002",
      reportJson: JSON.stringify(changedCheckpoint),
    }),
    /checkpoint does not match/,
    "a self-consistent report cannot substitute an LTX checkpoint",
  );
  const changedInputGeometry = resealTerminalReport({
    ...terminal,
    outputs: [{
      ...(terminal.outputs as Array<Record<string, unknown>>)[0],
      proof: {
        ...((terminal.outputs as Array<Record<string, unknown>>)[0].proof as Record<string, unknown>),
        inputGeometry: { initial: { sha256: HEX_A, width: 1280, height: 704 } },
      },
    }],
  });
  assert.throws(
    () => deriveImmutableLtxBenchmarkReportProof({
      reportKey: "novita/benchmarks/ltx-2.5-720p-native-x2-smoke/0123456789abcdef01234567/report.json",
      immutableObjectVersionId: "r2-version-20260821-0002",
      reportJson: JSON.stringify(changedInputGeometry),
    }),
    /initial source geometry is not bound/,
    "the worker geometry receipt must bind the exact image-phase SHA-256",
  );
  const unrecognizedLtxField = resealTerminalReport({
    ...terminal,
    ltx: { ...(terminal.ltx as Record<string, unknown>), hiddenFallback: true },
  });
  assert.throws(
    () => deriveImmutableLtxBenchmarkReportProof({
      reportKey: "novita/benchmarks/ltx-2.5-720p-native-x2-smoke/0123456789abcdef01234567/report.json",
      immutableObjectVersionId: "r2-version-20260821-0002",
      reportJson: JSON.stringify(unrecognizedLtxField),
    }),
    /unrecognized fields/,
    "an unmodeled runtime field must fail closed instead of being ignored",
  );

  const admission = reviewedAdmission();
  assert.deepEqual(assertReviewedLtxBenchmarkAdmission(admission), admission);
  assert.throws(
    () => assertReviewedLtxBenchmarkAdmission({
      ...admission,
      releaseApproval: { ...admission.releaseApproval, decision: "pending" },
    }),
    /must explicitly be approved/,
    "a report cannot self-promote without a manual release approval",
  );
  assert.throws(
    () => assertReviewedLtxBenchmarkAdmission({
      ...admission,
      releaseApproval: { ...admission.releaseApproval, reportProofFingerprint: HEX_A },
    }),
    /does not bind/,
    "approval must bind the exact immutable report proof",
  );
  assert.throws(
    () => assertReviewedLtxBenchmarkAdmission({
      ...admission,
      releaseApproval: { ...admission.releaseApproval, approvedAt: "2026-08-21T09:00:00Z" },
    }),
    /predates its review/,
    "approval must follow the independent review",
  );
  assert.throws(
    () => assertReviewedLtxBenchmarkAdmission({
      ...admission,
      review: {
        ...admission.review,
        evidence: { ...admission.review.evidence, outputVideoSha256: HEX_B },
      },
    }),
    /does not bind the exact immutable benchmark output/,
    "a quality review cannot certify a different video than the sealed benchmark output",
  );
  assert.throws(
    () => assertReviewedLtxBenchmarkAdmission({
      ...admission,
      review: {
        ...admission.review,
        evidence: {
          ...admission.review.evidence,
          criterionEvidence: admission.review.evidence.criterionEvidence.slice(1),
        },
      },
    }),
    /retain passing witnesses for every required quality criterion/,
    "an aggregate quality pass cannot hide an unreviewed benchmark requirement",
  );
  assert.throws(
    () => assertReviewedLtxBenchmarkAdmission({
      ...admission,
      review: {
        ...admission.review,
        evidence: {
          ...admission.review.evidence,
          criterionEvidence: admission.review.evidence.criterionEvidence.map((criterion) =>
            criterion.id === "camera-motion-and-temporal-integrity"
              ? { ...criterion, reviewFrames: [{ artifactId: "review-frame-002", tSec: 0.34 }] }
              : criterion,
          ),
        },
      },
    }),
    /requires at least 4 retained review frames for camera-motion-and-temporal-integrity/,
    "a global temporal-quality pass must cover multiple retained moments, not one favorable frame",
  );
  assert.throws(
    () => assertReviewedLtxBenchmarkAdmission({
      ...admission,
      review: {
        ...admission.review,
        evidence: {
          ...admission.review.evidence,
          criterionEvidence: admission.review.evidence.criterionEvidence.map((criterion) =>
            criterion.id === "camera-motion-and-temporal-integrity"
              ? {
                  ...criterion,
                  reviewFrames: [
                    { artifactId: "review-frame-001", tSec: 0.3 },
                    { artifactId: "review-frame-002", tSec: 0.31 },
                    { artifactId: "review-frame-004", tSec: 0.32 },
                    { artifactId: "review-frame-005", tSec: 0.33 },
                  ],
                }
              : criterion,
          ),
        },
      },
    }),
    /requires 0.5s temporal coverage for camera-motion-and-temporal-integrity/,
    "four near-identical moments cannot certify camera motion or temporal integrity",
  );
}

function emptyReleaseRegistryCannotUnlockVideoRuntime(): void {
  assert.deepEqual(RELEASE_CONTROLLED_REVIEWED_LTX_BENCHMARK_REGISTRY, []);
  assert.deepEqual(resolveReviewedLtxBenchmarkRegistry(), []);

  const manuallyReviewedFixture = reviewedAdmission();
  assert.deepEqual(
    resolveReviewedLtxBenchmarkRegistry([manuallyReviewedFixture]).map((entry) => entry.profileFingerprint),
    [LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE_FINGERPRINT],
    "a pure validation call can recognize a fully reviewed, release-approved record without changing runtime state",
  );
  assert.throws(
    () => resolveReviewedLtxBenchmarkRegistry([manuallyReviewedFixture, manuallyReviewedFixture]),
    /duplicate admission binding/,
    "a release registry must not contain replayed review records",
  );
  assert.deepEqual(
    NOVITA_LOCKED_VIDEO_RUNTIME.benchmarkedVideoProfileRevisions,
    [],
    "a registry record is not a runtime allow-list mutation",
  );
  const production = assessNovitaVideoProfileRuntime(generationProfile("production"));
  assert.equal(production.ready, false, "the existing production profile remains independently blocked");
  assert(
    production.blockers.includes("ltx_2_5_revision_not_benchmarked_on_rtx_4090"),
    "the existing fail-closed runtime blocker must stay visible",
  );

  const unattested = reviewedLtxRuntimeTarget();
  assert.equal(unattested.status, "unattested");
  assert.equal(unattested.runtime, NOVITA_LOCKED_VIDEO_RUNTIME);

  const attested = reviewedLtxRuntimeTarget([manuallyReviewedFixture]);
  assert.equal(attested.status, "attested");
  assert.deepEqual(
    attested.runtime.benchmarkedVideoProfileRevisions,
    [novitaVideoProfileIdentity(generationProfile("production"))],
    "only the exact benchmarked LTX profile identity may enter the derived runtime target",
  );
  assert.equal(
    assessNovitaVideoProfileRuntime(generationProfile("production"), attested.runtime).ready,
    true,
    "a caller that explicitly carries the complete reviewed admission may pass the same strict runtime gate",
  );
  assert.equal(
    familyProductionReadiness("cinematic").productionReady,
    false,
    "the public/static family surface must remain fail-closed without a reviewed target",
  );
  assert.equal(
    familyProductionReadiness("cinematic", attested.runtime).productionReady,
    true,
    "only the exact owner-reviewed runtime target may complete cinematic's final static readiness gap",
  );
  assert.equal(
    certifiedFamilyAdmission("cinematic").automatic,
    false,
    "an attestation record must not mutate the global automatic catalog",
  );
  assert.equal(
    certifiedFamilyAdmission("cinematic", attested.runtime).automatic,
    true,
    "a server caller that explicitly carries the reviewed target can evaluate the otherwise-complete cinematic binding",
  );
  assert.equal(
    formatPreflight("cinematic", {
      nicheKey: "educational",
      concept: "An original causal mini-film with a clear visual payoff.",
    }).productionReady,
    false,
    "generic format preflight must not accept a browser-supplied or absent runtime target",
  );
  assert.equal(
    formatPreflight(
      "cinematic",
      {
        nicheKey: "educational",
        concept: "An original causal mini-film with a clear visual payoff.",
      },
      { runtimeTarget: attested.runtime },
    ).productionReady,
    true,
    "an explicit reviewed target enables only the fully registered cinematic route preflight",
  );
}

exactProfileIsFullySealed();
immutableReportAndReviewBindingsRejectTampering();
emptyReleaseRegistryCannotUnlockVideoRuntime();

console.log("LTX BENCHMARK ADMISSION PASS: sealed native-720p x2 proof remains review-only and runtime-fail-closed");
