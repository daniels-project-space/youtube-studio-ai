import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/canonicalJson";
import {
  QWEN3_TTS_LANGUAGES,
  QWEN3_TTS_SPEAKERS,
  qwenTtsInstruction,
  resolveQwenTtsLanguage,
  type QwenTtsLanguage,
  type QwenTtsSpeaker,
} from "@/lib/qwenTts";
import {
  configuredHyperYoutubeStageClient,
  type HyperYoutubeJob,
  type HyperYoutubeStage,
} from "@/lib/hyperYoutubeStageClient";

export const HRS_QWEN_TTS_RECEIPT_VERSION = "hrs-youtube-qwen3-tts-receipt/v1" as const;
export const HRS_QWEN_NARRATION_EVIDENCE_VERSION = "hrs-youtube-qwen3-narration-source/v1" as const;

const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const SHA256 = /^[a-f0-9]{64}$/;

export function hasConfiguredHyperYoutubeQwenTts(): boolean {
  return Boolean(process.env.HRS_YOUTUBE_BASE_URL?.trim() && process.env.HRS_YOUTUBE_PROJECT_TOKEN?.trim());
}

export interface HrsQwenTtsReceipt {
  version: typeof HRS_QWEN_TTS_RECEIPT_VERSION;
  provider: "hyper-render-service";
  modelId: "qwen3-tts";
  projectId: string;
  jobId: string;
  generation: number;
  idempotencyKey: string;
  inputSha256: string;
  textSha256: string;
  instructionSha256: string;
  speaker: QwenTtsSpeaker;
  language: QwenTtsLanguage;
  seed: number;
  nativeOutput: {
    bucket: string;
    key: string;
    sha256: string;
    bytes: number;
    contentType: "audio/wav";
  };
  encodedAudio: {
    sha256: string;
    bytes: number;
    contentType: "audio/mpeg";
    sampleRateHz: 24_000;
  };
}

export interface HrsQwenNarrationSourceEvidence {
  schema: typeof HRS_QWEN_NARRATION_EVIDENCE_VERSION;
  provider: "hyper-render-service";
  modelId: "qwen3-tts";
  billing: "prepaid-worker";
  speaker: QwenTtsSpeaker;
  language: QwenTtsLanguage;
  requestCount: number;
  sourceRequestCount: number;
  preflightRequestCount: number;
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
  sourceChunks: Array<{
    ordinal: number;
    textSha256: string;
    audioSha256: string;
    byteLength: number;
    receipt: HrsQwenTtsReceipt;
  }>;
  preflightReceipts: HrsQwenTtsReceipt[];
}

type TranscodeWav = (wav: Buffer) => Promise<Buffer>;

function transcodeWavToMp3(wav: Buffer): Promise<Buffer> {
  if (wav.length < 44 || wav.length > 100_000_000) throw new Error("HRS Qwen WAV is outside the bounded size");
  const bin = process.env.FFMPEG_BIN?.trim() || "ffmpeg";
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-map", "0:a:0", "-vn",
      "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "24000", "-f", "mp3", "pipe:1"],
    { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let stderr = "";
    let settled = false;
    const finish = (error?: Error, output?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output!);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("HRS Qwen WAV-to-MP3 conversion timed out"));
    }, 60_000);
    child.stdout.on("data", (part: Buffer) => {
      bytes += part.length;
      if (bytes > 36_000_000) {
        child.kill("SIGKILL");
        finish(new Error("HRS Qwen MP3 exceeds the 36 MB bound"));
      } else chunks.push(Buffer.from(part));
    });
    child.stderr.on("data", (part: Buffer) => { if (stderr.length < 8_000) stderr += part.toString(); });
    child.on("error", error => finish(new Error(`HRS Qwen audio converter failed to start: ${error.message}`)));
    child.on("close", code => {
      if (code !== 0) return finish(new Error(`HRS Qwen audio conversion failed (${code}): ${stderr.slice(-800)}`));
      const output = Buffer.concat(chunks);
      if (output.length < 1_000 || output.subarray(0, 3).toString("ascii") !== "ID3" && output[0] !== 0xff) {
        return finish(new Error("HRS Qwen audio conversion returned invalid MP3 bytes"));
      }
      finish(undefined, output);
    });
    child.stdin.on("error", error => finish(new Error(`HRS Qwen audio input failed: ${error.message}`)));
    child.stdin.end(wav);
  });
}

