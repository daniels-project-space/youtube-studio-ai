import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/canonicalJson";
import {
  assertQwenNarrationSourceEvidence,
  QWEN3_TTS_LANGUAGES,
  QWEN3_TTS_MODEL,
  QWEN3_TTS_MODEL_REVISION,
  QWEN3_TTS_SPEAKERS,
  type QwenNarrationSourceEvidence,
  type QwenTtsLanguage,
  type QwenTtsSpeaker,
} from "@/lib/qwenTts";
import { assertHrsQwenTtsReceipt, type HrsQwenTtsReceipt } from "@/lib/hyperYoutubeQwenTts";

export const HRS_QWEN_NARRATION_EVIDENCE_SCHEMA = "hrs-qwen3-tts-narration-source/v1" as const;
export interface HrsQwenNarrationChunk {
  ordinal: number;
  textSha256: string;
  audioSha256: string;
  byteLength: number;
  receipt: HrsQwenTtsReceipt;
}
export interface HrsQwenNarrationSourceEvidence {
  schema: typeof HRS_QWEN_NARRATION_EVIDENCE_SCHEMA;
  provider: "qwen3";
  route: "hyper-render-service";
  modelId: "qwen3-tts";
  speaker: QwenTtsSpeaker;
  language: QwenTtsLanguage;
  requestCount: number;
  sourceRequestCount: number;
  preflightRequestCount: number;
  costStatus: "unreported";
  receiptSha256: string;
  source: QwenNarrationSourceEvidence["source"];
  sourceChunks: HrsQwenNarrationChunk[];
  preflightReceipts: HrsQwenTtsReceipt[];
}
export type QwenNarrationProviderSourceEvidence = QwenNarrationSourceEvidence | HrsQwenNarrationSourceEvidence;

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const isSha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function assertHrsSource(value: unknown): HrsQwenNarrationSourceEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("HRS Qwen narration evidence is missing");
  const raw = value as Record<string, unknown>;
  if (raw.schema !== HRS_QWEN_NARRATION_EVIDENCE_SCHEMA || raw.provider !== "qwen3" ||
    raw.route !== "hyper-render-service" || raw.modelId !== "qwen3-tts" || raw.costStatus !== "unreported" ||
    "sourceCostUsd" in raw || "totalCostUsd" in raw ||
    !(QWEN3_TTS_SPEAKERS as readonly unknown[]).includes(raw.speaker) ||
    !(QWEN3_TTS_LANGUAGES as readonly unknown[]).includes(raw.language)) {
    throw new Error("HRS Qwen narration evidence has an unsupported route, cost status, speaker, or language");
  }
  const src = raw.source as Record<string, unknown> | undefined;
  if (!src || typeof src !== "object" || typeof src.narrationKey !== "string" || !src.narrationKey.trim() ||
    !isSha(src.sha256) || !isSha(src.transcriptSha256) || src.assembly !== "concat_audio_with_gaps/v1" ||
    !isSha(src.gapPlanSha256) || (src.mode !== "sentence" && src.mode !== "chapter") ||
    !(typeof src.voiceFx === "string" || src.voiceFx === null) ||
    !Number.isSafeInteger(src.byteLength) || Number(src.byteLength) < 1_000 || Number(src.byteLength) > 100_000_000 ||
    typeof src.durationSec !== "number" || !Number.isFinite(src.durationSec) || src.durationSec < 1.5 || src.durationSec > 86_400) {
    throw new Error("HRS Qwen narration evidence has malformed final-source metadata");
  }
  if (!Array.isArray(raw.sourceChunks) || raw.sourceChunks.length < 1 || raw.sourceChunks.length > 2_000 ||
    !Array.isArray(raw.preflightReceipts) || raw.preflightReceipts.length > 8) {
    throw new Error("HRS Qwen narration evidence has an invalid source or preflight receipt count");
  }
  const sourceChunks = raw.sourceChunks.map((value, index): HrsQwenNarrationChunk => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`HRS Qwen chunk ${index + 1} is malformed`);
    const chunk = value as Record<string, unknown>, receipt = assertHrsQwenTtsReceipt(chunk.receipt);
    if (chunk.ordinal !== index || !isSha(chunk.textSha256) || !isSha(chunk.audioSha256) ||
      !Number.isSafeInteger(chunk.byteLength) || Number(chunk.byteLength) < 1 ||
      receipt.speaker !== raw.speaker || receipt.language !== raw.language || receipt.textSha256 !== chunk.textSha256 ||
      receipt.audioSha256 !== chunk.audioSha256 || receipt.byteLength !== chunk.byteLength) {
      throw new Error(`HRS Qwen chunk ${index + 1} does not bind its exact output receipt`);
    }
    return { ordinal: index, textSha256: chunk.textSha256, audioSha256: chunk.audioSha256,
      byteLength: Number(chunk.byteLength), receipt };
  });
  const preflightReceipts = raw.preflightReceipts.map((value) => {
    const receipt = assertHrsQwenTtsReceipt(value);
    if (receipt.speaker !== raw.speaker || receipt.language !== raw.language) throw new Error("HRS Qwen preflight voice does not match source narration");
    return receipt;
  });
  const requestCount = sourceChunks.length + preflightReceipts.length;
  if (raw.requestCount !== requestCount || raw.sourceRequestCount !== sourceChunks.length ||
    raw.preflightRequestCount !== preflightReceipts.length) throw new Error("HRS Qwen narration request counts do not bind receipts");
  const receiptSha256 = sha256(canonicalJson({ sourceChunks: sourceChunks.map(({ receipt }) => receipt), preflightReceipts }));
  if (raw.receiptSha256 !== receiptSha256) throw new Error("HRS Qwen narration receipt digest does not bind receipts");
  return {
    schema: HRS_QWEN_NARRATION_EVIDENCE_SCHEMA, provider: "qwen3", route: "hyper-render-service", modelId: "qwen3-tts",
    speaker: raw.speaker as QwenTtsSpeaker, language: raw.language as QwenTtsLanguage,
    requestCount, sourceRequestCount: sourceChunks.length, preflightRequestCount: preflightReceipts.length,
    costStatus: "unreported", receiptSha256, source: src as HrsQwenNarrationSourceEvidence["source"], sourceChunks, preflightReceipts,
  };
}

