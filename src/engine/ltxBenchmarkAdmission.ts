import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { LTX_25_RTX_4090_VIDEO } from "./generationProfiles";

/**
 * This is a review-record foundation, not a runtime switch. The expensive
 * native-720p x2 benchmark is deliberately a different profile from the
 * current 1280x704 production candidate, so its evidence cannot accidentally
 * unlock production rendering.
 */
export const LTX_25_NATIVE_720P_X2_BENCHMARK_CONTRACT =
  "ltx-2.5-rtx4090-720p-native-x2-admission/v1" as const;
export const LTX_25_NATIVE_720P_X2_BENCHMARK_REPORT_CONTRACT =
  "ltx-2.5-rtx4090-720p-native-x2-smoke/v1" as const;
export const LTX_25_IMMUTABLE_BENCHMARK_REPORT_PROOF_CONTRACT =
  "ltx-2.5-immutable-benchmark-report-proof/v1" as const;
export const REVIEWED_LTX_BENCHMARK_ADMISSION_CONTRACT =
  "reviewed-ltx-benchmark-admission/v1" as const;
export const LTX_BENCHMARK_REVIEW_CONTRACT = "ltx-benchmark-review/v2" as const;
export const LTX_BENCHMARK_REVIEW_EVIDENCE_CONTRACT = "ltx-benchmark-review-evidence/v2" as const;
export const MANUAL_LTX_BENCHMARK_RELEASE_APPROVAL_CONTRACT =
  "manual-ltx-benchmark-release-approval/v1" as const;

const SHA256_HEX = /^[a-f0-9]{64}$/;
const GIT_REVISION = /^[a-f0-9]{40}$/;
const SAFE_IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const IMMUTABLE_VERSION = /^[A-Za-z0-9._:-]{8,256}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const BENCHMARK_REPORT_KEY =
  /^novita\/benchmarks\/ltx-2\.5-720p-native-x2-smoke\/[a-f0-9]{24}\/report\.json$/;
const BENCHMARK_ZIMAGE_MODEL = "Tongyi-MAI/Z-Image-Turbo";
const BENCHMARK_ZIMAGE_REVISION = "f332072aa78be7aecdf3ee76d5c247082da564a6";

export interface Ltx25Native720pX2BenchmarkProfile {
  readonly contract: typeof LTX_25_NATIVE_720P_X2_BENCHMARK_CONTRACT;
  readonly model: string;
  readonly revision: string;
  readonly runtimeRepository: string;
  readonly runtimeRevision: string;
  readonly runtimeBundleKey: string;
  readonly runtimeBundleSha256: string;
  readonly workerImage: string;
  readonly workerOverlaySha256: string;
  readonly gpuSku: "RTX 4090";
  readonly vramGb: 24;
  readonly checkpoint: string;
  readonly textEncoderCheckpoint: string;
  readonly videoVaeCheckpoint: string;
  readonly audioVaeCheckpoint: string;
  readonly spatialUpscalerCheckpoint: string;
  readonly stageOneWidth: 1280;
  readonly stageOneHeight: 704;
  readonly outputWidth: 2560;
  readonly outputHeight: 1408;
  readonly fps: 25;
  readonly frameCount: 17;
  readonly steps: 8;
  readonly guidanceScale: 1;
  readonly precision: "bf16";
  readonly pipeline: "distilled";
  readonly twoStageRefine: true;
  readonly spatialUpscaleFactor: 2;
  readonly quantization: "fp8-cast";
  readonly offload: "cpu";
}

/**
 * Exact contract used only by scripts/run-ltx25-benchmark.mjs. Its worker
 * image is digest-pinned and all visual/runtime-affecting profile fields are
 * fingerprinted. This value is not part of GENERATION_PROFILES.
 */
export const LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE: Ltx25Native720pX2BenchmarkProfile =
  Object.freeze({
    contract: LTX_25_NATIVE_720P_X2_BENCHMARK_CONTRACT,
    model: LTX_25_RTX_4090_VIDEO.model,
    revision: LTX_25_RTX_4090_VIDEO.revision,
    runtimeRepository: LTX_25_RTX_4090_VIDEO.runtimeRepository,
    runtimeRevision: LTX_25_RTX_4090_VIDEO.runtimeRevision,
    runtimeBundleKey:
      "novita/runtime/ltx-2.5/ff616214c4a8901f003a1ef0815220d596f709eeb5027fb575b643a97e11c579.tar.gz",
    runtimeBundleSha256: "ff616214c4a8901f003a1ef0815220d596f709eeb5027fb575b643a97e11c579",
    workerImage:
      "pytorch/pytorch@sha256:417bd75df6365104c283ea4c1651fb3530d9eb5a4c2fafa51943cff2a94e6385",
    // Any worker-side adapter validation change requires a fresh benchmark.
    // This profile now pins the current worker that verifies complementary
    // standard-LoRA stacks and their combined quality evidence. The release
    // registry remains empty until that exact worker receives a new paid,
    // reviewed RTX 4090 proof run.
    workerOverlaySha256: "93525478741303137728cfd25ee03f92d66c732ec621f980d35bb3e3299647ba",
    gpuSku: "RTX 4090",
    vramGb: 24,
    checkpoint: LTX_25_RTX_4090_VIDEO.checkpoint,
    textEncoderCheckpoint: LTX_25_RTX_4090_VIDEO.textEncoderCheckpoint,
    videoVaeCheckpoint: LTX_25_RTX_4090_VIDEO.videoVaeCheckpoint,
    audioVaeCheckpoint: LTX_25_RTX_4090_VIDEO.audioVaeCheckpoint,
    spatialUpscalerCheckpoint: LTX_25_RTX_4090_VIDEO.spatialUpscalerCheckpoint,
    stageOneWidth: 1280,
    stageOneHeight: 704,
    outputWidth: 2560,
    outputHeight: 1408,
    fps: 25,
    frameCount: 17,
    steps: 8,
    guidanceScale: 1,
    precision: "bf16",
    pipeline: "distilled",
    twoStageRefine: true,
    spatialUpscaleFactor: 2,
    quantization: "fp8-cast",
    offload: "cpu",
  });

const PROFILE_KEYS = Object.freeze(Object.keys(LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE));

