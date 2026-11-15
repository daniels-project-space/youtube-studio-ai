import { QWEN3_TTS_LANGUAGES, QWEN3_TTS_SPEAKERS, type QwenTtsLanguage, type QwenTtsSpeaker } from "@/lib/qwenTts";

export const HRS_QWEN_TTS_RECEIPT_SCHEMA = "hrs-qwen3-tts-receipt/v1" as const;

export interface HrsQwenTtsReceipt {
  schema: typeof HRS_QWEN_TTS_RECEIPT_SCHEMA;
  route: "hyper-render-service";
  modelId: "qwen3-tts";
  projectId: string;
  jobId: string;
  generation: number;
  environmentId: string;
  environmentSha256: string;
  idempotencyKey: string;
  requestSha256: string;
  textSha256: string;
  instructionSha256: string;
  speaker: QwenTtsSpeaker;
  language: QwenTtsLanguage;
  seed: number;
  audioSha256: string;
  audioFormat: "wav";
  byteLength: number;
  contentType: "audio/wav";
  output: { bucket: string; key: string; sha256: string; bytes: number; contentType: "audio/wav" };
  costStatus: "unreported";
}

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function assertHrsQwenTtsReceipt(value: unknown): HrsQwenTtsReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid HRS Qwen receipt");
  const raw = value as Record<string, unknown>, output = raw.output as Record<string, unknown> | undefined;
  if (raw.schema !== HRS_QWEN_TTS_RECEIPT_SCHEMA || raw.route !== "hyper-render-service" || raw.modelId !== "qwen3-tts" ||
    typeof raw.projectId !== "string" || !uuid.test(raw.projectId) || typeof raw.jobId !== "string" || !uuid.test(raw.jobId) ||
    !Number.isSafeInteger(raw.generation) || Number(raw.generation) < 0 || typeof raw.environmentId !== "string" || !uuid.test(raw.environmentId) ||
    typeof raw.environmentSha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.environmentSha256) ||
    typeof raw.idempotencyKey !== "string" || !raw.idempotencyKey || raw.idempotencyKey.length > 160 ||
    typeof raw.requestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.requestSha256) ||
    typeof raw.textSha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.textSha256) ||
    typeof raw.instructionSha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.instructionSha256) ||
    !(QWEN3_TTS_SPEAKERS as readonly unknown[]).includes(raw.speaker) ||
    !(QWEN3_TTS_LANGUAGES as readonly unknown[]).includes(raw.language) ||
    !Number.isSafeInteger(raw.seed) || Number(raw.seed) < 0 ||
    typeof raw.audioSha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.audioSha256) ||
    raw.audioFormat !== "wav" || raw.contentType !== "audio/wav" || !Number.isSafeInteger(raw.byteLength) || Number(raw.byteLength) < 1 ||
    raw.costStatus !== "unreported" || !output || typeof output !== "object" ||
    typeof output.bucket !== "string" || !output.bucket || typeof output.key !== "string" || !output.key ||
    output.sha256 !== raw.audioSha256 || output.bytes !== raw.byteLength || output.contentType !== "audio/wav") {
    throw new Error("HRS Qwen receipt is incomplete or malformed");
  }
  return value as HrsQwenTtsReceipt;
}
