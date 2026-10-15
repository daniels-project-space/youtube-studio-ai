import { artifactContract } from "@/engine/artifactSchemas";
import { CHANNEL_AWARE_SCRIPT_GEN_VERSION } from "@/engine/channelAwareScriptQaSelection";
import type { ModuleManifest } from "@/engine/moduleManifest";
import { parseShowBibleVoice, type ShowBibleVoice } from "@/engine/showBibleVoice";
import { createScriptGenBlock } from "./narratedBlocks";

const MISSING_AUTHORED_VOICE =
  "script_gen: identity-grounded writer requires an authored Show Bible with positioning, vibe, works, and anti-patterns";

function requireAuthoredVoice(value: unknown) {
  let voice: ShowBibleVoice | undefined;
  try {
    voice = parseShowBibleVoice(value);
  } catch {
    throw new Error(MISSING_AUTHORED_VOICE);
  }
  if (
    !voice?.positioning?.trim() ||
    !voice.vibe?.trim() ||
    !voice.worksInSpace?.some((item) => item.trim()) ||
    !voice.avoidInSpace?.some((item) => item.trim())
  ) {
    throw new Error(MISSING_AUTHORED_VOICE);
  }
  return voice;
}

export function createChannelAwareScriptGenManifest(legacy: ModuleManifest): ModuleManifest {
  if (legacy.id !== "script_gen") throw new Error("channel-aware script generation requires script_gen");
  const block = createScriptGenBlock((ctx) => requireAuthoredVoice(ctx.store["showBible"]));
  return {
    ...legacy,
    version: CHANNEL_AWARE_SCRIPT_GEN_VERSION,
    consumes: { ...legacy.consumes, showBible: artifactContract("showBible") },
    optionalConsumes: Object.fromEntries(
      Object.entries(legacy.optionalConsumes).filter(([key]) => key !== "showBible"),
    ),
    certification: {
      status: "contract",
      evidence: "Versioned Show Bible writer grounding; requires real-output evaluation before production qualification.",
    },
    block,
    execute: block.run,
  };
}
