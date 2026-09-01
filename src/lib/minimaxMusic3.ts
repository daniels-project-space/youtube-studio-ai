import { createHash } from "node:crypto";

import {
  ChannelMusicProgramSchema,
  type ChannelMusicProgram,
} from "@/engine/channelMusicProgram";
import { canonicalJson } from "@/lib/canonicalJson";

export const MINIMAX_MUSIC3_WORKER_CONTRACT = "minimax-music3-worker/v1" as const;
export const MINIMAX_MUSIC3_MODEL = "MiniMaxAI/MiniMax-Music3" as const;
export const MINIMAX_MUSIC3_MODEL_REVISION = "fbdf52fbaaca799592917417eb05f1899f1255ec" as const;
export const MINIMAX_MUSIC3_COMFYUI_REPOSITORY = "comfyanonymous/ComfyUI" as const;
export const MINIMAX_MUSIC3_COMFYUI_REVISION = "efd4e951a00e85bd92e79f1d685427912b0dad5e" as const;
export const MINIMAX_MUSIC3_SAMPLE_RATE_HZ = 32_000 as const;
export const MINIMAX_MUSIC3_CHANNELS = 2 as const;
export const MINIMAX_MUSIC3_BITS_PER_SAMPLE = 16 as const;
export const MINIMAX_MUSIC3_UI_ATTRIBUTION = "MiniMax-Music3" as const;

const SHA256 = /^[a-f0-9]{64}$/u;
const OUTPUT_DOWNLOAD_LIMIT_BYTES = 50_000_000;

export interface MiniMaxMusic3RuntimeReceipt {
  provider: "novita";
  gpuModel: "RTX 4090";
  gpuCount: 2;
  gpuIds: readonly [string, string];
  capacityMode: "spot";
  persistentStorage: true;
  checkpointing: true;
  idleShutdownSeconds: number;
  gpuSeconds: number;
  gpuRateUsdPerSecondPerGpu: number;
  startupUsd: number;
  storageUsd: number;
  costUsd: number;
}

export interface MiniMaxMusic3Receipt {
  schema: typeof MINIMAX_MUSIC3_WORKER_CONTRACT;
  requestKey: string;
  jobId: string;
  programFingerprint: string;
  model: typeof MINIMAX_MUSIC3_MODEL;
  modelRevision: typeof MINIMAX_MUSIC3_MODEL_REVISION;
  runtimeRepository: typeof MINIMAX_MUSIC3_COMFYUI_REPOSITORY;
  runtimeRevision: typeof MINIMAX_MUSIC3_COMFYUI_REVISION;
  captionSha256: string;
  lyricsControlSha256: string;
  seed: number;
  durationSec: number;
  cfgScale: number;
  topK: number;
  output: {
    url: string;
    contentSha256: string;
    byteLength: number;
    sampleRateHz: typeof MINIMAX_MUSIC3_SAMPLE_RATE_HZ;
    channels: typeof MINIMAX_MUSIC3_CHANNELS;
    bitsPerSample: typeof MINIMAX_MUSIC3_BITS_PER_SAMPLE;
    codec: "pcm_s16le";
    container: "wav";
  };
  quality: {
    qualificationReceiptSha256: string;
    humanAuditioned: true;
  };
  license: {
    uiAttribution: typeof MINIMAX_MUSIC3_UI_ATTRIBUTION;
    prominentCommercialAttributionDisplayed: true;
    generatedContentDisclosureEnabled: true;
    safeguardsEnabled: true;
    operatorAttested: true;
  };
  runtime: MiniMaxMusic3RuntimeReceipt;
}

export interface MiniMaxMusic3Readiness {
  configured: boolean;
  qualified: boolean;
  blockers: string[];
}

export interface MiniMaxMusic3Result {
  audio: Uint8Array;
  receipt: MiniMaxMusic3Receipt;
}

export class MiniMaxMusic3Error extends Error {
  readonly retryable = false;

  constructor(
    message: string,
    readonly requestKey?: string,
    readonly status?: number,
    readonly observedCostUsd = 0,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "MiniMaxMusic3Error";
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function workerUrl(): string {
  const raw = process.env.MINIMAX_MUSIC3_WORKER_URL?.trim() ?? "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new MiniMaxMusic3Error("MINIMAX_MUSIC3_WORKER_URL is missing or invalid");
  }
  const loopback = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !loopback) {
    throw new MiniMaxMusic3Error("MINIMAX_MUSIC3_WORKER_URL must use HTTPS outside loopback qualification");
  }
  if (url.username || url.password || url.hash) {
    throw new MiniMaxMusic3Error("MINIMAX_MUSIC3_WORKER_URL must not contain embedded credentials or a fragment");
  }
  return url.toString();
}

