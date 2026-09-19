import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/canonicalJson";
import { ensureOpenRelayQwenReady } from "@/lib/openRelayQwen";

export const QWEN3_TTS_WORKER_CONTRACT = "qwen3-tts-worker/v2" as const;
export const QWEN3_TTS_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice" as const;
/** Exact Hugging Face revision qualified from the official Qwen repository. */
export const QWEN3_TTS_MODEL_REVISION = "0c0e3051f131929182e2c023b9537f8b1c68adfe" as const;
export const QWEN3_TTS_PACKAGE_VERSION = "0.1.1" as const;
export const QWEN3_TTS_TRANSFORMERS_VERSION = "4.57.3" as const;
export const QWEN3_TTS_SAMPLE_RATE_HZ = 24_000 as const;
export const QWEN3_TTS_IDLE_SHUTDOWN_SECONDS = 300 as const;

export type QwenTtsRuntimeProvider = "novita" | "openrelay";
export type QwenTtsRuntimeGpu = "RTX 4090" | "RTX 3090";
export type QwenTtsCapacityMode = "serverless-scale-to-zero" | "persistent-disk-auto-stop";

export type QwenTtsRuntimeProfile =
  | {
      provider: "novita";
      gpu: "RTX 4090";
      capacityMode: "serverless-scale-to-zero";
    }
  | {
      provider: "openrelay";
      gpu: "RTX 3090";
      capacityMode: "persistent-disk-auto-stop";
    };

/**
 * The exact execution profile is part of every sealed request and receipt.
 * OpenRelay uses a persistent local disk with an external idle-stop controller;
 * the legacy Novita profile remains available for retained qualified takes.
 */
export function qwenTtsRuntimeProfile(): QwenTtsRuntimeProfile {
  const profile = (process.env.QWEN3_TTS_RUNTIME_PROFILE ?? "novita-4090-serverless").trim();
  if (profile === "novita-4090-serverless") {
    return { provider: "novita", gpu: "RTX 4090", capacityMode: "serverless-scale-to-zero" };
  }
  if (profile === "openrelay-3090-persistent") {
    return { provider: "openrelay", gpu: "RTX 3090", capacityMode: "persistent-disk-auto-stop" };
  }
  throw new QwenTtsError("QWEN3_TTS_RUNTIME_PROFILE must select an admitted exact worker profile");
}

export const QWEN3_TTS_SPEAKERS = [
  "Vivian",
  "Serena",
  "Uncle_Fu",
  "Dylan",
  "Eric",
  "Ryan",
  "Aiden",
  "Ono_Anna",
  "Sohee",
] as const;

/**
 * Provider-declared CustomVoice metadata from the pinned Qwen3-TTS model card.
 * This is casting metadata, not a claim that anyone listened to a take.
 */
export const QWEN3_TTS_SPEAKER_PROFILES = {
  Vivian: { description: "Bright, slightly edgy young female voice.", nativeLanguage: "Chinese" },
  Serena: { description: "Warm, gentle young female voice.", nativeLanguage: "Chinese" },
  Uncle_Fu: { description: "Seasoned male voice with a low, mellow timbre.", nativeLanguage: "Chinese" },
  Dylan: { description: "Youthful Beijing male voice with a clear, natural timbre.", nativeLanguage: "Chinese" },
  Eric: { description: "Lively Chengdu male voice with a slightly husky brightness.", nativeLanguage: "Chinese" },
  Ryan: { description: "Dynamic male voice with strong rhythmic drive.", nativeLanguage: "English" },
  Aiden: { description: "Sunny American male voice with a clear midrange.", nativeLanguage: "English" },
  Ono_Anna: { description: "Playful Japanese female voice with a light, nimble timbre.", nativeLanguage: "Japanese" },
  Sohee: { description: "Warm Korean female voice with rich emotion.", nativeLanguage: "Korean" },
} as const satisfies Record<(typeof QWEN3_TTS_SPEAKERS)[number], {
  description: string;
  nativeLanguage: Exclude<QwenTtsLanguage, "Auto">;
}>;

export const QWEN3_TTS_LANGUAGES = [
  "Auto",
  "Chinese",
  "English",
  "Japanese",
  "Korean",
  "German",
  "French",
  "Russian",
  "Portuguese",
  "Spanish",
  "Italian",
] as const;

export type QwenTtsSpeaker = (typeof QWEN3_TTS_SPEAKERS)[number];
export type QwenTtsLanguage = (typeof QWEN3_TTS_LANGUAGES)[number];

interface QwenTtsRuntimeReceiptEvidence {
  persistentCache: true;
  idleShutdownSeconds: number;
  accounting: "conservative-upper-bound";
  requestGpuSeconds: number;
  gpuSeconds: number;
  gpuRateUsdPerSecond: number;
  startupUsd: number;
  storageUsd: number;
  costUsd: number;
}

/**
 * A receipt cannot mix provider capacity properties. Keeping this as a
 * discriminated union makes the TypeScript contract match the durable Convex
 * validator and prevents a forged OpenRelay/4090 or Novita/3090 receipt.
 */
export type QwenTtsRuntimeReceipt = QwenTtsRuntimeReceiptEvidence & (
  | {
      provider: "novita";
      gpu: "RTX 4090";
      capacityMode: "serverless-scale-to-zero";
    }
  | {
      provider: "openrelay";
      gpu: "RTX 3090";
      capacityMode: "persistent-disk-auto-stop";
    }
);