export interface LtxBenchmarkProfileValidation {
  readonly exact: boolean;
  readonly blockers: readonly string[];
  readonly profileFingerprint?: string;
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function assertKnownKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  const extras = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (extras.length > 0) {
    throw new Error(`${label} has unrecognized fields: ${extras.sort().join(", ")}`);
  }
}

function requiredString(value: Readonly<Record<string, unknown>>, key: string, label: string): string {
  const field = value[key];
  if (typeof field !== "string" || !field.trim()) {
    throw new Error(`${label}.${key} must be a non-empty string`);
  }
  return field;
}

function requiredSha256(value: Readonly<Record<string, unknown>>, key: string, label: string): string {
  const field = requiredString(value, key, label);
  if (!SHA256_HEX.test(field)) throw new Error(`${label}.${key} must be a lowercase SHA-256`);
  return field;
}

function requiredIdentifier(value: Readonly<Record<string, unknown>>, key: string, label: string): string {
  const field = requiredString(value, key, label);
  if (!SAFE_IDENTIFIER.test(field)) throw new Error(`${label}.${key} is not a safe stable identifier`);
  return field;
}

function requiredUtcTimestamp(value: Readonly<Record<string, unknown>>, key: string, label: string): string {
  const field = requiredString(value, key, label);
  if (!ISO_UTC.test(field) || !Number.isFinite(Date.parse(field))) {
    throw new Error(`${label}.${key} must be a UTC ISO-8601 timestamp`);
  }
  return field;
}

function requiredPositiveInteger(value: Readonly<Record<string, unknown>>, key: string, label: string): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isSafeInteger(field) || field < 1) {
    throw new Error(`${label}.${key} must be a positive integer`);
  }
  return field;
}

function requiredPositiveNumber(value: Readonly<Record<string, unknown>>, key: string, label: string): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isFinite(field) || field <= 0) {
    throw new Error(`${label}.${key} must be a positive finite number`);
  }
  return field;
}

function immutableProfileCore(): Ltx25Native720pX2BenchmarkProfile {
  return LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE;
}

/** Exact comparison rejects both a changed render field and an untracked field. */
export function assessLtx25Native720pX2BenchmarkProfile(profile: unknown): LtxBenchmarkProfileValidation {
  let raw: Readonly<Record<string, unknown>>;
  try {
    raw = record(profile, "LTX benchmark profile");
  } catch (error) {
    return { exact: false, blockers: [error instanceof Error ? error.message : "invalid_ltx_benchmark_profile"] };
  }

  const expected = immutableProfileCore();
  const blockers: string[] = [];
  const expectedKeys = new Set(PROFILE_KEYS);
  for (const key of Object.keys(raw)) {
    if (!expectedKeys.has(key)) blockers.push(`ltx_benchmark_profile_unrecognized_${key}`);
  }
  for (const key of PROFILE_KEYS) {
    if (raw[key] !== expected[key as keyof Ltx25Native720pX2BenchmarkProfile]) {
      blockers.push(`ltx_benchmark_profile_${key}_mismatch`);
    }
  }
  if (blockers.length > 0) return { exact: false, blockers: Object.freeze(blockers.sort()) };
  return {
    exact: true,
    blockers: Object.freeze([]),
    profileFingerprint: ltx25Native720pX2BenchmarkProfileFingerprint(),
  };
}

/** Throws instead of silently normalizing a changed benchmark profile. */
export function assertExactLtx25Native720pX2BenchmarkProfile(
  profile: unknown,
): Ltx25Native720pX2BenchmarkProfile {
  const assessment = assessLtx25Native720pX2BenchmarkProfile(profile);
  if (!assessment.exact) {
    throw new Error(`LTX benchmark profile is not the sealed native-720p x2 contract: ${assessment.blockers.join("; ")}`);
  }
  return immutableProfileCore();
}

/** Canonical digest of every field that can change the benchmark runtime or output. */
export function ltx25Native720pX2BenchmarkProfileFingerprint(profile?: unknown): string {
  if (profile !== undefined) assertExactLtx25Native720pX2BenchmarkProfile(profile);
  return sha256Hex(canonicalJson(immutableProfileCore()));
}

export const LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE_FINGERPRINT =
  ltx25Native720pX2BenchmarkProfileFingerprint();

export interface ImmutableLtxBenchmarkReportProofCore {
  readonly contract: typeof LTX_25_IMMUTABLE_BENCHMARK_REPORT_PROOF_CONTRACT;
  readonly reportContract: typeof LTX_25_NATIVE_720P_X2_BENCHMARK_REPORT_CONTRACT;
  readonly reportKey: string;
  /**
   * Version/retention identifier recorded by a human's immutable-object check.
   * This pure module only binds the asserted value; it never contacts R2 and
   * must not be described as independently proving object retention.
   */
  readonly immutableObjectVersionId: string;
  /** SHA-256 of the exact immutable R2 report bytes. */
  readonly reportContentSha256: string;
  /** The report's internally sealed canonical-content SHA-256. */
  readonly reportSha256: string;
  readonly terminalStatus: "complete";
  readonly profileFingerprint: string;
  /** Fingerprint of all controller-side output evidence retained in the report. */
  readonly outputProofSha256: string;
  readonly outputCount: 1;
  /** The exact native-720p x2 output that an independent quality review must inspect. */
  readonly outputId: string;
  readonly outputKey: string;
  readonly outputVideoSha256: string;
}

export interface ImmutableLtxBenchmarkReportProof extends ImmutableLtxBenchmarkReportProofCore {
  readonly proofFingerprint: string;
}

const REPORT_PROOF_CORE_KEYS = Object.freeze([
  "contract",
  "reportContract",
  "reportKey",
  "immutableObjectVersionId",
  "reportContentSha256",
  "reportSha256",
  "terminalStatus",
  "profileFingerprint",
  "outputProofSha256",
  "outputCount",
  "outputId",
  "outputKey",
  "outputVideoSha256",
] as const);
const REPORT_PROOF_KEYS = Object.freeze([...REPORT_PROOF_CORE_KEYS, "proofFingerprint"]);