function workerToken(): string {
  const token = process.env.MINIMAX_MUSIC3_WORKER_TOKEN?.trim() ?? "";
  if (token.length < 32) {
    throw new MiniMaxMusic3Error("MINIMAX_MUSIC3_WORKER_TOKEN is missing or too short");
  }
  return token;
}

export function minimaxMusic3Readiness(): MiniMaxMusic3Readiness {
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
  const qualificationReceipt = process.env.MINIMAX_MUSIC3_QUALITY_RECEIPT_SHA256?.trim() ?? "";
  if (process.env.MINIMAX_MUSIC3_QUALITY_QUALIFIED !== "1") {
    blockers.push("MINIMAX_MUSIC3_QUALITY_QUALIFIED is not enabled");
  }
  if (!SHA256.test(qualificationReceipt)) {
    blockers.push("MINIMAX_MUSIC3_QUALITY_RECEIPT_SHA256 is missing or invalid");
  }
  const attestationFlags = [
    "MINIMAX_MUSIC3_LICENSE_ATTESTED",
    "MINIMAX_MUSIC3_UI_ATTRIBUTION_ENABLED",
    "MINIMAX_MUSIC3_DISCLOSURE_ENABLED",
    "MINIMAX_MUSIC3_SAFEGUARDS_ATTESTED",
  ] as const;
  for (const flag of attestationFlags) {
    if (process.env[flag] !== "1") blockers.push(`${flag} is not enabled`);
  }
  const configured = urlConfigured && tokenConfigured;
  return { configured, qualified: configured && blockers.length === 0, blockers };
}

export function hasQualifiedMiniMaxMusic3(): boolean {
  return minimaxMusic3Readiness().qualified;
}

function exactString(value: unknown, expected: string, label: string): string {
  if (value !== expected) throw new Error(`MiniMax-Music3 receipt ${label} is not the pinned value`);
  return expected;
}

function finiteNumber(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`MiniMax-Music3 receipt ${label} is invalid`);
  }
  return value;
}

function durableOutputUrl(value: unknown): string {
  let url: URL;
  try {
    url = new URL(String(value ?? ""));
  } catch {
    throw new Error("MiniMax-Music3 output URL is missing or invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("MiniMax-Music3 output URL must be credential-free HTTPS");
  }
  return url.toString();
}

function parsePcmWav(audio: Uint8Array): {
  sampleRateHz: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
  durationSec: number;
} {
  if (audio.byteLength < 44 || audio.byteLength > OUTPUT_DOWNLOAD_LIMIT_BYTES) {
    throw new Error("MiniMax-Music3 WAV is missing or outside the bounded size");
  }
  const bytes = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("MiniMax-Music3 output is not a RIFF/WAVE file");
  }
  let offset = 12;
  let format: { audioFormat: number; channels: number; sampleRateHz: number; bitsPerSample: number } | undefined;
  let dataBytes = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const contentOffset = offset + 8;
    if (contentOffset + size > bytes.length) throw new Error("MiniMax-Music3 WAV contains a truncated chunk");
    if (id === "fmt " && size >= 16) {
      format = {
        audioFormat: bytes.readUInt16LE(contentOffset),
        channels: bytes.readUInt16LE(contentOffset + 2),
        sampleRateHz: bytes.readUInt32LE(contentOffset + 4),
        bitsPerSample: bytes.readUInt16LE(contentOffset + 14),
      };
    } else if (id === "data") {
      dataBytes += size;
    }
    offset = contentOffset + size + (size % 2);
  }
  if (!format || format.audioFormat !== 1 || dataBytes <= 0) {
    throw new Error("MiniMax-Music3 WAV must contain non-empty linear PCM audio");
  }
  const bytesPerSecond = format.sampleRateHz * format.channels * (format.bitsPerSample / 8);
  return { ...format, dataBytes, durationSec: dataBytes / bytesPerSecond };
}