function makeReceipt(args: {
  job: HyperYoutubeJob;
  stage: Extract<HyperYoutubeStage, { modelId: "qwen3-tts" }>;
  idempotencyKey: string;
  instruction: string;
  seed: number;
  mp3: Buffer;
}): HrsQwenTtsReceipt {
  const output = args.job.output;
  if (!output || output.contentType !== "audio/wav") throw new Error("HRS Qwen job has no verified WAV receipt");
  const text = args.stage.inputs.text.replace(/\s+/g, " ").trim();
  const speaker = args.stage.inputs.speaker as QwenTtsSpeaker;
  const language = resolveQwenTtsLanguage(args.stage.inputs.language);
  const textSha256 = sha256(text);
  const instructionSha256 = sha256(args.instruction);
  return assertHrsQwenTtsReceipt({
    version: HRS_QWEN_TTS_RECEIPT_VERSION,
    provider: "hyper-render-service",
    modelId: "qwen3-tts",
    projectId: args.job.projectId,
    jobId: args.job.id,
    generation: args.job.generation,
    idempotencyKey: args.idempotencyKey,
    inputSha256: sha256(canonicalJson({ textSha256, instructionSha256, speaker, language, seed: args.seed })),
    textSha256,
    instructionSha256,
    speaker,
    language,
    seed: args.seed,
    nativeOutput: {
      bucket: output.bucket,
      key: output.key,
      sha256: output.sha256,
      bytes: output.bytes,
      contentType: "audio/wav",
    },
    encodedAudio: {
      sha256: sha256(args.mp3),
      bytes: args.mp3.length,
      contentType: "audio/mpeg",
      sampleRateHz: 24_000,
    },
  });
}

export async function renderHyperYoutubeQwenTts(args: {
  text: string;
  speaker: string;
  language?: string;
  instruction?: string;
  speed?: number;
  seed?: number;
  requestScope: string;
  wait: (jobId: string, check: number) => Promise<void>;
  client?: ReturnType<typeof configuredHyperYoutubeStageClient>;
  transcode?: TranscodeWav;
  onReceipt?: (receipt: HrsQwenTtsReceipt) => void;
}): Promise<{ audio: Buffer; receipt: HrsQwenTtsReceipt }> {
  const text = args.text.replace(/\s+/g, " ").trim();
  if (!text || text.length > 8_000 || !args.requestScope.trim() || args.requestScope.length > 512) {
    throw new Error("Invalid HRS Qwen narration text or request scope");
  }
  if (!(QWEN3_TTS_SPEAKERS as readonly string[]).includes(args.speaker)) throw new Error("Unsupported HRS Qwen speaker");
  const language = resolveQwenTtsLanguage(args.language);
  if (!(QWEN3_TTS_LANGUAGES as readonly string[]).includes(language)) throw new Error("Unsupported HRS Qwen language");
  const seed = Number.isSafeInteger(args.seed) && Number(args.seed) >= 0 ? Number(args.seed) : 4_242;
  const instruction = qwenTtsInstruction(args.instruction, args.speed);
  const stage: HyperYoutubeStage = { modelId: "qwen3-tts", inputs: { text, speaker: args.speaker, language, instruct: instruction }, seed };
  const idempotencyKey = `youtube-qwen3-tts:${sha256(canonicalJson({ scope: args.requestScope, stage }))}`;
  const client = args.client ?? configuredHyperYoutubeStageClient();
  let job = await client.submit(stage, idempotencyKey);
  for (let check = 0; job.state !== "completed"; check++) {
    if (["failed", "cancelled"].includes(job.state)) throw new Error(`HRS Qwen job ${job.id} ended ${job.state}`);
    if (check >= 720) throw new Error(`HRS Qwen job ${job.id} is still ${job.state}; resume the same job`);
    await args.wait(job.id, check);
    job = await client.get(job.id, stage, idempotencyKey);
  }
  const wav = await client.download(job, stage, idempotencyKey);
  const mp3 = await (args.transcode ?? transcodeWavToMp3)(wav);
  const receipt = makeReceipt({ job, stage, idempotencyKey, instruction, seed, mp3 });
  args.onReceipt?.(receipt);
  return { audio: mp3, receipt };
}