export interface QwenTtsReceipt {
  schema: typeof QWEN3_TTS_WORKER_CONTRACT;
  requestKey: string;
  /** Immutable OCI image identity reported by the worker itself. */
  workerImageDigest: string;
  model: typeof QWEN3_TTS_MODEL;
  revision: typeof QWEN3_TTS_MODEL_REVISION;
  qwenTtsPackageVersion: typeof QWEN3_TTS_PACKAGE_VERSION;
  transformersVersion: typeof QWEN3_TTS_TRANSFORMERS_VERSION;
  dtype: "bfloat16";
  attention: "flash_attention_2";
  textSha256: string;
  instructionSha256: string;
  speaker: QwenTtsSpeaker;
  language: QwenTtsLanguage;
  seed: number;
  audioSha256: string;
  audioFormat: "mp3";
  sampleRateHz: typeof QWEN3_TTS_SAMPLE_RATE_HZ;
  durationSec: number;
  runtime: QwenTtsRuntimeReceipt;
}

/**
 * A final narration MP3 is a new artifact: sentence takes are concatenated,
 * gaps are inserted and an optional voice filter is applied.  Individual Qwen
 * receipts therefore cannot, on their own, prove which retained source the
 * editor received.  This receipt seals the exact checked source bytes to each
 * validated take and to the assembly recipe that made the source.
 */
export const QWEN3_TTS_NARRATION_SOURCE_EVIDENCE_VERSION = "qwen3-tts-narration-source/v1" as const;

export interface QwenNarrationSourceChunk {
  ordinal: number;
  textSha256: string;
  audioSha256: string;
  byteLength: number;
  receipt: QwenTtsReceipt;
}

export interface QwenNarrationSourceEvidence {
  schema: typeof QWEN3_TTS_NARRATION_SOURCE_EVIDENCE_VERSION;
  provider: "qwen3";
  model: typeof QWEN3_TTS_MODEL;
  revision: typeof QWEN3_TTS_MODEL_REVISION;
  speaker: QwenTtsSpeaker;
  language: QwenTtsLanguage;
  requestCount: number;
  sourceRequestCount: number;
  preflightRequestCount: number;
  sourceCostUsd: number;
  totalCostUsd: number;
  receiptSha256: string;
  source: {
    narrationKey: string;
    sha256: string;
    byteLength: number;
    durationSec: number;
    transcriptSha256: string;
    assembly: "concat_audio_with_gaps/v1";
    gapPlanSha256: string;
    mode: "sentence" | "chapter";
    voiceFx: string | null;
  };
  sourceChunks: QwenNarrationSourceChunk[];
  preflightReceipts: QwenTtsReceipt[];
}

interface QwenTtsWorkerResponse {
  receipt: QwenTtsReceipt;
  audioBase64: string;
}

export interface QwenTtsReadiness {
  configured: boolean;
  qualified: boolean;
  blockers: string[];
}

export function isPinnedQwenTtsReceipt(value: unknown): value is QwenTtsReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Partial<QwenTtsReceipt>;
  const runtime = receipt.runtime as Partial<QwenTtsRuntimeReceipt> | undefined;
  let expectedRuntime: QwenTtsRuntimeProfile;
  try {
    expectedRuntime = qwenTtsRuntimeProfile();
  } catch {
    return false;
  }
  if (
    receipt.schema !== QWEN3_TTS_WORKER_CONTRACT ||
    !isPinnedWorkerImageDigest(receipt.workerImageDigest) ||
    receipt.model !== QWEN3_TTS_MODEL ||
    receipt.revision !== QWEN3_TTS_MODEL_REVISION ||
    receipt.qwenTtsPackageVersion !== QWEN3_TTS_PACKAGE_VERSION ||
    receipt.transformersVersion !== QWEN3_TTS_TRANSFORMERS_VERSION ||
    receipt.dtype !== "bfloat16" ||
    receipt.attention !== "flash_attention_2" ||
    receipt.audioFormat !== "mp3" ||
    receipt.sampleRateHz !== QWEN3_TTS_SAMPLE_RATE_HZ ||
    !(QWEN3_TTS_SPEAKERS as readonly unknown[]).includes(receipt.speaker) ||
    !(QWEN3_TTS_LANGUAGES as readonly unknown[]).includes(receipt.language) ||
    !Number.isSafeInteger(receipt.seed) || Number(receipt.seed) < 0 ||
    ![receipt.requestKey, receipt.textSha256, receipt.instructionSha256, receipt.audioSha256]
      .every((digest) => typeof digest === "string" && /^[a-f0-9]{64}$/.test(digest)) ||
    typeof receipt.durationSec !== "number" || !Number.isFinite(receipt.durationSec) ||
    receipt.durationSec < 0.25 || receipt.durationSec > 3_600 ||
    !runtime || runtime.provider !== expectedRuntime.provider || runtime.gpu !== expectedRuntime.gpu ||
    runtime.capacityMode !== expectedRuntime.capacityMode || runtime.persistentCache !== true ||
    runtime.idleShutdownSeconds !== QWEN3_TTS_IDLE_SHUTDOWN_SECONDS ||
    runtime.accounting !== "conservative-upper-bound" ||
    typeof runtime.requestGpuSeconds !== "number" || runtime.requestGpuSeconds <= 0 || runtime.requestGpuSeconds > 3_600 ||
    typeof runtime.gpuSeconds !== "number" || runtime.gpuSeconds <= 0 || runtime.gpuSeconds > 3_600 ||
    typeof runtime.gpuRateUsdPerSecond !== "number" || runtime.gpuRateUsdPerSecond <= 0 || runtime.gpuRateUsdPerSecond > 1 ||
    typeof runtime.startupUsd !== "number" || runtime.startupUsd < 0 || runtime.startupUsd > 5 ||
    typeof runtime.storageUsd !== "number" || runtime.storageUsd < 0 || runtime.storageUsd > 5 ||
    typeof runtime.costUsd !== "number" || runtime.costUsd <= 0 || runtime.costUsd > 1
  ) return false;
  if (runtime.gpuSeconds + 0.000001 < runtime.requestGpuSeconds + runtime.idleShutdownSeconds) return false;
  const expectedCost = runtime.gpuSeconds * runtime.gpuRateUsdPerSecond + runtime.startupUsd + runtime.storageUsd;
  return Math.abs(runtime.costUsd - expectedCost) <= 0.000001;
}

