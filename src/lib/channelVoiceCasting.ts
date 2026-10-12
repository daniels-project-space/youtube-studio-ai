import type { PipelineEntry } from "@/engine/types";
import { z } from "zod";
import { EngineFishReceiptSchema, FishEngineReferenceSchema, type EngineFishReceipt, type FishEngineReference } from "@/engine/fishEngineReceipt";
import { sha256Hex } from "./sha256";
import { channelInceptionContentSha256 } from "@/engine/channelInceptionPlan";
import type { ProviderVoiceCandidate } from "./deterministicVoiceCast";
import {
  isPinnedQwenTtsReceipt,
  QWEN3_TTS_SPEAKERS,
  resolveQwenTtsLanguage,
  type QwenTtsLanguage,
  type QwenTtsReceipt,
} from "@/lib/qwenTts";
import type {
  VoiceCastingAuditionReceipt,
  VoiceCastingProvider,
  VoiceColdOpenReceipt,
  VoiceLocalColdOpenReceipt,
  VoiceProviderSelectionReceipt,
} from "@/lib/voiceCastingReceipt";

export interface PersistedChannelVoiceCast {
  voiceId: string;
  name?: string;
  character?: string;
  score: number;
  why?: string;
  at: number;
  auditionReceipt?: VoiceCastingAuditionReceipt;
  coldOpenReceipt?: VoiceColdOpenReceipt;
  providerSelectionReceipt?: VoiceProviderSelectionReceipt;
  localColdOpenReceipt?: VoiceLocalColdOpenReceipt;
  providerRenderReceipt?: QwenTtsReceipt | EngineFishReceipt;
  fishEngineReference?: FishEngineReference;
}

export interface ChannelVoiceRequest {
  provider: VoiceCastingProvider;
  qwenSpeaker?: string;
  qwenLanguage?: QwenTtsLanguage;
  fishEngineReference?: FishEngineReference;
  fishVoice?: ProviderVoiceCandidate;
  fishLanguage?: string;
}

export function channelVoiceCastingProvider(cast: PersistedChannelVoiceCast): VoiceCastingProvider {
  return cast.providerSelectionReceipt?.provider ?? cast.localColdOpenReceipt?.provider ?? "elevenlabs";
}

/** Resolve the operator's one effective voice choice before any provider work. */
export function resolveRequestedChannelVoice(args: {
  pipeline: readonly PipelineEntry[];
  moduleConfig: Record<string, Record<string, unknown>>;
  locale: string;
}): ChannelVoiceRequest {
  const narration = args.pipeline.find((entry) => entry.block === "narration_tts");
  if (!narration) return { provider: "elevenlabs" };
  const configured = args.moduleConfig["narration_tts"] ?? {};
  const params = (narration.params ?? {}) as Record<string, unknown>;
  const provider = String(configured["ttsProvider"] ?? params["ttsProvider"] ?? "elevenlabs")
    .trim()
    .toLowerCase();
  if (provider === "fish") {
    if (args.pipeline.some(entry => entry.block === "whiteboard_scribe")) {
      throw new Error("Fish channel casting cannot be mixed with the ElevenLabs-only whiteboard renderer");
    }
    const reference = FishEngineReferenceSchema.parse(configured["fishEngineReference"] ?? params["fishEngineReference"]);
    const metadata = z.object({ name: z.string().trim().min(1).max(200), category: z.string().trim().min(1).max(100),
      labels: z.record(z.string().max(100), z.string().max(300)), description: z.string().max(1000).optional(),
    }).strict().parse(configured["fishVoiceMetadata"] ?? params["fishVoiceMetadata"]);
    const rates = [configured["ttsSpeed"], params["ttsSpeed"], configured["speed"], params["speed"]].filter(value => value !== undefined);
    if (rates.some(value => value !== 1)) throw new Error("Engine Fish channel casting requires native speed 1; no speaking-rate control is available");
    return { provider, fishEngineReference: reference,
      fishVoice: { ...metadata, voiceId: `engine-fish:${reference.sha256}` },
      fishLanguage: String(configured["language"] ?? params["language"] ?? args.locale) };
  }
  if (provider !== "elevenlabs" && provider !== "qwen3") {
    throw new Error(`channel inception does not recognize narration TTS provider ${provider || "missing"}`);
  }
  if (provider === "elevenlabs") return { provider };
  if (args.pipeline.some((entry) => entry.block === "whiteboard_scribe")) {
    throw new Error("Qwen3 channel casting cannot be mixed with the ElevenLabs-only whiteboard renderer in one inception pipeline");
  }
  const qwenSpeaker = String(configured["qwenSpeaker"] ?? params["qwenSpeaker"] ?? "").trim();
  if (!qwenSpeaker) {
    throw new Error("Qwen3 channel inception requires an explicit CustomVoice speaker before provider work starts");
  }
  if (!(QWEN3_TTS_SPEAKERS as readonly string[]).includes(qwenSpeaker)) {
    throw new Error(`Qwen3 channel inception does not recognize CustomVoice speaker ${qwenSpeaker}`);
  }
  const qwenLanguage = resolveQwenTtsLanguage(configured["language"] ?? params["language"] ?? args.locale);
  if (qwenSpeaker !== "Ryan" || qwenLanguage !== "English") {
    throw new Error("Render Engine Qwen channel casting currently supports English/Ryan; the requested channel voice requires another Engine profile");
  }
  return {
    provider,
    qwenSpeaker,
    qwenLanguage,
  };
}

export function qwenChannelCastingReceiptMatches(cast: PersistedChannelVoiceCast): boolean {
  if (!cast.providerRenderReceipt || !cast.localColdOpenReceipt) return false;
  if (cast.providerRenderReceipt.schema === "studio-engine-fish-receipt/v1") return false;
  return isPinnedQwenTtsReceipt(cast.providerRenderReceipt) &&
    cast.providerRenderReceipt.speaker === cast.voiceId &&
    cast.providerRenderReceipt.audioSha256 === cast.localColdOpenReceipt.audioFingerprint;
}

export function fishChannelCastingReceiptMatches(cast: PersistedChannelVoiceCast, expected: FishEngineReference, text: string): boolean {
  const receipt = EngineFishReceiptSchema.safeParse(cast.providerRenderReceipt);
  const reference = FishEngineReferenceSchema.safeParse(expected);
  const stored = FishEngineReferenceSchema.safeParse(cast.fishEngineReference);
  if (!receipt.success || !reference.success || !stored.success || !cast.localColdOpenReceipt) return false;
  return receipt.data.voiceId === cast.voiceId && receipt.data.referenceSha256 === reference.data.sha256 &&
    stored.data.sha256 === reference.data.sha256 && stored.data.text === reference.data.text &&
    receipt.data.referenceTextSha256 === sha256Hex(reference.data.text) &&
    receipt.data.audioSha256 === cast.localColdOpenReceipt.audioFingerprint &&
    receipt.data.textSha256 === sha256Hex(text) &&
    cast.localColdOpenReceipt.textFingerprint === channelInceptionContentSha256(text);
}