function immutableReportProofCore(value: unknown): ImmutableLtxBenchmarkReportProofCore {
  const raw = record(value, "immutable LTX benchmark report proof");
  assertKnownKeys(raw, REPORT_PROOF_KEYS, "immutable LTX benchmark report proof");
  if (raw.contract !== LTX_25_IMMUTABLE_BENCHMARK_REPORT_PROOF_CONTRACT) {
    throw new Error("immutable LTX benchmark report proof.contract is unsupported");
  }
  if (raw.reportContract !== LTX_25_NATIVE_720P_X2_BENCHMARK_REPORT_CONTRACT) {
    throw new Error("immutable LTX benchmark report proof.reportContract is unsupported");
  }
  const reportKey = requiredString(raw, "reportKey", "immutable LTX benchmark report proof");
  if (!BENCHMARK_REPORT_KEY.test(reportKey)) {
    throw new Error("immutable LTX benchmark report proof.reportKey is not a native-720p x2 terminal report");
  }
  const immutableObjectVersionId = requiredString(raw, "immutableObjectVersionId", "immutable LTX benchmark report proof");
  if (!IMMUTABLE_VERSION.test(immutableObjectVersionId)) {
    throw new Error("immutable LTX benchmark report proof.immutableObjectVersionId is invalid");
  }
  const profileFingerprint = requiredSha256(raw, "profileFingerprint", "immutable LTX benchmark report proof");
  if (profileFingerprint !== LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE_FINGERPRINT) {
    throw new Error("immutable LTX benchmark report proof.profileFingerprint does not bind the sealed native-720p x2 profile");
  }
  if (raw.terminalStatus !== "complete") {
    throw new Error("immutable LTX benchmark report proof.terminalStatus must be complete");
  }
  if (raw.outputCount !== 1) {
    throw new Error("immutable LTX benchmark report proof.outputCount must bind the single smoke output");
  }
  const benchmarkRoot = reportKey.slice(0, -"/report.json".length);
  const outputId = requiredIdentifier(raw, "outputId", "immutable LTX benchmark report proof");
  const outputKey = requiredString(raw, "outputKey", "immutable LTX benchmark report proof");
  if (outputKey !== `${benchmarkRoot}/video/outputs/${outputId}.mp4`) {
    throw new Error("immutable LTX benchmark report proof.outputKey is not bound to the immutable report root");
  }
  return {
    contract: LTX_25_IMMUTABLE_BENCHMARK_REPORT_PROOF_CONTRACT,
    reportContract: LTX_25_NATIVE_720P_X2_BENCHMARK_REPORT_CONTRACT,
    reportKey,
    immutableObjectVersionId,
    reportContentSha256: requiredSha256(raw, "reportContentSha256", "immutable LTX benchmark report proof"),
    reportSha256: requiredSha256(raw, "reportSha256", "immutable LTX benchmark report proof"),
    terminalStatus: "complete",
    profileFingerprint,
    outputProofSha256: requiredSha256(raw, "outputProofSha256", "immutable LTX benchmark report proof"),
    outputCount: 1,
    outputId,
    outputKey,
    outputVideoSha256: requiredSha256(raw, "outputVideoSha256", "immutable LTX benchmark report proof"),
  };
}

export function ltxBenchmarkReportProofFingerprint(
  proof: ImmutableLtxBenchmarkReportProofCore,
): string {
  // The core parser deliberately permits a missing proofFingerprint for a
  // release author constructing an immutable record, then validates every
  // actual registry entry below.
  const raw = record(proof, "immutable LTX benchmark report proof");
  assertKnownKeys(raw, REPORT_PROOF_CORE_KEYS, "immutable LTX benchmark report proof");
  return sha256Hex(canonicalJson(immutableReportProofCore({ ...proof, proofFingerprint: "0".repeat(64) })));
}

export function assertImmutableLtxBenchmarkReportProof(value: unknown): ImmutableLtxBenchmarkReportProof {
  const raw = record(value, "immutable LTX benchmark report proof");
  const core = immutableReportProofCore(raw);
  const proofFingerprint = requiredSha256(raw, "proofFingerprint", "immutable LTX benchmark report proof");
  const expected = ltxBenchmarkReportProofFingerprint(core);
  if (proofFingerprint !== expected) {
    throw new Error("immutable LTX benchmark report proof fingerprint does not match its sealed fields");
  }
  return Object.freeze({ ...core, proofFingerprint });
}

export interface DeriveImmutableLtxBenchmarkReportProofInput {
  readonly reportKey: string;
  readonly immutableObjectVersionId: string;
  /** Exact UTF-8 JSON bytes downloaded from the immutable report object. */
  readonly reportJson: string;
}