export class QwenTtsError extends Error {
  readonly retryable = false;

  constructor(
    message: string,
    readonly requestKey?: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "QwenTtsError";
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function finiteReceiptNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Qwen3 narration source evidence has invalid ${label}`);
  }
  return value;
}

function assertNarrationSourceReceipt(value: unknown, label: string): QwenTtsReceipt {
  if (!isPinnedQwenTtsReceipt(value)) {
    throw new Error(`Qwen3 narration source evidence ${label} is not a pinned Qwen receipt`);
  }
  return value;
}

/**
 * Validate a durable, final-source proof without replaying a billable worker
 * request. The caller must separately hash the retained object and pass its
 * observed bytes to `assertQwenNarrationSourceBinding` below.
 */
export function assertQwenNarrationSourceEvidence(value: unknown): QwenNarrationSourceEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Qwen3 narration source evidence is missing or malformed");
  }
  const raw = value as Record<string, unknown>;
  if (raw.schema !== QWEN3_TTS_NARRATION_SOURCE_EVIDENCE_VERSION || raw.provider !== "qwen3") {
    throw new Error("Qwen3 narration source evidence has an unsupported schema or provider");
  }
  if (raw.model !== QWEN3_TTS_MODEL || raw.revision !== QWEN3_TTS_MODEL_REVISION) {
    throw new Error("Qwen3 narration source evidence does not use the pinned model revision");
  }
  if (!(QWEN3_TTS_SPEAKERS as readonly unknown[]).includes(raw.speaker) ||
    !(QWEN3_TTS_LANGUAGES as readonly unknown[]).includes(raw.language)) {
    throw new Error("Qwen3 narration source evidence has an unsupported speaker or language");
  }
  const source = raw.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Qwen3 narration source evidence is missing final-source details");
  }
  const sourceRaw = source as Record<string, unknown>;
  if (typeof sourceRaw.narrationKey !== "string" || !sourceRaw.narrationKey.trim() ||
    !isSha256(sourceRaw.sha256) || !isSha256(sourceRaw.transcriptSha256) ||
    sourceRaw.assembly !== "concat_audio_with_gaps/v1" || !isSha256(sourceRaw.gapPlanSha256) ||
    (sourceRaw.mode !== "sentence" && sourceRaw.mode !== "chapter") ||
    !(typeof sourceRaw.voiceFx === "string" || sourceRaw.voiceFx === null)) {
    throw new Error("Qwen3 narration source evidence has malformed final-source metadata");
  }
  const sourceByteLength = finiteReceiptNumber(sourceRaw.byteLength, "final-source byte length", 1_000, 100_000_000);
  const sourceDurationSec = finiteReceiptNumber(sourceRaw.durationSec, "final-source duration", 1.5, 86_400);
  const sourceChunksRaw = raw.sourceChunks;
  if (!Array.isArray(sourceChunksRaw) || sourceChunksRaw.length < 1 || sourceChunksRaw.length > 2_000) {
    throw new Error("Qwen3 narration source evidence must contain 1–2000 ordered source chunks");
  }
  const sourceChunks = sourceChunksRaw.map((chunk, index): QwenNarrationSourceChunk => {
    if (!chunk || typeof chunk !== "object" || Array.isArray(chunk)) {
      throw new Error(`Qwen3 narration source evidence chunk ${index + 1} is malformed`);
    }
    const item = chunk as Record<string, unknown>;
    if (item.ordinal !== index || !isSha256(item.textSha256) || !isSha256(item.audioSha256)) {
      throw new Error(`Qwen3 narration source evidence chunk ${index + 1} has an invalid identity`);
    }
    const receipt = assertNarrationSourceReceipt(item.receipt, `chunk ${index + 1}`);
    if (receipt.model !== raw.model || receipt.revision !== raw.revision || receipt.speaker !== raw.speaker ||
      receipt.language !== raw.language || receipt.textSha256 !== item.textSha256 || receipt.audioSha256 !== item.audioSha256) {
      throw new Error(`Qwen3 narration source evidence chunk ${index + 1} does not bind its receipt`);
    }
    return {
      ordinal: index,
      textSha256: item.textSha256,
      audioSha256: item.audioSha256,
      byteLength: finiteReceiptNumber(item.byteLength, `chunk ${index + 1} byte length`, 1_000, 36_000_000),
      receipt,
    };
  });
  const preflightRaw = raw.preflightReceipts;
  if (!Array.isArray(preflightRaw) || preflightRaw.length > 8) {
    throw new Error("Qwen3 narration source evidence has invalid preflight receipts");
  }
  const preflightReceipts = preflightRaw.map((receipt, index) => {
    const accepted = assertNarrationSourceReceipt(receipt, `preflight ${index + 1}`);
    if (accepted.model !== raw.model || accepted.revision !== raw.revision || accepted.speaker !== raw.speaker || accepted.language !== raw.language) {
      throw new Error(`Qwen3 narration source evidence preflight ${index + 1} does not match the source provider`);
    }
    return accepted;
  });
  const requestCount = sourceChunks.length + preflightReceipts.length;
  if (raw.requestCount !== requestCount || raw.sourceRequestCount !== sourceChunks.length || raw.preflightRequestCount !== preflightReceipts.length) {
    throw new Error("Qwen3 narration source evidence request counts do not bind its receipts");
  }
  const sourceCostUsd = sourceChunks.reduce((sum, chunk) => sum + chunk.receipt.runtime.costUsd, 0);
  const totalCostUsd = sourceCostUsd + preflightReceipts.reduce((sum, receipt) => sum + receipt.runtime.costUsd, 0);
  const recordedSourceCostUsd = finiteReceiptNumber(raw.sourceCostUsd, "source cost", 0.000001, 2_000);
  const recordedTotalCostUsd = finiteReceiptNumber(raw.totalCostUsd, "total cost", 0.000001, 2_000);
  if (Math.abs(recordedSourceCostUsd - sourceCostUsd) > 0.000001 || Math.abs(recordedTotalCostUsd - totalCostUsd) > 0.000001) {
    throw new Error("Qwen3 narration source evidence costs do not bind its receipts");
  }
  const receiptSha256 = sha256(canonicalJson({
    sourceChunks: sourceChunks.map(({ receipt }) => receipt),
    preflightReceipts,
  }));
  if (raw.receiptSha256 !== receiptSha256) {
    throw new Error("Qwen3 narration source evidence receipt digest does not bind its receipts");
  }
  return {
    schema: QWEN3_TTS_NARRATION_SOURCE_EVIDENCE_VERSION,
    provider: "qwen3",
    model: QWEN3_TTS_MODEL,
    revision: QWEN3_TTS_MODEL_REVISION,
    speaker: raw.speaker as QwenTtsSpeaker,
    language: raw.language as QwenTtsLanguage,
    requestCount,
    sourceRequestCount: sourceChunks.length,
    preflightRequestCount: preflightReceipts.length,
    sourceCostUsd: recordedSourceCostUsd,
    totalCostUsd: recordedTotalCostUsd,
    receiptSha256,
    source: {
      narrationKey: sourceRaw.narrationKey,
      sha256: sourceRaw.sha256,
      byteLength: sourceByteLength,
      durationSec: sourceDurationSec,
      transcriptSha256: sourceRaw.transcriptSha256,
      assembly: "concat_audio_with_gaps/v1",
      gapPlanSha256: sourceRaw.gapPlanSha256,
      mode: sourceRaw.mode,
      voiceFx: sourceRaw.voiceFx,
    },
    sourceChunks,
    preflightReceipts,
  };
}

export function createQwenNarrationSourceEvidence(args: Omit<QwenNarrationSourceEvidence, "schema" | "provider" | "model" | "revision" | "requestCount" | "sourceRequestCount" | "preflightRequestCount" | "sourceCostUsd" | "totalCostUsd" | "receiptSha256">): QwenNarrationSourceEvidence {
  const sourceCostUsd = args.sourceChunks.reduce((sum, chunk) => sum + chunk.receipt.runtime.costUsd, 0);
  const totalCostUsd = sourceCostUsd + args.preflightReceipts.reduce((sum, receipt) => sum + receipt.runtime.costUsd, 0);
  const receiptSha256 = sha256(canonicalJson({
    sourceChunks: args.sourceChunks.map(({ receipt }) => receipt),
    preflightReceipts: args.preflightReceipts,
  }));
  return assertQwenNarrationSourceEvidence({
    schema: QWEN3_TTS_NARRATION_SOURCE_EVIDENCE_VERSION,
    provider: "qwen3",
    model: QWEN3_TTS_MODEL,
    revision: QWEN3_TTS_MODEL_REVISION,
    speaker: args.speaker,
    language: args.language,
    requestCount: args.sourceChunks.length + args.preflightReceipts.length,
    sourceRequestCount: args.sourceChunks.length,
    preflightRequestCount: args.preflightReceipts.length,
    sourceCostUsd,
    totalCostUsd,
    receiptSha256,
    source: args.source,
    sourceChunks: args.sourceChunks,
    preflightReceipts: args.preflightReceipts,
  });
}

/** Verify the actual retained narration object, not only the worker's old claim. */
export function assertQwenNarrationSourceBinding(args: {
  evidence: unknown;
  narrationKey: string;
  sourceAudio: Uint8Array;
  transcript: string;
  durationSec: number;
}): QwenNarrationSourceEvidence {
  const evidence = assertQwenNarrationSourceEvidence(args.evidence);
  if (evidence.source.narrationKey !== args.narrationKey || evidence.source.sha256 !== sha256(args.sourceAudio) ||
    evidence.source.byteLength !== args.sourceAudio.byteLength || evidence.source.transcriptSha256 !== sha256(args.transcript) ||
    Math.abs(evidence.source.durationSec - args.durationSec) > 0.001) {
    throw new Error("Qwen3 narration source evidence does not bind the retained final narration object");
  }
  return evidence;
}

function exactString(value: unknown, expected: string, label: string): string {
  if (value !== expected) throw new Error(`Qwen3 TTS receipt ${label} is not the pinned value`);
  return expected;
}

function finiteNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Qwen3 TTS receipt ${label} is invalid`);
  }
  return value;
}