function validateReceipt(args: {
  value: unknown;
  requestKey: string;
  program: ChannelMusicProgram;
  captionSha256: string;
  lyricsControlSha256: string;
  seed: number;
  cfgScale: number;
  topK: number;
  maxCostUsd: number;
}): MiniMaxMusic3Receipt {
  if (!args.value || typeof args.value !== "object" || Array.isArray(args.value)) {
    throw new Error("MiniMax-Music3 worker receipt is missing");
  }
  const value = args.value as Record<string, unknown>;
  exactString(value.schema, MINIMAX_MUSIC3_WORKER_CONTRACT, "schema");
  exactString(value.requestKey, args.requestKey, "request key");
  exactString(value.programFingerprint, args.program.fingerprint, "program fingerprint");
  exactString(value.model, MINIMAX_MUSIC3_MODEL, "model");
  exactString(value.modelRevision, MINIMAX_MUSIC3_MODEL_REVISION, "model revision");
  exactString(value.runtimeRepository, MINIMAX_MUSIC3_COMFYUI_REPOSITORY, "runtime repository");
  exactString(value.runtimeRevision, MINIMAX_MUSIC3_COMFYUI_REVISION, "runtime revision");
  exactString(value.captionSha256, args.captionSha256, "caption digest");
  exactString(value.lyricsControlSha256, args.lyricsControlSha256, "lyrics-control digest");
  if (!SHA256.test(String(value.requestKey)) || typeof value.jobId !== "string" || !value.jobId.trim()) {
    throw new Error("MiniMax-Music3 receipt request/job identity is invalid");
  }
  if (value.seed !== args.seed || value.durationSec !== args.program.generation.durationSec || value.cfgScale !== args.cfgScale || value.topK !== args.topK) {
    throw new Error("MiniMax-Music3 receipt generation controls do not match the request");
  }
  const output = value.output as Record<string, unknown> | undefined;
  if (!output) throw new Error("MiniMax-Music3 output receipt is missing");
  const outputUrl = durableOutputUrl(output.url);
  if (!SHA256.test(String(output.contentSha256)) || !Number.isSafeInteger(output.byteLength) || Number(output.byteLength) < 44 || Number(output.byteLength) > OUTPUT_DOWNLOAD_LIMIT_BYTES) {
    throw new Error("MiniMax-Music3 output integrity receipt is invalid");
  }
  if (output.sampleRateHz !== MINIMAX_MUSIC3_SAMPLE_RATE_HZ || output.channels !== MINIMAX_MUSIC3_CHANNELS || output.bitsPerSample !== MINIMAX_MUSIC3_BITS_PER_SAMPLE || output.codec !== "pcm_s16le" || output.container !== "wav") {
    throw new Error("MiniMax-Music3 output format is not pinned 32 kHz 16-bit stereo WAV");
  }
  const quality = value.quality as Record<string, unknown> | undefined;
  exactString(
    quality?.qualificationReceiptSha256,
    process.env.MINIMAX_MUSIC3_QUALITY_RECEIPT_SHA256 ?? "",
    "quality receipt",
  );
  if (quality?.humanAuditioned !== true) throw new Error("MiniMax-Music3 worker quality was not human-auditioned");
  const license = value.license as Record<string, unknown> | undefined;
  exactString(license?.uiAttribution, MINIMAX_MUSIC3_UI_ATTRIBUTION, "UI attribution");
  for (const key of [
    "prominentCommercialAttributionDisplayed",
    "generatedContentDisclosureEnabled",
    "safeguardsEnabled",
    "operatorAttested",
  ] as const) {
    if (license?.[key] !== true) throw new Error(`MiniMax-Music3 receipt license flag ${key} is not attested`);
  }
  const runtime = value.runtime as Record<string, unknown> | undefined;
  if (!runtime) throw new Error("MiniMax-Music3 runtime receipt is missing");
  exactString(runtime.provider, "novita", "runtime provider");
  exactString(runtime.gpuModel, "RTX 4090", "GPU model");
  if (runtime.gpuCount !== 2 || !Array.isArray(runtime.gpuIds) || runtime.gpuIds.length !== 2 || runtime.gpuIds.some((id) => typeof id !== "string" || !id.trim()) || runtime.gpuIds[0] === runtime.gpuIds[1]) {
    throw new Error("MiniMax-Music3 runtime must attest two distinct GPUs");
  }
  exactString(runtime.capacityMode, "spot", "capacity mode");
  if (runtime.persistentStorage !== true || runtime.checkpointing !== true) {
    throw new Error("MiniMax-Music3 runtime did not attest persistent storage and checkpointing");
  }
  finiteNumber(runtime.idleShutdownSeconds, "idle shutdown", 30, 900);
  const gpuSeconds = finiteNumber(runtime.gpuSeconds, "GPU seconds", 0.001, 7_200);
  const rate = finiteNumber(runtime.gpuRateUsdPerSecondPerGpu, "GPU rate", 0.000001, 1);
  const startupUsd = finiteNumber(runtime.startupUsd, "startup cost", 0, 10);
  const storageUsd = finiteNumber(runtime.storageUsd, "storage cost", 0, 10);
  const costUsd = finiteNumber(runtime.costUsd, "cost", 0.000001, args.maxCostUsd);
  const expectedCost = gpuSeconds * rate * 2 + startupUsd + storageUsd;
  if (Math.abs(costUsd - expectedCost) > 0.000001) {
    throw new Error("MiniMax-Music3 runtime cost receipt is internally inconsistent");
  }
  return {
    ...(value as unknown as MiniMaxMusic3Receipt),
    output: { ...(output as unknown as MiniMaxMusic3Receipt["output"]), url: outputUrl },
  };
}