function assertTerminalLtxFacts(raw: Readonly<Record<string, unknown>>, reportKey: string): void {
  assertKnownKeys(raw, [
    "contract", "ok", "nonce", "ltxModelManifestKey", "stageMaxUsd", "spotRateUsdPerHour", "phaseMaxSeconds",
    "zImage", "ltx", "outputs", "status", "reportSha256",
  ], "terminal LTX benchmark report");
  if (raw.contract !== LTX_25_NATIVE_720P_X2_BENCHMARK_REPORT_CONTRACT || raw.ok !== true || raw.status !== "complete") {
    throw new Error("terminal LTX benchmark report is not a complete native-720p x2 success report");
  }
  const nonce = requiredString(raw, "nonce", "terminal LTX benchmark report");
  if (!/^[a-f0-9]{24}$/.test(nonce)) throw new Error("terminal LTX benchmark report.nonce is invalid");
  if (!reportKey.includes(`/${nonce}/report.json`)) {
    throw new Error("terminal LTX benchmark report nonce does not bind its immutable report key");
  }
  const manifestKey = requiredString(raw, "ltxModelManifestKey", "terminal LTX benchmark report");
  if (!/^novita\/model-manifests\/ltx-2\.5-[a-f0-9-]+\.json$/.test(manifestKey)) {
    throw new Error("terminal LTX benchmark report.ltxModelManifestKey is invalid");
  }
  requiredPositiveNumber(raw, "stageMaxUsd", "terminal LTX benchmark report");
  requiredPositiveNumber(raw, "spotRateUsdPerHour", "terminal LTX benchmark report");
  requiredPositiveInteger(raw, "phaseMaxSeconds", "terminal LTX benchmark report");

  const zImage = record(raw.zImage, "terminal LTX benchmark report.zImage");
  assertKnownKeys(zImage, ["model", "revision", "volumeReceipt"], "terminal LTX benchmark report.zImage");
  if (zImage.model !== BENCHMARK_ZIMAGE_MODEL || zImage.revision !== BENCHMARK_ZIMAGE_REVISION) {
    throw new Error("terminal LTX benchmark report.zImage does not match the sealed stage-one source model");
  }
  const volumeReceipt = record(zImage.volumeReceipt, "terminal LTX benchmark report.zImage.volumeReceipt");
  assertKnownKeys(volumeReceipt, ["contract", "ok", "sourcePath", "manifestSha256", "fileCount"], "terminal LTX benchmark report.zImage.volumeReceipt");
  if (volumeReceipt.contract !== "zimage-volume-probe/v1" || volumeReceipt.ok !== true || volumeReceipt.sourcePath !== "models/z-image") {
    throw new Error("terminal LTX benchmark report.zImage.volumeReceipt is not a valid source-volume receipt");
  }
  requiredSha256(volumeReceipt, "manifestSha256", "terminal LTX benchmark report.zImage.volumeReceipt");
  requiredPositiveInteger(volumeReceipt, "fileCount", "terminal LTX benchmark report.zImage.volumeReceipt");

  const ltx = record(raw.ltx, "terminal LTX benchmark report.ltx");
  assertKnownKeys(ltx, [
    "model", "revision", "runtimeRepository", "runtimeRevision", "runtimeBundleKey", "runtimeBundleSha256", "workerImage",
    "gpuSku", "gpuCount", "vramGb", "checkpoint", "textEncoderCheckpoint", "videoVaeCheckpoint", "audioVaeCheckpoint",
    "spatialUpscalerCheckpoint", "pipeline", "stageOne", "output", "frames", "steps", "guidanceScale", "precision",
    "twoStageRefine", "spatialUpscaleFactor", "quantization", "offload", "maxSampledPeakVramMib", "workerOverlaySha256",
    "videoManifestKey", "videoManifestSha256", "videoProfileSha256",
  ], "terminal LTX benchmark report.ltx");
  const expected = immutableProfileCore();
  const checks: ReadonlyArray<readonly [string, unknown]> = [
    ["model", expected.model],
    ["revision", expected.revision],
    ["runtimeRepository", expected.runtimeRepository],
    ["runtimeRevision", expected.runtimeRevision],
    ["runtimeBundleKey", expected.runtimeBundleKey],
    ["runtimeBundleSha256", expected.runtimeBundleSha256],
    ["workerImage", expected.workerImage],
    ["gpuSku", expected.gpuSku],
    ["gpuCount", 1],
    ["vramGb", expected.vramGb],
    ["checkpoint", expected.checkpoint],
    ["textEncoderCheckpoint", expected.textEncoderCheckpoint],
    ["videoVaeCheckpoint", expected.videoVaeCheckpoint],
    ["audioVaeCheckpoint", expected.audioVaeCheckpoint],
    ["spatialUpscalerCheckpoint", expected.spatialUpscalerCheckpoint],
    ["pipeline", expected.pipeline],
    ["stageOne", `${expected.stageOneWidth}x${expected.stageOneHeight}`],
    ["output", `${expected.outputWidth}x${expected.outputHeight}@${expected.fps}`],
    ["frames", expected.frameCount],
    ["steps", expected.steps],
    ["guidanceScale", expected.guidanceScale],
    ["precision", expected.precision],
    ["twoStageRefine", expected.twoStageRefine],
    ["spatialUpscaleFactor", expected.spatialUpscaleFactor],
    ["quantization", expected.quantization],
    ["offload", expected.offload],
    ["workerOverlaySha256", expected.workerOverlaySha256],
  ];
  for (const [field, required] of checks) {
    if (ltx[field] !== required) {
      throw new Error(`terminal LTX benchmark report.ltx.${field} does not match the sealed native-720p x2 profile`);
    }
  }
  const benchmarkRoot = reportKey.slice(0, -"/report.json".length);
  if (ltx.videoManifestKey !== `${benchmarkRoot}/video/control/manifest.json`) {
    throw new Error("terminal LTX benchmark report.ltx.videoManifestKey is not bound to the immutable report root");
  }
  requiredSha256(ltx, "videoManifestSha256", "terminal LTX benchmark report.ltx");
  requiredSha256(ltx, "videoProfileSha256", "terminal LTX benchmark report.ltx");
  if (ltx.maxSampledPeakVramMib !== 22_000) {
    throw new Error("terminal LTX benchmark report.ltx.maxSampledPeakVramMib is not the sealed benchmark gate");
  }

  const outputs = raw.outputs;
  if (!Array.isArray(outputs) || outputs.length !== 1) {
    throw new Error("terminal LTX benchmark report must retain exactly one controller-bound smoke output");
  }
  const output = record(outputs[0], "terminal LTX benchmark report.outputs[0]");
  assertKnownKeys(output, ["id", "key", "inputArtifact", "proof", "controllerProof"], "terminal LTX benchmark report.outputs[0]");
  const outputId = requiredIdentifier(output, "id", "terminal LTX benchmark report.outputs[0]");
  if (output.key !== `${benchmarkRoot}/video/outputs/${outputId}.mp4`) {
    throw new Error("terminal LTX benchmark report output key is not bound to the immutable report root");
  }
  const inputArtifact = record(output.inputArtifact, "terminal LTX benchmark report.outputs[0].inputArtifact");
  assertKnownKeys(inputArtifact, ["key", "sha256"], "terminal LTX benchmark report.outputs[0].inputArtifact");
  if (inputArtifact.key !== `${benchmarkRoot}/image/outputs/${outputId}.png`) {
    throw new Error("terminal LTX benchmark report input artifact key is not bound to the preceding image phase");
  }
  const inputSha256 = requiredSha256(inputArtifact, "sha256", "terminal LTX benchmark report.outputs[0].inputArtifact");
  const workerProof = record(output.proof, "terminal LTX benchmark report.outputs[0].proof");
  assertKnownKeys(workerProof, [
    "outputWidth", "outputHeight", "hasAudio", "frameCount", "frameRate", "stageOneWidth", "stageOneHeight",
    "spatialUpscaleFactor", "pipeline", "quantization", "offload", "sampledPeakVramMib", "inputGeometry",
  ], "terminal LTX benchmark report.outputs[0].proof");
  const workerChecks: ReadonlyArray<readonly [string, unknown]> = [
    ["outputWidth", expected.outputWidth],
    ["outputHeight", expected.outputHeight],
    ["stageOneWidth", expected.stageOneWidth],
    ["stageOneHeight", expected.stageOneHeight],
    ["spatialUpscaleFactor", expected.spatialUpscaleFactor],
    ["pipeline", expected.pipeline],
    ["quantization", expected.quantization],
    ["offload", expected.offload],
    ["frameCount", expected.frameCount],
    ["frameRate", expected.fps],
    ["hasAudio", true],
  ];
  for (const [field, required] of workerChecks) {
    if (workerProof[field] !== required) {
      throw new Error(`terminal LTX benchmark report.outputs[0].proof.${field} does not match the sealed profile`);
    }
  }
  const sampledPeakVramMib = workerProof.sampledPeakVramMib;
  if (
    typeof sampledPeakVramMib !== "number"
    || !Number.isInteger(sampledPeakVramMib)
    || sampledPeakVramMib < 0
    || sampledPeakVramMib > 22_000
  ) {
    throw new Error("terminal LTX benchmark report.outputs[0].proof.sampledPeakVramMib violates the 22 GiB gate");
  }
  const inputGeometry = record(workerProof.inputGeometry, "terminal LTX benchmark report.outputs[0].proof.inputGeometry");
  assertKnownKeys(inputGeometry, ["initial"], "terminal LTX benchmark report.outputs[0].proof.inputGeometry");
  const initialGeometry = record(inputGeometry.initial, "terminal LTX benchmark report.outputs[0].proof.inputGeometry.initial");
  assertKnownKeys(initialGeometry, ["sha256", "width", "height"], "terminal LTX benchmark report.outputs[0].proof.inputGeometry.initial");
  if (
    requiredSha256(initialGeometry, "sha256", "terminal LTX benchmark report.outputs[0].proof.inputGeometry.initial") !== inputSha256
    || initialGeometry.width !== expected.stageOneWidth
    || initialGeometry.height !== expected.stageOneHeight
  ) {
    throw new Error("terminal LTX benchmark report initial source geometry is not bound to the exact image artifact");
  }

  const controllerProof = record(output.controllerProof, "terminal LTX benchmark report.outputs[0].controllerProof");
  assertKnownKeys(controllerProof, ["sha256", "sizeBytes", "media"], "terminal LTX benchmark report.outputs[0].controllerProof");
  requiredSha256(controllerProof, "sha256", "terminal LTX benchmark report.outputs[0].controllerProof");
  requiredPositiveInteger(controllerProof, "sizeBytes", "terminal LTX benchmark report.outputs[0].controllerProof");
  const media = record(controllerProof.media, "terminal LTX benchmark report.outputs[0].controllerProof.media");
  assertKnownKeys(media, ["container", "durationSeconds", "video", "audio"], "terminal LTX benchmark report.outputs[0].controllerProof.media");
  requiredString(media, "container", "terminal LTX benchmark report.outputs[0].controllerProof.media");
  requiredPositiveNumber(media, "durationSeconds", "terminal LTX benchmark report.outputs[0].controllerProof.media");
  const video = record(media.video, "terminal LTX benchmark report.outputs[0].controllerProof.media.video");
  assertKnownKeys(video, ["codec", "pixelFormat", "width", "height", "frameRate", "frameCount"], "terminal LTX benchmark report.outputs[0].controllerProof.media.video");
  requiredString(video, "codec", "terminal LTX benchmark report.outputs[0].controllerProof.media.video");
  requiredString(video, "pixelFormat", "terminal LTX benchmark report.outputs[0].controllerProof.media.video");
  if (video.width !== expected.outputWidth || video.height !== expected.outputHeight || video.frameRate !== expected.fps || video.frameCount !== expected.frameCount) {
    throw new Error("terminal LTX benchmark report controller media proof does not match the sealed output geometry");
  }
  const audio = record(media.audio, "terminal LTX benchmark report.outputs[0].controllerProof.media.audio");
  assertKnownKeys(audio, ["present", "codec", "channels", "sampleRate"], "terminal LTX benchmark report.outputs[0].controllerProof.media.audio");
  if (audio.present !== true) throw new Error("terminal LTX benchmark report controller proof omits audio evidence");
  requiredString(audio, "codec", "terminal LTX benchmark report.outputs[0].controllerProof.media.audio");
  requiredPositiveInteger(audio, "channels", "terminal LTX benchmark report.outputs[0].controllerProof.media.audio");
  requiredPositiveInteger(audio, "sampleRate", "terminal LTX benchmark report.outputs[0].controllerProof.media.audio");
}

