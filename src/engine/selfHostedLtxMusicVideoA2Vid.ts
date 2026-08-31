import { CURRENT_DIRECT_NOVITA_LTX_PIPELINES_BOUNDARY } from "@/engine/comfyIcloraWorkerContract";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/**
 * A fail-closed work-order contract for a future, self-hosted open-weight
 * LTX 2.5 audio-to-video (A2Vid) worker on Novita. This is intentionally not
 * a provider adapter: it cannot download weights, schedule a GPU, read R2,
 * reserve money, or publish a video. It gives a future worker one exact,
 * repeatable handoff after the mastered music, reference imagery, runtime,
 * benchmark, and budget reservation have all been proven.
 *
 * The current `infra/novita/worker.py` distilled text-to-video worker is
 * explicitly rejected. Its presence must never be treated as A2Vid support.
 */
export const SELF_HOSTED_LTX_A2VID_AUDIO_SEGMENT_VERSION = "self-hosted-ltx-a2vid-audio-segment/v1" as const;
export const SELF_HOSTED_LTX_A2VID_REFERENCE_VERSION = "self-hosted-ltx-a2vid-reference/v1" as const;
export const SELF_HOSTED_LTX_A2VID_RUNTIME_VERSION = "self-hosted-ltx-a2vid-runtime/v2" as const;
export const SELF_HOSTED_LTX_A2VID_BENCHMARK_VERSION = "self-hosted-ltx-a2vid-benchmark/v2" as const;
export const SELF_HOSTED_LTX_A2VID_RUNTIME_ADMISSION_VERSION = "self-hosted-ltx-a2vid-runtime-admission/v1" as const;
export const SELF_HOSTED_LTX_A2VID_RESERVATION_VERSION = "self-hosted-ltx-a2vid-reservation/v1" as const;
export const SELF_HOSTED_LTX_A2VID_WORK_ORDER_VERSION = "self-hosted-ltx-a2vid-work-order/v1" as const;

export const SELF_HOSTED_LTX_A2VID_REQUIRED_PROVIDER = "novita" as const;
export const SELF_HOSTED_LTX_A2VID_EXECUTION_PATH = "dedicated_self_hosted_ltx_a2vid" as const;
export const SELF_HOSTED_LTX_A2VID_WORKER_PROFILE_VERSION = "1.0.0" as const;
export const SELF_HOSTED_LTX_A2VID_WORKER_PROFILE_ID = "ltx25-a2vid-benchmark-v1" as const;
export const SELF_HOSTED_LTX_A2VID_COMPONENT_IDS = [
  "a2vid-transformer",
  "a2vid-text-encoder",
  "a2vid-video-vae",
  "a2vid-audio-vae",
  "a2vid-spatial-upscaler",
  "a2vid-stage2-distilled-lora",
] as const;
/** A documented incompatibility guard; never use this worker for A2Vid. */
export const CURRENT_DIRECT_LTX_A2VID_INCOMPATIBLE_WORKER = CURRENT_DIRECT_NOVITA_LTX_PIPELINES_BOUNDARY;

/**
 * Browser-safe status for the owned Studio library; this is not a worker API.
 * A benchmark admission proves only a pinned, reviewed runtime. It never
 * supplies an audio segment, reference images, a budget hold, or permission to
 * launch a Novita worker.
 */
export function selfHostedMusicVideoA2VidStudioReadiness(input: {
  readonly activeRuntimeAdmissions?: readonly unknown[];
} = {}) {
  const admissions = (input.activeRuntimeAdmissions ?? []).map(assertMusicVideoA2VidRuntimeAdmission);
  const current = admissions
    .slice()
    .sort((left, right) => right.admittedAt.localeCompare(left.admittedAt))[0];
  const benchmarkAdmitted = current !== undefined;
  return Object.freeze({
    id: "self-hosted-ltx-2.5-a2vid",
    status: benchmarkAdmitted ? "benchmark_admitted" as const : "not_installed" as const,
    label: "Self-hosted LTX 2.5 music-to-video",
    executionTarget: "Dedicated Novita A2Vid worker" as const,
    currentWorkerBoundary: Object.freeze({
      workerPath: CURRENT_DIRECT_LTX_A2VID_INCOMPATIBLE_WORKER.workerPath,
      loader: CURRENT_DIRECT_LTX_A2VID_INCOMPATIBLE_WORKER.loader,
      reason: "Current direct LTX worker is distilled text-to-video only.",
    }),
    activeBenchmark: current === undefined ? undefined : Object.freeze({
      runtimeFingerprint: current.runtime.fingerprint,
      benchmarkFingerprint: current.benchmark.fingerprint,
      gpuSku: current.runtime.requiredGpuSku,
      minimumVramGb: current.runtime.minimumVramGb,
      admittedAt: current.admittedAt,
    }),
    requirements: Object.freeze(benchmarkAdmitted
      ? ["Exact mastered-music segment, approved opening/ending images, bounded reservation, and final-master review"]
      : [
          "Accepted LTX 2.5 A2Vid model and runtime pins",
          "Dedicated self-hosted Novita worker with approved reference-image conditioning",
          "A matched A/B benchmark that beats the existing music-visual route without regressing visual or reference quality",
          "Exact mastered-music segment, bounded reservation, and final-master review",
        ]),
  });
}

