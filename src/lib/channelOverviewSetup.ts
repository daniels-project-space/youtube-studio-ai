import { QWEN3_TTS_SPEAKERS } from "@/engine/qwenTtsProfiles";

type Entry = { block: string; params?: unknown };

/** Configuration only; this is not proof of a qualified voice or publish readiness. */
export function channelOverviewVoiceSetup(
  pipeline: Entry[],
  moduleConfig: Record<string, Record<string, unknown>> | undefined,
  identityVoiceId: string | undefined,
): boolean | null {
  const narration = pipeline.find((entry) => entry.block === "narration_tts");
  if (!narration && pipeline.some((entry) => entry.block === "loop_clips")) return null;
  if (!narration) return false;
  const params = narration.params && typeof narration.params === "object" && !Array.isArray(narration.params)
    ? narration.params as Record<string, unknown> : {};
  const config = moduleConfig?.narration_tts ?? {};
  const provider = config.ttsProvider ?? params.ttsProvider;
  const speaker = config.qwenSpeaker ?? params.qwenSpeaker ?? identityVoiceId ?? params.voiceId;
  return typeof provider === "string" && provider.trim().toLowerCase() === "qwen3" &&
    typeof speaker === "string" && (QWEN3_TTS_SPEAKERS as readonly string[]).includes(speaker);
}