export function assertHrsQwenTtsReceipt(value: unknown): HrsQwenTtsReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("HRS Qwen receipt is missing or malformed");
  const raw = value as Record<string, unknown>;
  const native = raw.nativeOutput as Record<string, unknown> | undefined;
  const encoded = raw.encodedAudio as Record<string, unknown> | undefined;
  if (raw.version !== HRS_QWEN_TTS_RECEIPT_VERSION || raw.provider !== "hyper-render-service" || raw.modelId !== "qwen3-tts" ||
      typeof raw.projectId !== "string" || !/^[a-f0-9-]{36}$/i.test(raw.projectId) ||
      typeof raw.jobId !== "string" || !/^[a-f0-9-]{36}$/i.test(raw.jobId) ||
      !Number.isSafeInteger(raw.generation) || Number(raw.generation) < 1 ||
      typeof raw.idempotencyKey !== "string" || !raw.idempotencyKey.startsWith("youtube-qwen3-tts:") ||
      !SHA256.test(String(raw.inputSha256)) || !SHA256.test(String(raw.textSha256)) || !SHA256.test(String(raw.instructionSha256)) ||
      !(QWEN3_TTS_SPEAKERS as readonly unknown[]).includes(raw.speaker) || !(QWEN3_TTS_LANGUAGES as readonly unknown[]).includes(raw.language) ||
      !Number.isSafeInteger(raw.seed) || Number(raw.seed) < 0 ||
      !native || typeof native.bucket !== "string" || !native.bucket || typeof native.key !== "string" ||
      !native.key.startsWith("projects/") || native.key.split("/").some(part => part === ".." || part === ".") ||
      !native.key.endsWith(`/jobs/${String(raw.jobId)}/${String(raw.generation)}/output.wav`) ||
      !SHA256.test(String(native.sha256)) || !Number.isSafeInteger(native.bytes) || Number(native.bytes) < 1 || Number(native.bytes) > 100_000_000 ||
      native.contentType !== "audio/wav" || !encoded || !SHA256.test(String(encoded.sha256)) ||
      !Number.isSafeInteger(encoded.bytes) || Number(encoded.bytes) < 1_000 || Number(encoded.bytes) > 36_000_000 ||
      encoded.contentType !== "audio/mpeg" || encoded.sampleRateHz !== 24_000) {
    throw new Error("HRS Qwen receipt fields are invalid");
  }
  const expectedInputSha256 = sha256(canonicalJson({ textSha256: raw.textSha256, instructionSha256: raw.instructionSha256,
    speaker: raw.speaker, language: raw.language, seed: raw.seed }));
  if (raw.inputSha256 !== expectedInputSha256) throw new Error("HRS Qwen receipt input digest does not bind its request fields");
  return value as HrsQwenTtsReceipt;
}

export function createHrsQwenNarrationSourceEvidence(args: {
  speaker: QwenTtsSpeaker;
  language: QwenTtsLanguage;
  source: HrsQwenNarrationSourceEvidence["source"];
  sourceChunks: HrsQwenNarrationSourceEvidence["sourceChunks"];
  preflightReceipts: HrsQwenTtsReceipt[];
}): HrsQwenNarrationSourceEvidence {
  const receipts = [...args.sourceChunks.map(chunk => chunk.receipt), ...args.preflightReceipts];
  return assertHrsQwenNarrationSourceEvidence({
    schema: HRS_QWEN_NARRATION_EVIDENCE_VERSION,
    provider: "hyper-render-service",
    modelId: "qwen3-tts",
    billing: "prepaid-worker",
    speaker: args.speaker,
    language: args.language,
    requestCount: receipts.length,
    sourceRequestCount: args.sourceChunks.length,
    preflightRequestCount: args.preflightReceipts.length,
    receiptSha256: sha256(canonicalJson(receipts)),
    source: args.source,
    sourceChunks: args.sourceChunks,
    preflightReceipts: args.preflightReceipts,
  });
}