/**
 * Derive a reviewable proof from caller-supplied report bytes. The caller must
 * independently verify R2 version/retention and pass the exact downloaded
 * bytes; this pure helper neither reads storage nor proves durability, and it
 * never admits the result to the registry or runtime.
 */
export function deriveImmutableLtxBenchmarkReportProof(
  input: DeriveImmutableLtxBenchmarkReportProofInput,
): ImmutableLtxBenchmarkReportProof {
  const rawInput = record(input, "immutable LTX benchmark report input");
  assertKnownKeys(rawInput, ["reportKey", "immutableObjectVersionId", "reportJson"], "immutable LTX benchmark report input");
  const reportKey = requiredString(rawInput, "reportKey", "immutable LTX benchmark report input");
  if (!BENCHMARK_REPORT_KEY.test(reportKey)) {
    throw new Error("immutable LTX benchmark report input.reportKey is not a native-720p x2 terminal report");
  }
  const immutableObjectVersionId = requiredString(rawInput, "immutableObjectVersionId", "immutable LTX benchmark report input");
  if (!IMMUTABLE_VERSION.test(immutableObjectVersionId)) {
    throw new Error("immutable LTX benchmark report input.immutableObjectVersionId is invalid");
  }
  const reportJson = requiredString(rawInput, "reportJson", "immutable LTX benchmark report input");
  let decoded: unknown;
  try {
    decoded = JSON.parse(reportJson);
  } catch {
    throw new Error("immutable LTX benchmark report input.reportJson is not valid JSON");
  }
  const terminal = record(decoded, "terminal LTX benchmark report");
  assertTerminalLtxFacts(terminal, reportKey);
  const reportSha256 = requiredSha256(terminal, "reportSha256", "terminal LTX benchmark report");
  const { reportSha256: _reportSha256, ...terminalCore } = terminal;
  void _reportSha256;
  if (reportSha256 !== sha256Hex(canonicalJson(terminalCore))) {
    throw new Error("terminal LTX benchmark report.reportSha256 does not match its canonical terminal content");
  }
  const outputs = terminal.outputs as readonly unknown[];
  const output = record(outputs[0], "terminal LTX benchmark report.outputs[0]");
  const outputId = requiredIdentifier(output, "id", "terminal LTX benchmark report.outputs[0]");
  const outputKey = requiredString(output, "key", "terminal LTX benchmark report.outputs[0]");
  const controllerProof = record(output.controllerProof, "terminal LTX benchmark report.outputs[0].controllerProof");
  const core: ImmutableLtxBenchmarkReportProofCore = {
    contract: LTX_25_IMMUTABLE_BENCHMARK_REPORT_PROOF_CONTRACT,
    reportContract: LTX_25_NATIVE_720P_X2_BENCHMARK_REPORT_CONTRACT,
    reportKey,
    immutableObjectVersionId,
    reportContentSha256: sha256Hex(reportJson),
    reportSha256,
    terminalStatus: "complete",
    profileFingerprint: LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE_FINGERPRINT,
    outputProofSha256: sha256Hex(canonicalJson(outputs)),
    outputCount: 1,
    outputId,
    outputKey,
    outputVideoSha256: requiredSha256(controllerProof, "sha256", "terminal LTX benchmark report.outputs[0].controllerProof"),
  };
  return assertImmutableLtxBenchmarkReportProof({
    ...core,
    proofFingerprint: ltxBenchmarkReportProofFingerprint(core),
  });
}