const SHA256 = /^[a-f0-9]{64}$/iu;
const GIT_REVISION = /^[a-f0-9]{40}$/iu;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{2,159}$/u;
const SAFE_R2_KEY = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9][A-Za-z0-9._/@+=:-]{1,511}$/u;
const IMAGE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const AUDIO_CONTENT_TYPES = new Set(["audio/mpeg", "audio/wav", "audio/x-wav"]);

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  const extra = Object.keys(value).filter((key) => !allowed.has(key));
  if (extra.length) throw new Error(`${label} contains unsupported field(s): ${extra.join(", ")}`);
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function identifier(value: unknown, label: string): string {
  const result = string(value, label);
  if (!SAFE_ID.test(result)) throw new Error(`${label} is not a safe identifier`);
  return result;
}

function sha256(value: unknown, label: string): string {
  const result = string(value, label);
  if (!SHA256.test(result)) throw new Error(`${label} must be a SHA-256 digest`);
  return result.toLowerCase();
}

function immutableRevision(value: unknown, label: string): string {
  const result = string(value, label);
  if (!GIT_REVISION.test(result)) throw new Error(`${label} must be a pinned Git revision`);
  return result.toLowerCase();
}

function r2Key(value: unknown, label: string): string {
  const result = string(value, label);
  if (!SAFE_R2_KEY.test(result)) throw new Error(`${label} is not a safe object key`);
  return result;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function score(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10) {
    throw new Error(`${label} must be a 0–10 score`);
  }
  return value;
}

function fingerprint<T extends UnknownRecord>(core: T): T & { readonly fingerprint: string } {
  return Object.freeze({ ...core, fingerprint: sha256Hex(canonicalJson(core)) });
}

function sealed<T extends UnknownRecord>(raw: UnknownRecord, label: string, core: T): T & { readonly fingerprint: string } {
  const result = fingerprint(core);
  if (raw.fingerprint !== undefined && raw.fingerprint !== result.fingerprint) {
    throw new Error(`${label}.fingerprint does not match its sealed fields`);
  }
  return result;
}

export interface MusicVideoA2VidAudioSegmentCore {
  readonly version: typeof SELF_HOSTED_LTX_A2VID_AUDIO_SEGMENT_VERSION;
  readonly sourceMusicKey: string;
  readonly sourceMusicSha256: string;
  readonly sourceMusicReceiptFingerprint: string;
  readonly contentType: "audio/mpeg" | "audio/wav" | "audio/x-wav";
  readonly sourceDurationMs: number;
  readonly startMs: number;
  readonly endMs: number;
}

export interface MusicVideoA2VidAudioSegment extends MusicVideoA2VidAudioSegmentCore {
  readonly fingerprint: string;
}

export function createMusicVideoA2VidAudioSegment(value: MusicVideoA2VidAudioSegmentCore): MusicVideoA2VidAudioSegment {
  const raw = record(value, "A2Vid music segment");
  exactKeys(raw, ["version", "sourceMusicKey", "sourceMusicSha256", "sourceMusicReceiptFingerprint", "contentType", "sourceDurationMs", "startMs", "endMs", "fingerprint"], "A2Vid music segment");
  if (raw.version !== SELF_HOSTED_LTX_A2VID_AUDIO_SEGMENT_VERSION) throw new Error("unsupported A2Vid music segment version");
  const contentType = string(raw.contentType, "A2Vid music segment.contentType");
  if (!AUDIO_CONTENT_TYPES.has(contentType)) throw new Error("A2Vid music segment must use a sealed audio master content type");
  const sourceDurationMs = positiveInteger(raw.sourceDurationMs, "A2Vid music segment.sourceDurationMs");
  const startMs = typeof raw.startMs === "number" && Number.isInteger(raw.startMs) && raw.startMs >= 0 ? raw.startMs : -1;
  const endMs = positiveInteger(raw.endMs, "A2Vid music segment.endMs");
  if (startMs < 0 || endMs > sourceDurationMs || endMs <= startMs) throw new Error("A2Vid music segment window is outside its sealed music master");
  const durationMs = endMs - startMs;
  if (durationMs < 2_000 || durationMs > 20_000) throw new Error("A2Vid music segment must be a 2–20 second source-master window");
  return sealed(raw, "A2Vid music segment", {
    version: SELF_HOSTED_LTX_A2VID_AUDIO_SEGMENT_VERSION,
    sourceMusicKey: r2Key(raw.sourceMusicKey, "A2Vid music segment.sourceMusicKey"),
    sourceMusicSha256: sha256(raw.sourceMusicSha256, "A2Vid music segment.sourceMusicSha256"),
    sourceMusicReceiptFingerprint: sha256(raw.sourceMusicReceiptFingerprint, "A2Vid music segment.sourceMusicReceiptFingerprint"),
    contentType: contentType as MusicVideoA2VidAudioSegmentCore["contentType"],
    sourceDurationMs,
    startMs,
    endMs,
  });
}