export function assertHrsQwenNarrationSourceEvidence(value: unknown): HrsQwenNarrationSourceEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("HRS Qwen narration evidence is missing or malformed");
  const raw = value as Record<string, unknown>;
  const source = raw.source as Record<string, unknown> | undefined;
  if (raw.schema !== HRS_QWEN_NARRATION_EVIDENCE_VERSION || raw.provider !== "hyper-render-service" ||
      raw.modelId !== "qwen3-tts" || raw.billing !== "prepaid-worker" ||
      !(QWEN3_TTS_SPEAKERS as readonly unknown[]).includes(raw.speaker) || !(QWEN3_TTS_LANGUAGES as readonly unknown[]).includes(raw.language) ||
      !source || typeof source.narrationKey !== "string" || !source.narrationKey || !SHA256.test(String(source.sha256)) ||
      !SHA256.test(String(source.transcriptSha256)) || !SHA256.test(String(source.gapPlanSha256)) ||
      !Number.isSafeInteger(source.byteLength) || Number(source.byteLength) < 1_000 || Number(source.byteLength) > 100_000_000 ||
      typeof source.durationSec !== "number" || !Number.isFinite(source.durationSec) || source.durationSec < 1.5 ||
      source.assembly !== "concat_audio_with_gaps/v1" || (source.mode !== "sentence" && source.mode !== "chapter") ||
      !(typeof source.voiceFx === "string" || source.voiceFx === null)) throw new Error("HRS Qwen narration evidence source is invalid");
  if (!Array.isArray(raw.sourceChunks) || raw.sourceChunks.length < 1 || raw.sourceChunks.length > 2_000 ||
      !Array.isArray(raw.preflightReceipts) || raw.preflightReceipts.length > 8) throw new Error("HRS Qwen narration evidence has invalid receipt sets");
  const sourceChunks = raw.sourceChunks.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`HRS Qwen chunk ${index + 1} is invalid`);
    const chunk = item as Record<string, unknown>;
    const receipt = assertHrsQwenTtsReceipt(chunk.receipt);
    if (chunk.ordinal !== index || !SHA256.test(String(chunk.textSha256)) || chunk.textSha256 !== receipt.textSha256 ||
        chunk.audioSha256 !== receipt.encodedAudio.sha256 || chunk.byteLength !== receipt.encodedAudio.bytes ||
        receipt.speaker !== raw.speaker || receipt.language !== raw.language) throw new Error(`HRS Qwen chunk ${index + 1} does not match its receipt`);
    return { ordinal: index, textSha256: chunk.textSha256 as string, audioSha256: chunk.audioSha256 as string,
      byteLength: Number(chunk.byteLength), receipt };
  });
  const preflightReceipts = raw.preflightReceipts.map(assertHrsQwenTtsReceipt);
  if (preflightReceipts.some(receipt => receipt.speaker !== raw.speaker || receipt.language !== raw.language))
    throw new Error("HRS Qwen preflight receipt does not match the selected voice");
  const receipts = [...sourceChunks.map(chunk => chunk.receipt), ...preflightReceipts];
  if (raw.requestCount !== receipts.length || raw.sourceRequestCount !== sourceChunks.length ||
      raw.preflightRequestCount !== preflightReceipts.length || !SHA256.test(String(raw.receiptSha256)) ||
      raw.receiptSha256 !== sha256(canonicalJson(receipts))) throw new Error("HRS Qwen receipt digest or counts do not bind the evidence");
  return { schema: HRS_QWEN_NARRATION_EVIDENCE_VERSION, provider: "hyper-render-service", modelId: "qwen3-tts",
    billing: "prepaid-worker", speaker: raw.speaker as QwenTtsSpeaker, language: raw.language as QwenTtsLanguage,
    requestCount: receipts.length, sourceRequestCount: sourceChunks.length, preflightRequestCount: preflightReceipts.length,
    receiptSha256: raw.receiptSha256 as string, source: source as HrsQwenNarrationSourceEvidence["source"], sourceChunks, preflightReceipts };
}

export function assertHrsQwenNarrationSourceBinding(args: {
  evidence: unknown;
  narrationKey: string;
  sourceAudio: Uint8Array;
  transcript: string;
  durationSec: number;
}): HrsQwenNarrationSourceEvidence {
  const evidence = assertHrsQwenNarrationSourceEvidence(args.evidence);
  if (evidence.source.narrationKey !== args.narrationKey || evidence.source.sha256 !== sha256(args.sourceAudio) ||
      evidence.source.byteLength !== args.sourceAudio.byteLength || evidence.source.transcriptSha256 !== sha256(args.transcript) ||
      Math.abs(evidence.source.durationSec - args.durationSec) > 0.001) {
    throw new Error("HRS Qwen narration evidence does not bind the retained final narration object");
  }
  return evidence;
}

export type HrsQwenNarrationReceiptInput = Parameters<typeof createHrsQwenNarrationSourceEvidence>[0];
export type HrsQwenStage = Extract<HyperYoutubeStage, { modelId: "qwen3-tts" }>;