export interface LtxBenchmarkReview {
  readonly contract: typeof LTX_BENCHMARK_REVIEW_CONTRACT;
  readonly verdict: "pass";
  readonly reviewId: string;
  readonly reviewedBy: string;
  readonly reviewedAt: string;
  readonly profileFingerprint: string;
  readonly reportProofFingerprint: string;
  /** Retained review evidence for the exact immutable benchmark output. */
  readonly evidence: LtxBenchmarkReviewEvidence;
}

const LTX_BENCHMARK_QUALITY_CRITERIA = Object.freeze([
  // This sealed smoke profile lasts only 0.68 seconds. Quality evidence must
  // therefore span nearly the full take: a clustered sample can miss the
  // very temporal defects (identity drift, camera pops, late artifacts) that
  // make an LTX clip unusable in a polished edit.
  { id: "story-and-subject-continuity", scope: "frame" as const, minimumReviewFrames: 3, minimumTemporalSpanSec: 0.5 },
  { id: "camera-motion-and-temporal-integrity", scope: "global" as const, minimumReviewFrames: 4, minimumTemporalSpanSec: 0.5 },
  { id: "artifact-freedom", scope: "global" as const, minimumReviewFrames: 4, minimumTemporalSpanSec: 0.5 },
  { id: "final-image-and-audio-fidelity", scope: "global" as const, minimumReviewFrames: 4, minimumTemporalSpanSec: 0.5 },
]);

export interface LtxBenchmarkReviewEvidence {
  readonly contract: typeof LTX_BENCHMARK_REVIEW_EVIDENCE_CONTRACT;
  readonly evidenceKey: string;
  readonly immutableEvidenceObjectVersionId: string;
  readonly evidenceSha256: string;
  readonly visualReviewReceiptFingerprint: string;
  readonly outputId: string;
  readonly outputKey: string;
  readonly outputVideoSha256: string;
  readonly criterionEvidence: readonly {
    readonly id: string;
    readonly scope: "global" | "frame";
    readonly verdict: "pass";
    /** Durable extracted frames from distinct moments, never inline media. */
    readonly reviewFrames: readonly { readonly artifactId: string; readonly tSec: number }[];
  }[];
}

export interface ManualLtxBenchmarkReleaseApproval {
  readonly contract: typeof MANUAL_LTX_BENCHMARK_RELEASE_APPROVAL_CONTRACT;
  readonly decision: "approved";
  readonly approvalId: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  /** Git revision that added this static registry entry to a release. */
  readonly releaseRevision: string;
  readonly profileFingerprint: string;
  readonly reportProofFingerprint: string;
}