export interface MusicVideoA2VidReferenceImageCore {
  readonly version: typeof SELF_HOSTED_LTX_A2VID_REFERENCE_VERSION;
  readonly role: "opening" | "ending";
  readonly r2Key: string;
  readonly contentSha256: string;
  readonly byteLength: number;
  readonly contentType: "image/jpeg" | "image/png" | "image/webp";
  readonly approvedAssetFingerprint: string;
}

export interface MusicVideoA2VidReferenceImage extends MusicVideoA2VidReferenceImageCore {
  readonly fingerprint: string;
}

export function createMusicVideoA2VidReferenceImage(value: MusicVideoA2VidReferenceImageCore): MusicVideoA2VidReferenceImage {
  const raw = record(value, "A2Vid reference image");
  exactKeys(raw, ["version", "role", "r2Key", "contentSha256", "byteLength", "contentType", "approvedAssetFingerprint", "fingerprint"], "A2Vid reference image");
  if (raw.version !== SELF_HOSTED_LTX_A2VID_REFERENCE_VERSION) throw new Error("unsupported A2Vid reference image version");
  if (raw.role !== "opening" && raw.role !== "ending") throw new Error("A2Vid reference image.role must be opening or ending");
  const role: MusicVideoA2VidReferenceImageCore["role"] = raw.role === "opening" ? "opening" : "ending";
  const contentType = string(raw.contentType, "A2Vid reference image.contentType");
  if (!IMAGE_CONTENT_TYPES.has(contentType)) throw new Error("A2Vid reference image must use an approved image content type");
  return sealed(raw, "A2Vid reference image", {
    version: SELF_HOSTED_LTX_A2VID_REFERENCE_VERSION,
    role,
    r2Key: r2Key(raw.r2Key, "A2Vid reference image.r2Key"),
    contentSha256: sha256(raw.contentSha256, "A2Vid reference image.contentSha256"),
    byteLength: positiveInteger(raw.byteLength, "A2Vid reference image.byteLength"),
    contentType: contentType as MusicVideoA2VidReferenceImageCore["contentType"],
    approvedAssetFingerprint: sha256(raw.approvedAssetFingerprint, "A2Vid reference image.approvedAssetFingerprint"),
  });
}

