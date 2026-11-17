import { QWEN3_TTS_SPEAKERS } from "./qwenTtsProfiles";
import type { PipelineEntry } from "./types";
import { ExecutionError } from "./executionErrors";

/**
 * Existing channels retain their saved settings, but Automation may only start
 * a narrated run when it explicitly selects a supported Qwen voice. A legacy
 * provider or Fish voice must be changed through channel configuration, never
 * silently mapped to a different voice.
 */
export function assertAutomationNarrationPolicy(entries: readonly PipelineEntry[], seedStore: Readonly<Record<string, unknown>>, env: Readonly<Record<string, string | undefined>> = process.env): void {
  if (env.YOUTUBE_AUTOMATION_PRIVATE !== "1" && env.YOUTUBE_STUDIO_WORKSHOP_PRIVATE !== "1") return;
  for (const entry of entries) {
    // These specialist renderers synthesize their own speech. A Qwen parameter
    // does not make their existing speech paths Qwen-capable. Reject before
    // earlier stages can spend, rather than relying on the final TTS guard.
    if (["whiteboard_scribe", "motion_comic", "lore_short", "documotion_short"].includes(entry.block)) {
      throw new ExecutionError(`${entry.block} does not yet have a qualified Qwen narration path. Its legacy provider will not be used; the module needs a Qwen integration before this channel can run.`, {
        code: "AUTOMATION_QWEN_MODULE_UNSUPPORTED", retryable: false, phase: "pipeline_configuration",
      });
    }
    if (entry.block !== "narration_tts") continue;
    const params = entry.params ?? {};
    const provider = typeof params.ttsProvider === "string" ? params.ttsProvider.trim().toLowerCase() : "fish";
    if (provider !== "qwen3") {
      throw new ExecutionError("This channel needs an explicit Qwen3 narration provider before a video can run. Its saved legacy voice has not been changed.", {
        code: "AUTOMATION_QWEN_CONFIGURATION_REQUIRED", retryable: false, phase: "pipeline_configuration",
      });
    }
    const voice = params.qwenSpeaker ?? seedStore.voiceId ?? params.voiceId;
    if (typeof voice !== "string" || !(QWEN3_TTS_SPEAKERS as readonly string[]).includes(voice.trim())) {
      throw new ExecutionError("This channel needs a supported Qwen3 speaker before a video can run. Select the intended channel voice; no legacy voice is substituted.", {
        code: "AUTOMATION_QWEN_SPEAKER_REQUIRED", retryable: false, phase: "pipeline_configuration",
      });
    }
  }
}