function ltxBenchmarkReviewEvidence(
  value: unknown,
  report: ImmutableLtxBenchmarkReportProof,
): LtxBenchmarkReviewEvidence {
  const raw = record(value, "LTX benchmark review evidence");
  assertKnownKeys(raw, [
    "contract", "evidenceKey", "immutableEvidenceObjectVersionId", "evidenceSha256", "visualReviewReceiptFingerprint",
    "outputId", "outputKey", "outputVideoSha256", "criterionEvidence",
  ], "LTX benchmark review evidence");
  if (raw.contract !== LTX_BENCHMARK_REVIEW_EVIDENCE_CONTRACT) {
    throw new Error("LTX benchmark review evidence.contract is unsupported");
  }
  const benchmarkRoot = report.reportKey.slice(0, -"/report.json".length);
  const evidenceKey = requiredString(raw, "evidenceKey", "LTX benchmark review evidence");
  if (evidenceKey !== `${benchmarkRoot}/review/evidence.json`) {
    throw new Error("LTX benchmark review evidence.evidenceKey is not bound to the immutable report root");
  }
  const outputId = requiredIdentifier(raw, "outputId", "LTX benchmark review evidence");
  const outputKey = requiredString(raw, "outputKey", "LTX benchmark review evidence");
  const outputVideoSha256 = requiredSha256(raw, "outputVideoSha256", "LTX benchmark review evidence");
  if (outputId !== report.outputId || outputKey !== report.outputKey || outputVideoSha256 !== report.outputVideoSha256) {
    throw new Error("LTX benchmark review evidence does not bind the exact immutable benchmark output");
  }
  if (!Array.isArray(raw.criterionEvidence)) throw new Error("LTX benchmark review evidence.criterionEvidence must be an array");
  const expectedCriteria = new Map(LTX_BENCHMARK_QUALITY_CRITERIA.map((criterion) => [criterion.id, criterion]));
  const criterionEvidence = raw.criterionEvidence.map((value) => {
    const criterion = record(value, "LTX benchmark review criterion evidence");
    assertKnownKeys(criterion, ["id", "scope", "verdict", "reviewFrames"], "LTX benchmark review criterion evidence");
    const id = requiredString(criterion, "id", "LTX benchmark review criterion evidence");
    const scope = criterion.scope === "frame" || criterion.scope === "global" ? criterion.scope : undefined;
    const expectedCriterion = expectedCriteria.get(id);
    if (!scope || expectedCriterion?.scope !== scope || criterion.verdict !== "pass") {
      throw new Error("LTX benchmark review criterion evidence does not match a passing required quality criterion");
    }
    if (
      !Array.isArray(criterion.reviewFrames)
      || criterion.reviewFrames.length < expectedCriterion.minimumReviewFrames
    ) {
      throw new Error(
        `LTX benchmark review criterion evidence requires at least ${expectedCriterion.minimumReviewFrames} retained review frames for ${id}`,
      );
    }
    const maxTimestampSec = LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE.frameCount /
      LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE.fps;
    const reviewFrames = criterion.reviewFrames.map((value) => {
      const frame = record(value, "LTX benchmark review frame witness");
      assertKnownKeys(frame, ["artifactId", "tSec"], "LTX benchmark review frame witness");
      const tSec = frame.tSec;
      if (typeof tSec !== "number" || !Number.isFinite(tSec) || tSec < 0 || tSec > maxTimestampSec) {
        throw new Error("LTX benchmark review frame witness.tSec must identify a moment within the sealed benchmark output");
      }
      return Object.freeze({
        artifactId: requiredIdentifier({ id: frame.artifactId }, "id", "LTX benchmark review frame witness.artifactId"),
        tSec,
      });
    }).sort((left, right) => left.tSec - right.tSec || left.artifactId.localeCompare(right.artifactId));
    if (new Set(reviewFrames.map((frame) => frame.artifactId)).size !== reviewFrames.length) {
      throw new Error("LTX benchmark review criterion evidence may not duplicate review-frame artifacts");
    }
    if (new Set(reviewFrames.map((frame) => frame.tSec)).size !== reviewFrames.length) {
      throw new Error("LTX benchmark review criterion evidence must bind distinct temporal moments");
    }
    const temporalSpanSec = reviewFrames.at(-1)!.tSec - reviewFrames[0]!.tSec;
    if (temporalSpanSec < expectedCriterion.minimumTemporalSpanSec) {
      throw new Error(
        `LTX benchmark review criterion evidence requires ${expectedCriterion.minimumTemporalSpanSec}s temporal coverage for ${id}`,
      );
    }
    return Object.freeze({ id, scope, verdict: "pass" as const, reviewFrames: Object.freeze(reviewFrames) });
  }).sort((left, right) => left.id.localeCompare(right.id));
  const expectedIds = [...expectedCriteria.keys()].sort();
  if (
    criterionEvidence.length !== expectedIds.length
    || new Set(criterionEvidence.map((criterion) => criterion.id)).size !== criterionEvidence.length
    || criterionEvidence.some((criterion, index) => criterion.id !== expectedIds[index])
  ) {
    throw new Error("LTX benchmark review evidence must retain passing witnesses for every required quality criterion");
  }
  const immutableEvidenceObjectVersionId = requiredString(raw, "immutableEvidenceObjectVersionId", "LTX benchmark review evidence");
  if (!IMMUTABLE_VERSION.test(immutableEvidenceObjectVersionId)) {
    throw new Error("LTX benchmark review evidence.immutableEvidenceObjectVersionId is invalid");
  }
  return Object.freeze({
    contract: LTX_BENCHMARK_REVIEW_EVIDENCE_CONTRACT,
    evidenceKey,
    immutableEvidenceObjectVersionId,
    evidenceSha256: requiredSha256(raw, "evidenceSha256", "LTX benchmark review evidence"),
    visualReviewReceiptFingerprint: requiredSha256(raw, "visualReviewReceiptFingerprint", "LTX benchmark review evidence"),
    outputId,
    outputKey,
    outputVideoSha256,
    criterionEvidence: Object.freeze(criterionEvidence),
  });
}

function reviewedLtxBenchmarkReview(
  value: unknown,
  profileFingerprint: string,
  report: ImmutableLtxBenchmarkReportProof,
): LtxBenchmarkReview {
  const raw = record(value, "LTX benchmark review");
  assertKnownKeys(raw, [
    "contract", "verdict", "reviewId", "reviewedBy", "reviewedAt", "profileFingerprint", "reportProofFingerprint", "evidence",
  ], "LTX benchmark review");
  if (raw.contract !== LTX_BENCHMARK_REVIEW_CONTRACT || raw.verdict !== "pass") {
    throw new Error("LTX benchmark review must be an explicit pass under the supported review contract");
  }
  if (raw.profileFingerprint !== profileFingerprint || raw.reportProofFingerprint !== report.proofFingerprint) {
    throw new Error("LTX benchmark review does not bind the sealed profile and immutable report proof");
  }
  return {
    contract: LTX_BENCHMARK_REVIEW_CONTRACT,
    verdict: "pass",
    reviewId: requiredIdentifier(raw, "reviewId", "LTX benchmark review"),
    reviewedBy: requiredIdentifier(raw, "reviewedBy", "LTX benchmark review"),
    reviewedAt: requiredUtcTimestamp(raw, "reviewedAt", "LTX benchmark review"),
    profileFingerprint,
    reportProofFingerprint: report.proofFingerprint,
    evidence: ltxBenchmarkReviewEvidence(raw.evidence, report),
  };
}