function workerUrl(): string {
  const raw = process.env.QWEN3_TTS_WORKER_URL?.trim() ?? "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new QwenTtsError("QWEN3_TTS_WORKER_URL is missing or invalid");
  }
  const loopback = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !loopback) {
    throw new QwenTtsError("QWEN3_TTS_WORKER_URL must use HTTPS outside loopback qualification");
  }
  if (url.username || url.password || url.hash) {
    throw new QwenTtsError("QWEN3_TTS_WORKER_URL must not contain embedded credentials or a fragment");
  }
  return url.toString();
}

function workerToken(): string {
  const token = process.env.QWEN3_TTS_WORKER_TOKEN?.trim() ?? "";
  if (token.length < 32) throw new QwenTtsError("QWEN3_TTS_WORKER_TOKEN is missing or too short");
  return token;
}

/** A mutable tag cannot identify the worker code that created an audio take. */
function isPinnedWorkerImageDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/.test(value);
}

function workerImageDigest(): string {
  const digest = process.env.QWEN3_TTS_WORKER_IMAGE_DIGEST?.trim() ?? "";
  if (!isPinnedWorkerImageDigest(digest)) {
    throw new QwenTtsError("QWEN3_TTS_WORKER_IMAGE_DIGEST must be a full immutable OCI @sha256 reference");
  }
  return digest;
}