/** Revalidates a durable worker receipt at later release boundaries. */
export function assertPinnedMiniMaxMusic3Receipt(
  value: unknown,
  programInput: unknown,
): MiniMaxMusic3Receipt {
  const readiness = minimaxMusic3Readiness();
  if (!readiness.qualified) {
    throw new MiniMaxMusic3Error(`MiniMax-Music3 release readiness failed: ${readiness.blockers.join("; ")}`);
  }
  const program = ChannelMusicProgramSchema.parse(programInput);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MiniMaxMusic3Error("MiniMax-Music3 durable runtime receipt is missing");
  }
  const receipt = value as Record<string, unknown>;
  const requestKey = String(receipt.requestKey ?? "");
  const seed = Number(receipt.seed);
  const cfgScale = Number(receipt.cfgScale);
  const topK = Number(receipt.topK);
  try {
    return validateReceipt({
      value,
      requestKey,
      program,
      captionSha256: sha256(program.generation.structuredCaption),
      lyricsControlSha256: sha256(program.generation.lyricsControl),
      seed,
      cfgScale,
      topK,
      maxCostUsd: 10,
    });
  } catch (error) {
    throw new MiniMaxMusic3Error(
      `MiniMax-Music3 durable runtime receipt failed release validation: ${error instanceof Error ? error.message : String(error)}`,
      SHA256.test(requestKey) ? requestKey : undefined,
      undefined,
      0,
      { cause: error },
    );
  }
}

async function downloadAndVerifyOutput(receipt: MiniMaxMusic3Receipt): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(receipt.output.url, { signal: AbortSignal.timeout(300_000) });
  } catch (error) {
    throw new MiniMaxMusic3Error(
      `MiniMax-Music3 output download failed after accepted job ${receipt.jobId}; reconcile request ${receipt.requestKey}`,
      receipt.requestKey,
      undefined,
      receipt.runtime.costUsd,
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new MiniMaxMusic3Error(
      `MiniMax-Music3 output download HTTP ${response.status} after accepted job ${receipt.jobId}`,
      receipt.requestKey,
      response.status,
      receipt.runtime.costUsd,
    );
  }
  const length = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > OUTPUT_DOWNLOAD_LIMIT_BYTES) {
    throw new MiniMaxMusic3Error("MiniMax-Music3 output exceeds the 50 MB bound", receipt.requestKey, response.status, receipt.runtime.costUsd);
  }
  const audio = new Uint8Array(await response.arrayBuffer());
  try {
    if (audio.byteLength !== receipt.output.byteLength || sha256(audio) !== receipt.output.contentSha256) {
      throw new Error("downloaded bytes do not match the output integrity receipt");
    }
    const wav = parsePcmWav(audio);
    if (wav.sampleRateHz !== MINIMAX_MUSIC3_SAMPLE_RATE_HZ || wav.channels !== MINIMAX_MUSIC3_CHANNELS || wav.bitsPerSample !== MINIMAX_MUSIC3_BITS_PER_SAMPLE) {
      throw new Error("downloaded WAV is not pinned 32 kHz 16-bit stereo PCM");
    }
    if (Math.abs(wav.durationSec - receipt.durationSec) > Math.max(0.1, receipt.durationSec * 0.001)) {
      throw new Error("downloaded WAV duration does not match its runtime receipt");
    }
  } catch (error) {
    throw new MiniMaxMusic3Error(
      `MiniMax-Music3 output attestation failed: ${error instanceof Error ? error.message : String(error)}`,
      receipt.requestKey,
      response.status,
      receipt.runtime.costUsd,
      { cause: error },
    );
  }
  return audio;
}