function manualLtxBenchmarkReleaseApproval(
  value: unknown,
  profileFingerprint: string,
  reportProofFingerprint: string,
): ManualLtxBenchmarkReleaseApproval {
  const raw = record(value, "manual LTX benchmark release approval");
  assertKnownKeys(raw, [
    "contract", "decision", "approvalId", "approvedBy", "approvedAt", "releaseRevision", "profileFingerprint", "reportProofFingerprint",
  ], "manual LTX benchmark release approval");
  if (raw.contract !== MANUAL_LTX_BENCHMARK_RELEASE_APPROVAL_CONTRACT || raw.decision !== "approved") {
    throw new Error("manual LTX benchmark release approval must explicitly be approved");
  }
  if (raw.profileFingerprint !== profileFingerprint || raw.reportProofFingerprint !== reportProofFingerprint) {
    throw new Error("manual LTX benchmark release approval does not bind the sealed profile and immutable report proof");
  }
  const releaseRevision = requiredString(raw, "releaseRevision", "manual LTX benchmark release approval");
  if (!GIT_REVISION.test(releaseRevision)) {
    throw new Error("manual LTX benchmark release approval.releaseRevision must be a Git revision");
  }
  return {
    contract: MANUAL_LTX_BENCHMARK_RELEASE_APPROVAL_CONTRACT,
    decision: "approved",
    approvalId: requiredIdentifier(raw, "approvalId", "manual LTX benchmark release approval"),
    approvedBy: requiredIdentifier(raw, "approvedBy", "manual LTX benchmark release approval"),
    approvedAt: requiredUtcTimestamp(raw, "approvedAt", "manual LTX benchmark release approval"),
    releaseRevision,
    profileFingerprint,
    reportProofFingerprint,
  };
}

export interface ReviewedLtxBenchmarkAdmissionCore {
  readonly contract: typeof REVIEWED_LTX_BENCHMARK_ADMISSION_CONTRACT;
  readonly admissionId: string;
  readonly profile: Ltx25Native720pX2BenchmarkProfile;
  readonly profileFingerprint: string;
  readonly report: ImmutableLtxBenchmarkReportProof;
  readonly review: LtxBenchmarkReview;
  readonly releaseApproval: ManualLtxBenchmarkReleaseApproval;
}

export interface ReviewedLtxBenchmarkAdmission extends ReviewedLtxBenchmarkAdmissionCore {
  readonly admissionFingerprint: string;
}

function reviewedLtxBenchmarkAdmissionCore(value: unknown): ReviewedLtxBenchmarkAdmissionCore {
  const raw = record(value, "reviewed LTX benchmark admission");
  assertKnownKeys(raw, [
    "contract", "admissionId", "profile", "profileFingerprint", "report", "review", "releaseApproval", "admissionFingerprint",
  ], "reviewed LTX benchmark admission");
  if (raw.contract !== REVIEWED_LTX_BENCHMARK_ADMISSION_CONTRACT) {
    throw new Error("reviewed LTX benchmark admission.contract is unsupported");
  }
  const profile = assertExactLtx25Native720pX2BenchmarkProfile(raw.profile);
  const profileFingerprint = requiredSha256(raw, "profileFingerprint", "reviewed LTX benchmark admission");
  if (profileFingerprint !== LTX_25_NATIVE_720P_X2_BENCHMARK_PROFILE_FINGERPRINT) {
    throw new Error("reviewed LTX benchmark admission.profileFingerprint does not match the exact profile");
  }
  const report = assertImmutableLtxBenchmarkReportProof(raw.report);
  const review = reviewedLtxBenchmarkReview(raw.review, profileFingerprint, report);
  const releaseApproval = manualLtxBenchmarkReleaseApproval(raw.releaseApproval, profileFingerprint, report.proofFingerprint);
  if (Date.parse(releaseApproval.approvedAt) < Date.parse(review.reviewedAt)) {
    throw new Error("manual LTX benchmark release approval predates its review");
  }
  return {
    contract: REVIEWED_LTX_BENCHMARK_ADMISSION_CONTRACT,
    admissionId: requiredIdentifier(raw, "admissionId", "reviewed LTX benchmark admission"),
    profile,
    profileFingerprint,
    report,
    review,
    releaseApproval,
  };
}

export function reviewedLtxBenchmarkAdmissionFingerprint(
  admission: ReviewedLtxBenchmarkAdmissionCore,
): string {
  return sha256Hex(canonicalJson(admission));
}

/**
 * Validate a checked-in admission record. This never reaches R2, never
 * schedules a benchmark, and never changes any runtime allow-list.
 */
export function assertReviewedLtxBenchmarkAdmission(value: unknown): ReviewedLtxBenchmarkAdmission {
  const raw = record(value, "reviewed LTX benchmark admission");
  const core = reviewedLtxBenchmarkAdmissionCore(raw);
  const admissionFingerprint = requiredSha256(raw, "admissionFingerprint", "reviewed LTX benchmark admission");
  const expected = reviewedLtxBenchmarkAdmissionFingerprint(core);
  if (admissionFingerprint !== expected) {
    throw new Error("reviewed LTX benchmark admission fingerprint does not match its sealed fields");
  }
  return Object.freeze({ ...core, admissionFingerprint });
}

/**
 * Intentionally empty. Adding an entry requires a source-controlled release
 * with both a reviewer record and an independent manual release approval.
 * This registry is not imported by runtimeCapability and cannot enable spend.
 */
export const RELEASE_CONTROLLED_REVIEWED_LTX_BENCHMARK_REGISTRY: readonly ReviewedLtxBenchmarkAdmission[] =
  Object.freeze([]);

/** Pure validation for a future, manually reviewed source-controlled registry. */
export function resolveReviewedLtxBenchmarkRegistry(
  registry: readonly unknown[] = RELEASE_CONTROLLED_REVIEWED_LTX_BENCHMARK_REGISTRY,
): readonly ReviewedLtxBenchmarkAdmission[] {
  if (!Array.isArray(registry)) throw new Error("reviewed LTX benchmark registry must be an array");
  const admissions = registry.map((entry) => assertReviewedLtxBenchmarkAdmission(entry));
  const seenAdmissionIds = new Set<string>();
  const seenProfiles = new Set<string>();
  const seenReportVersions = new Set<string>();
  const seenApprovalIds = new Set<string>();
  for (const admission of admissions) {
    const reportVersion = `${admission.report.reportKey}|${admission.report.immutableObjectVersionId}`;
    if (
      seenAdmissionIds.has(admission.admissionId)
      || seenProfiles.has(admission.profileFingerprint)
      || seenReportVersions.has(reportVersion)
      || seenApprovalIds.has(admission.releaseApproval.approvalId)
    ) {
      throw new Error("reviewed LTX benchmark registry contains a duplicate admission binding");
    }
    seenAdmissionIds.add(admission.admissionId);
    seenProfiles.add(admission.profileFingerprint);
    seenReportVersions.add(reportVersion);
    seenApprovalIds.add(admission.releaseApproval.approvalId);
  }
  return Object.freeze(admissions);
}
