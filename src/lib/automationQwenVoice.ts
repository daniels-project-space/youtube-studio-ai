import { QWEN3_TTS_SPEAKERS } from "@/engine/qwenTtsProfiles";
import { channelModuleConfigFence } from "@/lib/channelModuleConfigFence";

export function currentAutomationQwenSpeaker(input: {
  config: Record<string, unknown>; params: Record<string, unknown>; identityVoice?: string;
}): string {
  const provider = input.config.ttsProvider ?? input.params.ttsProvider;
  const speaker = input.config.qwenSpeaker ?? input.params.qwenSpeaker ?? input.identityVoice ?? input.params.voiceId;
  const normalized = typeof speaker === "string" ? speaker.trim() : "";
  return typeof provider === "string" && provider.trim().toLowerCase() === "qwen3" &&
    (QWEN3_TTS_SPEAKERS as readonly string[]).includes(normalized) ? normalized : "";
}

export function automationQwenVoiceChange(config: Record<string, unknown>, selection: string) {
  if (!(QWEN3_TTS_SPEAKERS as readonly string[]).includes(selection)) throw new Error("Choose a supported Qwen voice.");
  return { config: { ...config, ttsProvider: "qwen3", qwenSpeaker: selection }, expectedConfigFence: channelModuleConfigFence(config) };
}

export function assertAutomationVoiceSaved(result: { state?: string }) {
  if (result.state === "config_conflict") throw new Error("Narration settings changed elsewhere. Review the latest settings and try again.");
  if (result.state === "channel_locked") throw new Error("This channel is locked.");
  if (result.state === "module_locked") throw new Error("The narration module is locked.");
  if (result.state !== undefined) throw new Error("The voice could not be saved.");
}