/** Consumed by the private OpenRelay gateway and stripped before proxying. */
function openRelayGatewayToken(): string {
  const token = process.env.OPENRELAY_API_KEY?.trim() ?? "";
  if (token.length < 32) {
    throw new QwenTtsError("OPENRELAY_API_KEY is missing or too short for the private Qwen endpoint");
  }
  return token;
}

export function qwenTtsReadiness(): QwenTtsReadiness {
  const blockers: string[] = [];
  let urlConfigured = true;
  let tokenConfigured = true;
  let imageConfigured = true;
  let runtimeProfile: QwenTtsRuntimeProfile | undefined;
  let gatewayConfigured = true;
  try { workerUrl(); } catch (error) {
    urlConfigured = false;
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  try { workerToken(); } catch (error) {
    tokenConfigured = false;
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  try { workerImageDigest(); } catch (error) {
    imageConfigured = false;
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  try { runtimeProfile = qwenTtsRuntimeProfile(); } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  if (runtimeProfile?.provider === "openrelay") {
    try { openRelayGatewayToken(); } catch (error) {
      gatewayConfigured = false;
      blockers.push(error instanceof Error ? error.message : String(error));
    }
  }
  const qualityReceipt = process.env.QWEN3_TTS_QUALITY_RECEIPT_SHA256?.trim() ?? "";
  if (process.env.QWEN3_TTS_QUALITY_QUALIFIED !== "1") {
    blockers.push("QWEN3_TTS_QUALITY_QUALIFIED is not enabled");
  }
  if (!/^[a-f0-9]{64}$/.test(qualityReceipt)) {
    blockers.push("QWEN3_TTS_QUALITY_RECEIPT_SHA256 is missing or invalid");
  }
  const configured = urlConfigured && tokenConfigured && imageConfigured && Boolean(runtimeProfile) && gatewayConfigured;
  return { configured, qualified: configured && blockers.length === 0, blockers };
}

export function hasQwenTtsConfig(): boolean {
  const readiness = qwenTtsReadiness();
  return readiness.configured;
}

export function hasQualifiedQwenTts(): boolean {
  return qwenTtsReadiness().qualified;
}

function speedInstruction(speed: number): string {
  if (speed <= 0.92) return "Use an unhurried, deliberate speaking pace while keeping every word clear.";
  if (speed < 0.98) return "Use a measured, slightly slower speaking pace with natural phrasing.";
  if (speed >= 1.08) return "Use a brisk, energetic speaking pace without sacrificing articulation.";
  if (speed > 1.02) return "Use a lightly accelerated, purposeful speaking pace.";
  return "";
}

export function qwenTtsInstruction(instruction: string | undefined, speed: number | undefined): string {
  const explicit = (instruction ?? "").replace(/\s+/g, " ").trim();
  const speedDirective = speedInstruction(Math.max(0.85, Math.min(1.15, speed ?? 1)));
  return [explicit, speedDirective].filter(Boolean).join(" ").slice(0, 600);
}

/**
 * Resolve the editorial direction before it reaches the pinned CustomVoice
 * worker.  Both the scheduled path and the week-ahead preparation path use
 * this function, so a prepared take cannot silently lose its channel voice
 * merely because it was rendered earlier in the week.
 *
 * A deliberately supplied module instruction is the primary direction, but
 * must not erase the frozen editorial brief or the channel's delivery/pacing
 * DNA.  Earlier behavior returned `explicit` on its own, which meant the
 * weekly batch and Style DNA controls silently disappeared whenever a channel
 * set a custom instruction.  Keep all non-duplicate directions in a bounded
 * provider instruction instead.  These are direction inputs, not a claim that
 * the model will comply; retained audio still has to clear the measured
 * delivery-rate and loudness gates.
 */
export function composeQwenNarrationInstruction(args: {
  explicit?: unknown;
  editorialBrief?: unknown;
  delivery?: unknown;
  pacing?: unknown;
  archetype?: unknown;
}): string {
  const text = (value: unknown): string => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  const directions = [args.explicit, args.editorialBrief, args.delivery, args.pacing, args.archetype]
    .map(text)
    .filter(Boolean);
  const seen = new Set<string>();
  return directions
    .filter((direction) => {
      const identity = direction.toLocaleLowerCase();
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .map((direction) => /[.!?]$/.test(direction) ? direction : `${direction}.`)
    .join(" ")
    .slice(0, 520);
}

export function resolveQwenTtsLanguage(value: unknown): QwenTtsLanguage {
  const normalized = typeof value === "string" ? value.trim().toLowerCase().replaceAll("_", "-") : "";
  const prefix = normalized.split("-")[0];
  const byLocale: Record<string, QwenTtsLanguage> = {
    auto: "Auto",
    zh: "Chinese",
    chinese: "Chinese",
    en: "English",
    english: "English",
    ja: "Japanese",
    japanese: "Japanese",
    ko: "Korean",
    korean: "Korean",
    de: "German",
    german: "German",
    fr: "French",
    french: "French",
    ru: "Russian",
    russian: "Russian",
    pt: "Portuguese",
    portuguese: "Portuguese",
    es: "Spanish",
    spanish: "Spanish",
    it: "Italian",
    italian: "Italian",
  };
  return byLocale[normalized] ?? byLocale[prefix] ?? "English";
}

function strictBase64(value: unknown): Uint8Array {
  if (typeof value !== "string" || value.length < 1_336 || value.length > 48_000_000) {
    throw new Error("Qwen3 TTS response audio is missing or outside the bounded size");
  }
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("Qwen3 TTS response audio is not canonical base64");
  }
  const bytes = new Uint8Array(Buffer.from(value, "base64"));
  if (bytes.length < 1_000 || Buffer.from(bytes).toString("base64") !== value) {
    throw new Error("Qwen3 TTS response audio failed canonical base64 validation");
  }
  const head = bytes.subarray(0, Math.min(bytes.length, 4_096));
  const hasId3 = head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33;
  const hasMpegFrame = Array.from(head.subarray(0, Math.max(0, head.length - 1))).some(
    (byte, index) => byte === 0xff && (head[index + 1]! & 0xe0) === 0xe0,
  );
  if (!hasId3 && !hasMpegFrame) {
    throw new Error("Qwen3 TTS response does not contain an MP3 header or MPEG audio frame");
  }
  return bytes;
}

function validateReceipt(args: {
  value: unknown;
  requestKey: string;
  textSha256: string;
  instructionSha256: string;
  speaker: QwenTtsSpeaker;
  language: QwenTtsLanguage;
  seed: number;
  audio: Uint8Array;
  maxCostUsd: number;
  idleShutdownSeconds: number;
  /** Present for live submission; omitted for offline retained-audio verification. */
  expectedWorkerImageDigest?: string;
}): QwenTtsReceipt {
  if (!args.value || typeof args.value !== "object" || Array.isArray(args.value)) {
    throw new Error("Qwen3 TTS worker receipt is missing");
  }
  const value = args.value as Record<string, unknown>;
  exactString(value.schema, QWEN3_TTS_WORKER_CONTRACT, "schema");
  exactString(value.requestKey, args.requestKey, "request key");
  if (args.expectedWorkerImageDigest) {
    exactString(value.workerImageDigest, args.expectedWorkerImageDigest, "worker image digest");
  } else if (!isPinnedWorkerImageDigest(value.workerImageDigest)) {
    throw new Error("Qwen3 TTS receipt worker image digest is not immutable");
  }
  exactString(value.model, QWEN3_TTS_MODEL, "model");
  exactString(value.revision, QWEN3_TTS_MODEL_REVISION, "revision");
  exactString(value.qwenTtsPackageVersion, QWEN3_TTS_PACKAGE_VERSION, "package version");
  exactString(value.transformersVersion, QWEN3_TTS_TRANSFORMERS_VERSION, "Transformers version");
  exactString(value.dtype, "bfloat16", "dtype");
  exactString(value.attention, "flash_attention_2", "attention implementation");
  exactString(value.textSha256, args.textSha256, "text digest");
  exactString(value.instructionSha256, args.instructionSha256, "instruction digest");
  exactString(value.speaker, args.speaker, "speaker");
  exactString(value.language, args.language, "language");
  if (value.seed !== args.seed) throw new Error("Qwen3 TTS receipt seed does not match the request");
  exactString(value.audioSha256, sha256(args.audio), "audio digest");
  exactString(value.audioFormat, "mp3", "audio format");
  if (value.sampleRateHz !== QWEN3_TTS_SAMPLE_RATE_HZ) {
    throw new Error("Qwen3 TTS receipt sample rate is not the pinned 24 kHz output");
  }
  finiteNumber(value.durationSec, "duration", 0.25, 3_600);

  if (!value.runtime || typeof value.runtime !== "object" || Array.isArray(value.runtime)) {
    throw new Error("Qwen3 TTS runtime receipt is missing");
  }
  const runtime = value.runtime as Record<string, unknown>;
  const expectedRuntime = qwenTtsRuntimeProfile();
  exactString(runtime.provider, expectedRuntime.provider, "runtime provider");
  exactString(runtime.gpu, expectedRuntime.gpu, "GPU");
  exactString(runtime.capacityMode, expectedRuntime.capacityMode, "capacity mode");
  if (runtime.persistentCache !== true) throw new Error("Qwen3 TTS worker did not attest persistent model caching");
  if (runtime.idleShutdownSeconds !== args.idleShutdownSeconds) {
    throw new Error("Qwen3 TTS receipt idle shutdown does not match the request");
  }
  const idleShutdownSeconds = args.idleShutdownSeconds;
  exactString(runtime.accounting, "conservative-upper-bound", "accounting basis");
  const requestGpuSeconds = finiteNumber(runtime.requestGpuSeconds, "request GPU seconds", 0.001, 3_600);
  const gpuSeconds = finiteNumber(runtime.gpuSeconds, "GPU seconds", 0.001, 3_600);
  if (gpuSeconds + 0.000001 < requestGpuSeconds + idleShutdownSeconds) {
    throw new Error("Qwen3 TTS lifecycle upper bound omits request or idle GPU time");
  }
  const gpuRate = finiteNumber(runtime.gpuRateUsdPerSecond, "GPU rate", 0.000001, 1);
  const startupUsd = finiteNumber(runtime.startupUsd, "startup cost", 0, 5);
  const storageUsd = finiteNumber(runtime.storageUsd, "storage cost", 0, 5);
  const costUsd = finiteNumber(runtime.costUsd, "cost", 0.000001, args.maxCostUsd);
  const expectedCost = gpuSeconds * gpuRate + startupUsd + storageUsd;
  if (Math.abs(costUsd - expectedCost) > 0.000001) {
    throw new Error("Qwen3 TTS runtime cost receipt is internally inconsistent");
  }
  return value as unknown as QwenTtsReceipt;
}

export interface QwenTtsRequestArgs {
  text: string;
  speaker: string;
  language?: string;
  instruction?: string;
  speed?: number;
  seed?: number;
  maxCostUsd?: number;
}

/** Pure request identity, shared by live submission and offline qualification. */
export function prepareQwenTtsRequest(args: QwenTtsRequestArgs) {
  const text = args.text.replace(/\s+/g, " ").trim();
  if (!text || text.length > 8_000) throw new QwenTtsError("Qwen3 TTS text must contain 1–8000 characters");
  if (!(QWEN3_TTS_SPEAKERS as readonly string[]).includes(args.speaker)) {
    throw new QwenTtsError(`Qwen3 TTS speaker is unsupported: ${args.speaker || "missing"}`);
  }
  const language = args.language ?? "English";
  if (!(QWEN3_TTS_LANGUAGES as readonly string[]).includes(language)) {
    throw new QwenTtsError(`Qwen3 TTS language is unsupported: ${language}`);
  }
  const speaker = args.speaker as QwenTtsSpeaker;
  const typedLanguage = language as QwenTtsLanguage;
  const seed = Number.isSafeInteger(args.seed) && Number(args.seed) >= 0
    ? Number(args.seed)
    : 4_242;
  const instruction = qwenTtsInstruction(args.instruction, args.speed);
  // Serverless bills the worker during its configured idle tail. The default
  // is therefore a conservative lifecycle envelope, not fictional character
  // pricing. A tighter stage budget still takes precedence and fails closed.
  const requestedMaxCostUsd = args.maxCostUsd ?? Math.max(0.10, text.length / 1_000);
  if (!Number.isFinite(requestedMaxCostUsd) || requestedMaxCostUsd <= 0) {
    throw new QwenTtsError("Qwen3 TTS requires a positive per-request cost ceiling");
  }
  const maxCostUsd = Math.min(1, requestedMaxCostUsd);
  const runtimeProfile = qwenTtsRuntimeProfile();
  const payload = {
    schema: QWEN3_TTS_WORKER_CONTRACT,
    model: QWEN3_TTS_MODEL,
    revision: QWEN3_TTS_MODEL_REVISION,
    qwenTtsPackageVersion: QWEN3_TTS_PACKAGE_VERSION,
    transformersVersion: QWEN3_TTS_TRANSFORMERS_VERSION,
    dtype: "bfloat16",
    attention: "flash_attention_2",
    text,
    textSha256: sha256(text),
    speaker,
    language: typedLanguage,
    instruction,
    instructionSha256: sha256(instruction),
    seed,
    audioFormat: "mp3",
    sampleRateHz: QWEN3_TTS_SAMPLE_RATE_HZ,
    maxCostUsd,
    runtime: {
      provider: runtimeProfile.provider,
      gpu: runtimeProfile.gpu,
      capacityMode: runtimeProfile.capacityMode,
      persistentCache: true,
      idleShutdownMaxSeconds: QWEN3_TTS_IDLE_SHUTDOWN_SECONDS,
      accounting: "conservative-upper-bound",
    },
  } as const;
  const requestKey = sha256(canonicalJson(payload));
  return { payload, requestKey };
}

/** Validate retained bytes against the CURRENT request, not a receipt's own claim.
 * Integrity linkage only: this neither authorizes spend nor proves worker identity. */
export function validateRetainedQwenTtsAudio(args: QwenTtsRequestArgs, audio: Uint8Array, receipt: unknown): QwenTtsReceipt {
  const { payload, requestKey } = prepareQwenTtsRequest(args);
  // Reuse the live size/header checks as well as its complete attestation checks.
  if (!(audio instanceof Uint8Array) || audio.byteLength < 1_000 || audio.byteLength > 36_000_000) {
    throw new Error("Qwen3 TTS retained audio is outside the bounded size");
  }
  strictBase64(Buffer.from(audio).toString("base64"));
  return validateReceipt({
    value: receipt, requestKey, textSha256: payload.textSha256,
    instructionSha256: payload.instructionSha256, speaker: payload.speaker,
    language: payload.language, seed: payload.seed, audio, maxCostUsd: payload.maxCostUsd,
    idleShutdownSeconds: payload.runtime.idleShutdownMaxSeconds,
  });
}

export async function synthQwenNarration(args: QwenTtsRequestArgs & {
  onReceipt?: (receipt: QwenTtsReceipt) => void;
}): Promise<Uint8Array> {
  const { payload, requestKey } = prepareQwenTtsRequest(args);
  // Resolve the deployment allow-list before submitting a paid request.  A
  // missing or mutable image identity must not spend first and fail later.
  const expectedWorkerImageDigest = workerImageDigest();
  const runtimeProfile = qwenTtsRuntimeProfile();
  const managedOpenRelay = runtimeProfile.provider === "openrelay" && Boolean(process.env.OPENRELAY_QWEN_VM_ID?.trim());
  if (managedOpenRelay) await ensureOpenRelayQwenReady();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Idempotency-Key": requestKey,
  };
  if (runtimeProfile.provider === "openrelay") {
    // OpenRelay consumes Authorization for its organization credential, so
    // retain the worker's second auth layer in a header it forwards intact.
    headers["x-worker-authorization"] = `Bearer ${workerToken()}`;
    headers["x-api-key"] = openRelayGatewayToken();
  } else {
    headers.Authorization = `Bearer ${workerToken()}`;
  }
  const submit = async (): Promise<Response> => {
    try {
      return await fetch(workerUrl(), {
        method: "POST",
        headers,
        body: JSON.stringify({ ...payload, requestKey }),
        signal: AbortSignal.timeout(runtimeProfile.provider === "openrelay" ? 8 * 60_000 : 180_000),
      });
    } catch (error) {
      throw new QwenTtsError(
        `Qwen3 TTS outcome is unknown after submission; request ${requestKey} must be reconciled, not retried`,
        requestKey,
        undefined,
        { cause: error },
      );
    }
  };
  let response = await submit();
  // The reaper's drain endpoint rejects before taking the inference lock. It
  // is therefore the one response that is safe to re-start and re-submit with
  // the same idempotency key; network failures and every other result retain
  // the normal no-automatic-retry rule.
  if (managedOpenRelay && response.status === 503) {
    const detail = await response.text().catch(() => "");
    if (/draining for safe idle shutdown/i.test(detail)) {
      await ensureOpenRelayQwenReady();
      response = await submit();
    }
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new QwenTtsError(
      `Qwen3 TTS worker HTTP ${response.status}: ${detail.slice(0, 220)}`,
      requestKey,
      response.status,
    );
  }
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 50_000_000) {
    throw new QwenTtsError("Qwen3 TTS worker response exceeds the 50 MB bound", requestKey, response.status);
  }
  let body: QwenTtsWorkerResponse;
  try {
    body = await response.json() as QwenTtsWorkerResponse;
  } catch (error) {
    throw new QwenTtsError("Qwen3 TTS worker returned malformed JSON", requestKey, response.status, { cause: error });
  }
  try {
    const audio = strictBase64(body.audioBase64);
    const receipt = validateReceipt({
      value: body.receipt,
      requestKey,
      textSha256: payload.textSha256,
      instructionSha256: payload.instructionSha256,
      speaker: payload.speaker,
      language: payload.language,
      seed: payload.seed,
      audio,
      maxCostUsd: payload.maxCostUsd,
      idleShutdownSeconds: payload.runtime.idleShutdownMaxSeconds,
      expectedWorkerImageDigest,
    });
    args.onReceipt?.(receipt);
    return audio;
  } catch (error) {
    throw new QwenTtsError(
      `Qwen3 TTS response attestation failed: ${error instanceof Error ? error.message : String(error)}`,
      requestKey,
      response.status,
      { cause: error },
    );
  }
}
