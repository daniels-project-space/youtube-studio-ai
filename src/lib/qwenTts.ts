import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/canonicalJson";

export const QWEN3_TTS_WORKER_CONTRACT = "qwen3-tts-worker/v1" as const;
export const QWEN3_TTS_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice" as const;
/** Exact Hugging Face revision qualified from the official Qwen repository. */
export const QWEN3_TTS_MODEL_REVISION = "0c0e3051f131929182e2c023b9537f8b1c68adfe" as const;
export const QWEN3_TTS_PACKAGE_VERSION = "0.1.1" as const;
export const QWEN3_TTS_TRANSFORMERS_VERSION = "4.57.3" as const;
export const QWEN3_TTS_SAMPLE_RATE_HZ = 24_000 as const;

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

export interface QwenTtsRuntimeReceipt {
  provider: "novita";
  gpu: "RTX 4090";
  capacityMode: "spot";
  persistentCache: true;
  idleShutdownSeconds: number;
  gpuSeconds: number;
  gpuRateUsdPerSecond: number;
  startupUsd: number;
  storageUsd: number;
  costUsd: number;
}

export interface QwenTtsReceipt {
  schema: typeof QWEN3_TTS_WORKER_CONTRACT;
  requestKey: string;
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
  if (
    receipt.schema !== QWEN3_TTS_WORKER_CONTRACT ||
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
    !runtime || runtime.provider !== "novita" || runtime.gpu !== "RTX 4090" ||
    runtime.capacityMode !== "spot" || runtime.persistentCache !== true ||
    typeof runtime.idleShutdownSeconds !== "number" || runtime.idleShutdownSeconds < 30 || runtime.idleShutdownSeconds > 900 ||
    typeof runtime.gpuSeconds !== "number" || runtime.gpuSeconds <= 0 || runtime.gpuSeconds > 3_600 ||
    typeof runtime.gpuRateUsdPerSecond !== "number" || runtime.gpuRateUsdPerSecond <= 0 || runtime.gpuRateUsdPerSecond > 1 ||
    typeof runtime.startupUsd !== "number" || runtime.startupUsd < 0 || runtime.startupUsd > 5 ||
    typeof runtime.storageUsd !== "number" || runtime.storageUsd < 0 || runtime.storageUsd > 5 ||
    typeof runtime.costUsd !== "number" || runtime.costUsd <= 0 || runtime.costUsd > 1
  ) return false;
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

export function qwenTtsReadiness(): QwenTtsReadiness {
  const blockers: string[] = [];
  let urlConfigured = true;
  let tokenConfigured = true;
  try { workerUrl(); } catch (error) {
    urlConfigured = false;
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  try { workerToken(); } catch (error) {
    tokenConfigured = false;
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  const qualityReceipt = process.env.QWEN3_TTS_QUALITY_RECEIPT_SHA256?.trim() ?? "";
  if (process.env.QWEN3_TTS_QUALITY_QUALIFIED !== "1") {
    blockers.push("QWEN3_TTS_QUALITY_QUALIFIED is not enabled");
  }
  if (!/^[a-f0-9]{64}$/.test(qualityReceipt)) {
    blockers.push("QWEN3_TTS_QUALITY_RECEIPT_SHA256 is missing or invalid");
  }
  const configured = urlConfigured && tokenConfigured;
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
}): QwenTtsReceipt {
  if (!args.value || typeof args.value !== "object" || Array.isArray(args.value)) {
    throw new Error("Qwen3 TTS worker receipt is missing");
  }
  const value = args.value as Record<string, unknown>;
  exactString(value.schema, QWEN3_TTS_WORKER_CONTRACT, "schema");
  exactString(value.requestKey, args.requestKey, "request key");
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
  exactString(runtime.provider, "novita", "runtime provider");
  exactString(runtime.gpu, "RTX 4090", "GPU");
  exactString(runtime.capacityMode, "spot", "capacity mode");
  if (runtime.persistentCache !== true) throw new Error("Qwen3 TTS worker did not attest persistent model caching");
  finiteNumber(runtime.idleShutdownSeconds, "idle shutdown", 30, 900);
  const gpuSeconds = finiteNumber(runtime.gpuSeconds, "GPU seconds", 0.001, 3_600);
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

export async function synthQwenNarration(args: {
  text: string;
  speaker: string;
  language?: string;
  instruction?: string;
  speed?: number;
  seed?: number;
  maxCostUsd?: number;
  onReceipt?: (receipt: QwenTtsReceipt) => void;
}): Promise<Uint8Array> {
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
  const requestedMaxCostUsd = args.maxCostUsd ?? Math.max(0.02, text.length / 1_000);
  if (!Number.isFinite(requestedMaxCostUsd) || requestedMaxCostUsd <= 0) {
    throw new QwenTtsError("Qwen3 TTS requires a positive per-request cost ceiling");
  }
  const maxCostUsd = Math.min(1, requestedMaxCostUsd);
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
      provider: "novita",
      gpu: "RTX 4090",
      capacityMode: "spot",
      persistentCache: true,
      idleShutdownMaxSeconds: 900,
    },
  } as const;
  const requestKey = sha256(canonicalJson(payload));
  let response: Response;
  try {
    response = await fetch(workerUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${workerToken()}`,
        "Content-Type": "application/json",
        "Idempotency-Key": requestKey,
      },
      body: JSON.stringify({ ...payload, requestKey }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    throw new QwenTtsError(
      `Qwen3 TTS outcome is unknown after submission; request ${requestKey} must be reconciled, not retried`,
      requestKey,
      undefined,
      { cause: error },
    );
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
      speaker,
      language: typedLanguage,
      seed,
      audio,
      maxCostUsd,
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
