import type { PipelineEntry } from "@/engine/types";
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
  providerRenderReceipt?: QwenTtsReceipt;
}

export interface ChannelVoiceRequest {
  provider: VoiceCastingProvider;
  qwenSpeaker?: string;
  qwenLanguage?: QwenTtsLanguage;
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
    throw new Error(
      "channel inception cannot pretend that an uncast Fish voice has channel-identity evidence; " +
      "use ElevenLabs, a qualified Qwen3 CustomVoice speaker, or attach separately reviewed Fish casting evidence",
    );
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
  return {
    provider,
    qwenSpeaker,
    qwenLanguage: resolveQwenTtsLanguage(configured["language"] ?? params["language"] ?? args.locale),
  };
}

export function qwenChannelCastingReceiptMatches(cast: PersistedChannelVoiceCast): boolean {
  if (!cast.providerRenderReceipt || !cast.localColdOpenReceipt) return false;
  return isPinnedQwenTtsReceipt(cast.providerRenderReceipt) &&
    cast.providerRenderReceipt.speaker === cast.voiceId &&
    cast.providerRenderReceipt.audioSha256 === cast.localColdOpenReceipt.audioFingerprint;
}