export function assertAnyQwenNarrationSourceEvidence(value: unknown): QwenNarrationProviderSourceEvidence {
  if (value && typeof value === "object" && !Array.isArray(value) &&
    (value as Record<string, unknown>).schema === HRS_QWEN_NARRATION_EVIDENCE_SCHEMA) return assertHrsSource(value);
  return assertQwenNarrationSourceEvidence(value);
}

export function createHrsQwenNarrationSourceEvidence(args: Omit<HrsQwenNarrationSourceEvidence,
  "schema" | "provider" | "route" | "modelId" | "requestCount" | "sourceRequestCount" |
  "preflightRequestCount" | "receiptSha256" | "costStatus">): HrsQwenNarrationSourceEvidence {
  const receiptSha256 = sha256(canonicalJson({
    sourceChunks: args.sourceChunks.map(({ receipt }) => receipt), preflightReceipts: args.preflightReceipts,
  }));
  return assertHrsSource({ schema: HRS_QWEN_NARRATION_EVIDENCE_SCHEMA, provider: "qwen3",
    route: "hyper-render-service", modelId: "qwen3-tts", requestCount: args.sourceChunks.length + args.preflightReceipts.length,
    sourceRequestCount: args.sourceChunks.length, preflightRequestCount: args.preflightReceipts.length,
    receiptSha256, costStatus: "unreported", ...args });
}

export function assertAnyQwenNarrationSourceBinding(args: {
  evidence: unknown; narrationKey: string; sourceAudio: Uint8Array; transcript: string; durationSec: number;
}): QwenNarrationProviderSourceEvidence {
  const evidence = assertAnyQwenNarrationSourceEvidence(args.evidence);
  if (evidence.source.narrationKey !== args.narrationKey || evidence.source.sha256 !== sha256(args.sourceAudio) ||
    evidence.source.byteLength !== args.sourceAudio.byteLength || evidence.source.transcriptSha256 !== sha256(args.transcript) ||
    Math.abs(evidence.source.durationSec - args.durationSec) > 0.001) {
    throw new Error("Qwen3 narration evidence does not bind the retained final narration object");
  }
  return evidence;
}