export async function generateMiniMaxMusic3(args: {
  program: unknown;
  seed?: number;
  cfgScale?: number;
  topK?: number;
  maxCostUsd?: number;
  onReceipt?: (receipt: MiniMaxMusic3Receipt) => void | Promise<void>;
}): Promise<MiniMaxMusic3Result> {
  const readiness = minimaxMusic3Readiness();
  if (!readiness.qualified) {
    throw new MiniMaxMusic3Error(`MiniMax-Music3 is not production-ready: ${readiness.blockers.join("; ")}`);
  }
  const program = ChannelMusicProgramSchema.parse(args.program);
  if (program.generation.providerPreference !== "minimax_music3") {
    throw new MiniMaxMusic3Error("MiniMax-Music3 generation requires a program that explicitly selects MiniMax-Music3");
  }
  const seed = Number.isSafeInteger(args.seed) && Number(args.seed) >= 0 ? Number(args.seed) : 4_242;
  const cfgScale = Math.max(1, Math.min(20, args.cfgScale ?? 7));
  const topK = Math.max(1, Math.min(1_000, Math.floor(args.topK ?? 50)));
  const maxCostUsd = Math.min(10, args.maxCostUsd ?? 5);
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
    throw new MiniMaxMusic3Error("MiniMax-Music3 requires a positive per-request cost ceiling");
  }
  const captionSha256 = sha256(program.generation.structuredCaption);
  const lyricsControlSha256 = sha256(program.generation.lyricsControl);
  const payload = {
    schema: MINIMAX_MUSIC3_WORKER_CONTRACT,
    programFingerprint: program.fingerprint,
    model: MINIMAX_MUSIC3_MODEL,
    modelRevision: MINIMAX_MUSIC3_MODEL_REVISION,
    runtimeRepository: MINIMAX_MUSIC3_COMFYUI_REPOSITORY,
    runtimeRevision: MINIMAX_MUSIC3_COMFYUI_REVISION,
    caption: program.generation.structuredCaption,
    captionSha256,
    lyricsControl: program.generation.lyricsControl,
    lyricsControlSha256,
    instrumental: true,
    seed,
    durationSec: program.generation.durationSec,
    cfgScale,
    topK,
    output: {
      sampleRateHz: MINIMAX_MUSIC3_SAMPLE_RATE_HZ,
      channels: MINIMAX_MUSIC3_CHANNELS,
      bitsPerSample: MINIMAX_MUSIC3_BITS_PER_SAMPLE,
      codec: "pcm_s16le",
      container: "wav",
    },
    runtime: {
      provider: "novita",
      gpuModel: "RTX 4090",
      gpuCount: 2,
      capacityMode: "spot",
      persistentStorage: true,
      checkpointing: true,
      idleShutdownMaxSeconds: 900,
    },
    license: {
      uiAttribution: MINIMAX_MUSIC3_UI_ATTRIBUTION,
      prominentCommercialAttributionRequired: true,
      generatedContentDisclosureRequired: true,
      safeguardsRequired: true,
      operatorAttestationRequired: true,
    },
    qualityQualificationReceiptSha256: process.env.MINIMAX_MUSIC3_QUALITY_RECEIPT_SHA256,
    maxCostUsd,
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
      signal: AbortSignal.timeout(900_000),
    });
  } catch (error) {
    throw new MiniMaxMusic3Error(
      `MiniMax-Music3 outcome is unknown after submission; request ${requestKey} must be reconciled, not retried`,
      requestKey,
      undefined,
      0,
      { cause: error },
    );
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new MiniMaxMusic3Error(`MiniMax-Music3 worker HTTP ${response.status}: ${detail.slice(0, 220)}`, requestKey, response.status);
  }
  let body: { receipt?: unknown };
  try {
    body = await response.json() as { receipt?: unknown };
  } catch (error) {
    throw new MiniMaxMusic3Error("MiniMax-Music3 worker returned malformed JSON", requestKey, response.status, 0, { cause: error });
  }
  let receipt: MiniMaxMusic3Receipt;
  try {
    receipt = validateReceipt({
      value: body.receipt,
      requestKey,
      program,
      captionSha256,
      lyricsControlSha256,
      seed,
      cfgScale,
      topK,
      maxCostUsd,
    });
  } catch (error) {
    throw new MiniMaxMusic3Error(
      `MiniMax-Music3 response attestation failed: ${error instanceof Error ? error.message : String(error)}`,
      requestKey,
      response.status,
      0,
      { cause: error },
    );
  }
  const audio = await downloadAndVerifyOutput(receipt);
  await args.onReceipt?.(receipt);
  return { audio, receipt };
}