export interface MusicVideoA2VidRuntimeComponent {
  readonly id: typeof SELF_HOSTED_LTX_A2VID_COMPONENT_IDS[number];
  /** Relative path beneath the persistent model volume and local cache. */
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface MusicVideoA2VidRuntimePinCore {
  readonly version: typeof SELF_HOSTED_LTX_A2VID_RUNTIME_VERSION;
  readonly provider: typeof SELF_HOSTED_LTX_A2VID_REQUIRED_PROVIDER;
  readonly executionPath: typeof SELF_HOSTED_LTX_A2VID_EXECUTION_PATH;
  readonly workerImage: string;
  readonly workerOverlaySha256: string;
  readonly requiredGpuSku: "RTX 4090" | "RTX 5090";
  readonly minimumVramGb: number;
  readonly modelRepository: "Lightricks/LTX-2.5";
  readonly modelImmutableRevision: string;
  readonly modelSha256: string;
  /** Accepted LTX model-license record; never a bare checkbox. */
  readonly licenseReceiptFingerprint: string;
  /**
   * A2Vid needs the full two-stage component set, not a generic aggregate
   * model hash. The ordered list maps directly to the self-hosted worker's
   * hash-verified local cache manifest.
   */
  readonly components: readonly MusicVideoA2VidRuntimeComponent[];
  readonly pipelineRepository: "Lightricks/LTX-2";
  readonly pipelineImmutableRevision: string;
  readonly pipeline: "a2vid_two_stage";
  readonly supportsApprovedReferenceImages: true;
}

export interface MusicVideoA2VidRuntimePin extends MusicVideoA2VidRuntimePinCore {
  readonly fingerprint: string;
}

export interface MusicVideoA2VidWorkerProfile {
  readonly contractVersion: typeof SELF_HOSTED_LTX_A2VID_WORKER_PROFILE_VERSION;
  readonly id: typeof SELF_HOSTED_LTX_A2VID_WORKER_PROFILE_ID;
  readonly phase: "audio_video";
  readonly model: "Lightricks/LTX-2.5";
  readonly modelRevision: string;
  readonly runtimeRepository: "Lightricks/LTX-2";
  readonly runtimeRevision: string;
  readonly pipeline: "a2vid_two_stage";
  readonly width: 1280;
  readonly height: 704;
  readonly steps: 8;
  readonly fps: 25;
  readonly precision: "bf16";
  readonly quantization: "fp8-cast";
  readonly offload: "cpu";
  readonly stageOneWidth: 640;
  readonly stageOneHeight: 352;
  readonly spatialUpscaleFactor: 2;
  readonly requiredGpuSku: "RTX 4090" | "RTX 5090";
  readonly minimumVramGb: number;
  readonly licenseReceiptFingerprint: string;
  readonly components: readonly MusicVideoA2VidRuntimeComponent[];
  readonly benchmarkOnly: true;
  readonly allowFallback: false;
}

function normalizeRuntimeComponents(value: unknown): readonly MusicVideoA2VidRuntimeComponent[] {
  if (!Array.isArray(value) || value.length !== SELF_HOSTED_LTX_A2VID_COMPONENT_IDS.length) {
    throw new Error("A2Vid runtime must pin its exact six component files");
  }
  const components = value.map((candidate, index) => {
    const raw = record(candidate, `A2Vid runtime.components[${index}]`);
    exactKeys(raw, ["id", "path", "sha256", "sizeBytes"], `A2Vid runtime.components[${index}]`);
    const expectedId = SELF_HOSTED_LTX_A2VID_COMPONENT_IDS[index];
    if (raw.id !== expectedId) {
      throw new Error(`A2Vid runtime component ${index} must be ${expectedId}`);
    }
    return Object.freeze({
      id: expectedId,
      path: r2Key(raw.path, `A2Vid runtime ${expectedId}.path`),
      sha256: sha256(raw.sha256, `A2Vid runtime ${expectedId}.sha256`),
      sizeBytes: positiveInteger(raw.sizeBytes, `A2Vid runtime ${expectedId}.sizeBytes`),
    });
  });
  return Object.freeze(components);
}

export function createMusicVideoA2VidRuntimePin(value: MusicVideoA2VidRuntimePinCore): MusicVideoA2VidRuntimePin {
  const raw = record(value, "self-hosted A2Vid runtime pin");
  exactKeys(raw, ["version", "provider", "executionPath", "workerImage", "workerOverlaySha256", "requiredGpuSku", "minimumVramGb", "modelRepository", "modelImmutableRevision", "modelSha256", "licenseReceiptFingerprint", "components", "pipelineRepository", "pipelineImmutableRevision", "pipeline", "supportsApprovedReferenceImages", "fingerprint"], "self-hosted A2Vid runtime pin");
  if (raw.version !== SELF_HOSTED_LTX_A2VID_RUNTIME_VERSION) throw new Error("unsupported self-hosted A2Vid runtime version");
  if (raw.provider !== SELF_HOSTED_LTX_A2VID_REQUIRED_PROVIDER || raw.executionPath !== SELF_HOSTED_LTX_A2VID_EXECUTION_PATH) {
    throw new Error("A2Vid requires a dedicated self-hosted Novita worker, never the direct LTX worker");
  }
  if (raw.modelRepository !== "Lightricks/LTX-2.5" || raw.pipelineRepository !== "Lightricks/LTX-2" || raw.pipeline !== "a2vid_two_stage") {
    throw new Error("A2Vid runtime must pin the official LTX 2.5 A2Vid two-stage pipeline");
  }
  if (raw.requiredGpuSku !== "RTX 4090" && raw.requiredGpuSku !== "RTX 5090") throw new Error("A2Vid runtime must pin a supported Novita GPU SKU");
  const requiredGpuSku: MusicVideoA2VidRuntimePinCore["requiredGpuSku"] = raw.requiredGpuSku === "RTX 4090" ? "RTX 4090" : "RTX 5090";
  const minimumVramGb = positiveInteger(raw.minimumVramGb, "A2Vid runtime.minimumVramGb");
  if (minimumVramGb < 24) throw new Error("A2Vid runtime must reserve at least 24 GB VRAM");
  if (raw.supportsApprovedReferenceImages !== true) throw new Error("A2Vid runtime must declare approved reference-image support");
  const workerImage = string(raw.workerImage, "A2Vid runtime.workerImage");
  if (!workerImage.includes("@sha256:")) throw new Error("A2Vid runtime.workerImage must be digest pinned");
  const components = normalizeRuntimeComponents(raw.components);
  return sealed(raw, "self-hosted A2Vid runtime pin", {
    version: SELF_HOSTED_LTX_A2VID_RUNTIME_VERSION,
    provider: SELF_HOSTED_LTX_A2VID_REQUIRED_PROVIDER,
    executionPath: SELF_HOSTED_LTX_A2VID_EXECUTION_PATH,
    workerImage,
    workerOverlaySha256: sha256(raw.workerOverlaySha256, "A2Vid runtime.workerOverlaySha256"),
    requiredGpuSku,
    minimumVramGb,
    modelRepository: "Lightricks/LTX-2.5" as const,
    modelImmutableRevision: immutableRevision(raw.modelImmutableRevision, "A2Vid runtime.modelImmutableRevision"),
    modelSha256: sha256(raw.modelSha256, "A2Vid runtime.modelSha256"),
    licenseReceiptFingerprint: sha256(raw.licenseReceiptFingerprint, "A2Vid runtime.licenseReceiptFingerprint"),
    components,
    pipelineRepository: "Lightricks/LTX-2" as const,
    pipelineImmutableRevision: immutableRevision(raw.pipelineImmutableRevision, "A2Vid runtime.pipelineImmutableRevision"),
    pipeline: "a2vid_two_stage" as const,
    supportsApprovedReferenceImages: true as const,
  });
}

/**
 * Translate the sealed Studio runtime receipt into the exact object accepted
 * by the dedicated Python worker.  The controller must use this rather than
 * recreating a profile from loose environment variables or a model tag.
 */
export function musicVideoA2VidWorkerProfile(runtime: MusicVideoA2VidRuntimePin): MusicVideoA2VidWorkerProfile {
  return Object.freeze({
    contractVersion: SELF_HOSTED_LTX_A2VID_WORKER_PROFILE_VERSION,
    id: SELF_HOSTED_LTX_A2VID_WORKER_PROFILE_ID,
    phase: "audio_video" as const,
    model: "Lightricks/LTX-2.5" as const,
    modelRevision: runtime.modelImmutableRevision,
    runtimeRepository: "Lightricks/LTX-2" as const,
    runtimeRevision: runtime.pipelineImmutableRevision,
    pipeline: "a2vid_two_stage" as const,
    width: 1280 as const,
    height: 704 as const,
    steps: 8 as const,
    fps: 25 as const,
    precision: "bf16" as const,
    quantization: "fp8-cast" as const,
    offload: "cpu" as const,
    stageOneWidth: 640 as const,
    stageOneHeight: 352 as const,
    spatialUpscaleFactor: 2 as const,
    requiredGpuSku: runtime.requiredGpuSku,
    minimumVramGb: runtime.minimumVramGb,
    licenseReceiptFingerprint: runtime.licenseReceiptFingerprint,
    components: runtime.components,
    benchmarkOnly: true as const,
    allowFallback: false as const,
  });
}

export interface MusicVideoA2VidBenchmarkCore {
  readonly version: typeof SELF_HOSTED_LTX_A2VID_BENCHMARK_VERSION;
  readonly benchmarkId: string;
  readonly runtimeFingerprint: string;
  readonly referenceConditioningVerdict: "pass";
  readonly musicMotionAlignmentVerdict: "pass";
  readonly temporalStabilityVerdict: "pass";
  readonly outputVideoSha256: string;
  readonly outputReceiptFingerprint: string;
  readonly visualReviewReceiptFingerprint: string;
  /**
   * A music-video route is not admitted just because A2Vid exists upstream.
   * It must beat the existing image-to-video path on the same sealed test
   * input, while preserving the visual/reference quality that the baseline
   * already achieved.
   */
  readonly matchedComparison: {
    readonly version: "music-video-render-comparison/v1";
    readonly testInputFingerprint: string;
    readonly baseline: {
      readonly strategy: "existing_image_to_video";
      readonly outputVideoSha256: string;
      readonly visualReviewReceiptFingerprint: string;
      readonly visualQualityScore: number;
      readonly musicMotionAlignmentScore: number;
      readonly referenceContinuityScore: number;
      readonly temporalStabilityScore: number;
    };
    readonly a2vid: {
      readonly strategy: "ltx_a2vid";
      readonly outputVideoSha256: string;
      readonly visualReviewReceiptFingerprint: string;
      readonly visualQualityScore: number;
      readonly musicMotionAlignmentScore: number;
      readonly referenceContinuityScore: number;
      readonly temporalStabilityScore: number;
    };
  };
  readonly reviewedBy: string;
  readonly reviewedAt: string;
}

export interface MusicVideoA2VidBenchmark extends MusicVideoA2VidBenchmarkCore {
  readonly fingerprint: string;
}

function assertMatchedMusicVideoComparison(
  value: unknown,
  outputVideoSha256: string,
  visualReviewReceiptFingerprint: string,
): MusicVideoA2VidBenchmarkCore["matchedComparison"] {
  const comparison = record(value, "A2Vid benchmark.matchedComparison");
  exactKeys(comparison, ["version", "testInputFingerprint", "baseline", "a2vid"], "A2Vid benchmark.matchedComparison");
  if (comparison.version !== "music-video-render-comparison/v1") {
    throw new Error("A2Vid benchmark comparison must use the current matched-render version");
  }
  const parseArm = <T extends "existing_image_to_video" | "ltx_a2vid">(
    value: unknown,
    label: string,
    strategy: T,
  ): {
    readonly strategy: T;
    readonly outputVideoSha256: string;
    readonly visualReviewReceiptFingerprint: string;
    readonly visualQualityScore: number;
    readonly musicMotionAlignmentScore: number;
    readonly referenceContinuityScore: number;
    readonly temporalStabilityScore: number;
  } => {
    const arm = record(value, `A2Vid benchmark comparison.${label}`);
    exactKeys(
      arm,
      [
        "strategy",
        "outputVideoSha256",
        "visualReviewReceiptFingerprint",
        "visualQualityScore",
        "musicMotionAlignmentScore",
        "referenceContinuityScore",
        "temporalStabilityScore",
      ],
      `A2Vid benchmark comparison.${label}`,
    );
    if (arm.strategy !== strategy) throw new Error(`A2Vid benchmark comparison.${label} has an invalid strategy`);
    return {
      strategy,
      outputVideoSha256: sha256(arm.outputVideoSha256, `A2Vid benchmark comparison.${label}.outputVideoSha256`),
      visualReviewReceiptFingerprint: sha256(
        arm.visualReviewReceiptFingerprint,
        `A2Vid benchmark comparison.${label}.visualReviewReceiptFingerprint`,
      ),
      visualQualityScore: score(arm.visualQualityScore, `A2Vid benchmark comparison.${label}.visualQualityScore`),
      musicMotionAlignmentScore: score(
        arm.musicMotionAlignmentScore,
        `A2Vid benchmark comparison.${label}.musicMotionAlignmentScore`,
      ),
      referenceContinuityScore: score(
        arm.referenceContinuityScore,
        `A2Vid benchmark comparison.${label}.referenceContinuityScore`,
      ),
      temporalStabilityScore: score(
        arm.temporalStabilityScore,
        `A2Vid benchmark comparison.${label}.temporalStabilityScore`,
      ),
    };
  };
  const baseline = parseArm(comparison.baseline, "baseline", "existing_image_to_video");
  const a2vid = parseArm(comparison.a2vid, "a2vid", "ltx_a2vid");
  if (
    a2vid.outputVideoSha256 !== outputVideoSha256
    || a2vid.visualReviewReceiptFingerprint !== visualReviewReceiptFingerprint
  ) {
    throw new Error("A2Vid benchmark comparison must bind the same reviewed A2Vid output named by the benchmark");
  }
  if (baseline.outputVideoSha256 === a2vid.outputVideoSha256) {
    throw new Error("A2Vid benchmark comparison requires separately rendered baseline and A2Vid outputs");
  }
  const axes = [
    "visualQualityScore",
    "referenceContinuityScore",
    "temporalStabilityScore",
  ] as const;
  for (const axis of axes) {
    if (a2vid[axis] < baseline[axis]) {
      throw new Error(`A2Vid benchmark comparison may not regress ${axis} from the matched baseline`);
    }
  }
  if (a2vid.musicMotionAlignmentScore < baseline.musicMotionAlignmentScore + 0.4) {
    throw new Error("A2Vid benchmark comparison requires a material music-motion improvement over the matched baseline");
  }
  if (
    a2vid.visualQualityScore < 7.5
    || a2vid.musicMotionAlignmentScore < 7.5
    || a2vid.referenceContinuityScore < 7.5
    || a2vid.temporalStabilityScore < 7.5
  ) {
    throw new Error("A2Vid benchmark comparison requires every A2Vid quality axis to score at least 7.5/10");
  }
  return {
    version: "music-video-render-comparison/v1",
    testInputFingerprint: sha256(comparison.testInputFingerprint, "A2Vid benchmark comparison.testInputFingerprint"),
    baseline,
    a2vid,
  };
}

export function createMusicVideoA2VidBenchmark(value: MusicVideoA2VidBenchmarkCore): MusicVideoA2VidBenchmark {
  const raw = record(value, "self-hosted A2Vid benchmark");
  exactKeys(raw, ["version", "benchmarkId", "runtimeFingerprint", "referenceConditioningVerdict", "musicMotionAlignmentVerdict", "temporalStabilityVerdict", "outputVideoSha256", "outputReceiptFingerprint", "visualReviewReceiptFingerprint", "matchedComparison", "reviewedBy", "reviewedAt", "fingerprint"], "self-hosted A2Vid benchmark");
  if (raw.version !== SELF_HOSTED_LTX_A2VID_BENCHMARK_VERSION) throw new Error("unsupported self-hosted A2Vid benchmark version");
  if (raw.referenceConditioningVerdict !== "pass" || raw.musicMotionAlignmentVerdict !== "pass" || raw.temporalStabilityVerdict !== "pass") {
    throw new Error("A2Vid benchmark requires passing reference, music-motion, and temporal-quality evidence");
  }
  const reviewedAt = string(raw.reviewedAt, "A2Vid benchmark.reviewedAt");
  if (Number.isNaN(Date.parse(reviewedAt))) throw new Error("A2Vid benchmark.reviewedAt must be an ISO timestamp");
  const outputVideoSha256 = sha256(raw.outputVideoSha256, "A2Vid benchmark.outputVideoSha256");
  const visualReviewReceiptFingerprint = sha256(raw.visualReviewReceiptFingerprint, "A2Vid benchmark.visualReviewReceiptFingerprint");
  return sealed(raw, "self-hosted A2Vid benchmark", {
    version: SELF_HOSTED_LTX_A2VID_BENCHMARK_VERSION,
    benchmarkId: identifier(raw.benchmarkId, "A2Vid benchmark.benchmarkId"),
    runtimeFingerprint: sha256(raw.runtimeFingerprint, "A2Vid benchmark.runtimeFingerprint"),
    referenceConditioningVerdict: "pass" as const,
    musicMotionAlignmentVerdict: "pass" as const,
    temporalStabilityVerdict: "pass" as const,
    outputVideoSha256,
    outputReceiptFingerprint: sha256(raw.outputReceiptFingerprint, "A2Vid benchmark.outputReceiptFingerprint"),
    visualReviewReceiptFingerprint,
    matchedComparison: assertMatchedMusicVideoComparison(
      raw.matchedComparison,
      outputVideoSha256,
      visualReviewReceiptFingerprint,
    ),
    reviewedBy: identifier(raw.reviewedBy, "A2Vid benchmark.reviewedBy"),
    reviewedAt,
  });
}

/**
 * Immutable owner-scoped admission for a benchmarked A2Vid runtime. This is
 * deliberately separate from a per-render work order: it records a reusable
 * capability in the Studio library without retaining music, image, budget, or
 * worker-launch data.
 */
export interface MusicVideoA2VidRuntimeAdmissionCore {
  readonly version: typeof SELF_HOSTED_LTX_A2VID_RUNTIME_ADMISSION_VERSION;
  readonly runtime: MusicVideoA2VidRuntimePinCore;
  readonly benchmark: MusicVideoA2VidBenchmarkCore;
  readonly admittedBy: string;
  readonly admittedAt: string;
}

export interface MusicVideoA2VidRuntimeAdmission extends MusicVideoA2VidRuntimeAdmissionCore {
  readonly runtime: MusicVideoA2VidRuntimePin;
  readonly benchmark: MusicVideoA2VidBenchmark;
  readonly fingerprint: string;
}

export function createMusicVideoA2VidRuntimeAdmission(
  value: MusicVideoA2VidRuntimeAdmissionCore,
): MusicVideoA2VidRuntimeAdmission {
  const raw = record(value, "self-hosted A2Vid runtime admission");
  exactKeys(
    raw,
    ["version", "runtime", "benchmark", "admittedBy", "admittedAt", "fingerprint"],
    "self-hosted A2Vid runtime admission",
  );
  if (raw.version !== SELF_HOSTED_LTX_A2VID_RUNTIME_ADMISSION_VERSION) {
    throw new Error("unsupported self-hosted A2Vid runtime admission version");
  }
  const runtime = createMusicVideoA2VidRuntimePin(
    raw.runtime as MusicVideoA2VidRuntimePinCore,
  );
  const benchmark = createMusicVideoA2VidBenchmark(
    raw.benchmark as MusicVideoA2VidBenchmarkCore,
  );
  if (benchmark.runtimeFingerprint !== runtime.fingerprint) {
    throw new Error("A2Vid runtime admission benchmark does not bind the exact pinned runtime");
  }
  const admittedAt = string(raw.admittedAt, "A2Vid runtime admission.admittedAt");
  if (Number.isNaN(Date.parse(admittedAt))) {
    throw new Error("A2Vid runtime admission.admittedAt must be an ISO timestamp");
  }
  return sealed(raw, "self-hosted A2Vid runtime admission", {
    version: SELF_HOSTED_LTX_A2VID_RUNTIME_ADMISSION_VERSION,
    runtime,
    benchmark,
    admittedBy: identifier(raw.admittedBy, "A2Vid runtime admission.admittedBy"),
    admittedAt,
  });
}

export function assertMusicVideoA2VidRuntimeAdmission(value: unknown): MusicVideoA2VidRuntimeAdmission {
  return createMusicVideoA2VidRuntimeAdmission(value as MusicVideoA2VidRuntimeAdmissionCore);
}

export interface MusicVideoA2VidSpendReservationCore {
  readonly version: typeof SELF_HOSTED_LTX_A2VID_RESERVATION_VERSION;
  readonly reservationId: string;
  readonly spendIntentFingerprint: string;
  readonly budgetLedgerFingerprint: string;
  readonly reservationReceiptFingerprint: string;
  readonly reservedCents: number;
  readonly spendCapCents: number;
  readonly status: "held";
}

export interface MusicVideoA2VidSpendReservation extends MusicVideoA2VidSpendReservationCore {
  readonly fingerprint: string;
}

export function createMusicVideoA2VidSpendReservation(value: MusicVideoA2VidSpendReservationCore): MusicVideoA2VidSpendReservation {
  const raw = record(value, "A2Vid pre-spend reservation");
  exactKeys(raw, ["version", "reservationId", "spendIntentFingerprint", "budgetLedgerFingerprint", "reservationReceiptFingerprint", "reservedCents", "spendCapCents", "status", "fingerprint"], "A2Vid pre-spend reservation");
  if (raw.version !== SELF_HOSTED_LTX_A2VID_RESERVATION_VERSION || raw.status !== "held") throw new Error("A2Vid reservation must be a current held reservation");
  const reservedCents = positiveInteger(raw.reservedCents, "A2Vid reservation.reservedCents");
  const spendCapCents = positiveInteger(raw.spendCapCents, "A2Vid reservation.spendCapCents");
  if (reservedCents > spendCapCents) throw new Error("A2Vid reservation exceeds its sealed spend cap");
  return sealed(raw, "A2Vid pre-spend reservation", {
    version: SELF_HOSTED_LTX_A2VID_RESERVATION_VERSION,
    reservationId: identifier(raw.reservationId, "A2Vid reservation.reservationId"),
    spendIntentFingerprint: sha256(raw.spendIntentFingerprint, "A2Vid reservation.spendIntentFingerprint"),
    budgetLedgerFingerprint: sha256(raw.budgetLedgerFingerprint, "A2Vid reservation.budgetLedgerFingerprint"),
    reservationReceiptFingerprint: sha256(raw.reservationReceiptFingerprint, "A2Vid reservation.reservationReceiptFingerprint"),
    reservedCents,
    spendCapCents,
    status: "held" as const,
  });
}

export interface MusicVideoA2VidWorkOrderCore {
  readonly version: typeof SELF_HOSTED_LTX_A2VID_WORK_ORDER_VERSION;
  readonly audioSegment: MusicVideoA2VidAudioSegment;
  readonly referenceImages: readonly MusicVideoA2VidReferenceImage[];
  readonly runtime: MusicVideoA2VidRuntimePin;
  readonly benchmark: MusicVideoA2VidBenchmark;
  readonly reservation: MusicVideoA2VidSpendReservation;
}

export interface MusicVideoA2VidWorkOrder extends MusicVideoA2VidWorkOrderCore {
  readonly spendIntentFingerprint: string;
  readonly fingerprint: string;
}

function normalizedReferences(value: readonly MusicVideoA2VidReferenceImageCore[]): readonly MusicVideoA2VidReferenceImage[] {
  if (value.length > 2) throw new Error("A2Vid accepts at most an opening and ending approved reference image");
  const refs = value.map(createMusicVideoA2VidReferenceImage).sort((left, right) => left.role.localeCompare(right.role));
  if (new Set(refs.map((reference) => reference.role)).size !== refs.length) throw new Error("A2Vid may include each reference role only once");
  if (refs.some((reference) => reference.role === "ending") && !refs.some((reference) => reference.role === "opening")) {
    throw new Error("A2Vid ending-reference conditioning requires an approved opening reference image");
  }
  return Object.freeze(refs);
}

export function musicVideoA2VidSpendIntentFingerprint(input: {
  readonly audioSegment: MusicVideoA2VidAudioSegment;
  readonly referenceImages: readonly MusicVideoA2VidReferenceImage[];
  readonly runtime: MusicVideoA2VidRuntimePin;
  readonly benchmark: MusicVideoA2VidBenchmark;
}): string {
  return sha256Hex(canonicalJson({
    version: SELF_HOSTED_LTX_A2VID_WORK_ORDER_VERSION,
    audioSegmentFingerprint: input.audioSegment.fingerprint,
    referenceImageFingerprints: input.referenceImages.map((reference) => reference.fingerprint),
    runtimeFingerprint: input.runtime.fingerprint,
    benchmarkFingerprint: input.benchmark.fingerprint,
  }));
}

export type MusicVideoA2VidAdmission =
  | { readonly status: "ready"; readonly workOrder: MusicVideoA2VidWorkOrder }
  | { readonly status: "blocked"; readonly blockers: readonly string[] };

export function admitSelfHostedMusicVideoA2Vid(input: {
  readonly audioSegment: MusicVideoA2VidAudioSegmentCore;
  readonly referenceImages?: readonly MusicVideoA2VidReferenceImageCore[];
  readonly runtime?: MusicVideoA2VidRuntimePinCore;
  readonly benchmark?: MusicVideoA2VidBenchmarkCore;
  readonly reservation?: MusicVideoA2VidSpendReservationCore;
}): MusicVideoA2VidAdmission {
  const blockers: string[] = [];
  let audioSegment: MusicVideoA2VidAudioSegment | undefined;
  let referenceImages: readonly MusicVideoA2VidReferenceImage[] = [];
  let runtime: MusicVideoA2VidRuntimePin | undefined;
  let benchmark: MusicVideoA2VidBenchmark | undefined;

  const attempt = <T>(label: string, operation: () => T, assign: (value: T) => void) => {
    try { assign(operation()); } catch (error) { blockers.push(`${label}: ${error instanceof Error ? error.message : "invalid"}`); }
  };
  attempt("music segment", () => createMusicVideoA2VidAudioSegment(input.audioSegment), (value) => { audioSegment = value; });
  attempt("reference images", () => normalizedReferences(input.referenceImages ?? []), (value) => { referenceImages = value; });
  if (!input.runtime) blockers.push("runtime: no dedicated self-hosted LTX 2.5 A2Vid runtime is pinned");
  else attempt("runtime", () => createMusicVideoA2VidRuntimePin(input.runtime!), (value) => { runtime = value; });
  if (!input.benchmark) blockers.push("benchmark: no passing dedicated A2Vid benchmark is sealed");
  else attempt("benchmark", () => createMusicVideoA2VidBenchmark(input.benchmark!), (value) => { benchmark = value; });

  if (runtime && benchmark && runtime.fingerprint !== benchmark.runtimeFingerprint) {
    blockers.push("benchmark: benchmark does not bind the exact dedicated A2Vid runtime");
  }
  if (!audioSegment || !runtime || !benchmark || blockers.length) return { status: "blocked", blockers: Object.freeze(blockers) };
  const spendIntentFingerprint = musicVideoA2VidSpendIntentFingerprint({ audioSegment, referenceImages, runtime, benchmark });
  if (!input.reservation) return { status: "blocked", blockers: Object.freeze(["reservation: no held bounded A2Vid spend reservation is sealed"]) };
  let reservation: MusicVideoA2VidSpendReservation | undefined;
  attempt("reservation", () => createMusicVideoA2VidSpendReservation(input.reservation!), (value) => { reservation = value; });
  if (!reservation || blockers.length) return { status: "blocked", blockers: Object.freeze(blockers) };
  if (reservation.spendIntentFingerprint !== spendIntentFingerprint) {
    return { status: "blocked", blockers: Object.freeze(["reservation: held reservation does not bind this exact music, references, runtime, and benchmark"]) };
  }
  const core: MusicVideoA2VidWorkOrderCore = Object.freeze({
    version: SELF_HOSTED_LTX_A2VID_WORK_ORDER_VERSION,
    audioSegment,
    referenceImages,
    runtime,
    benchmark,
    reservation,
  });
  return { status: "ready", workOrder: Object.freeze({ ...core, spendIntentFingerprint, fingerprint: sha256Hex(canonicalJson(core)) }) };
}
