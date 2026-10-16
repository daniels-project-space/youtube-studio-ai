import { artifactContract } from "@/engine/artifactSchemas";
import { CHANNEL_AWARE_SCRIPT_GEN_VERSION } from "@/engine/channelAwareScriptQaSelection";
import type { ModuleManifest } from "@/engine/moduleManifest";
import { requireAuthoredShowBibleVoice } from "@/engine/showBibleVoice";
import { createScriptGenBlock } from "./narratedBlocks";

export function createChannelAwareScriptGenManifest(legacy: ModuleManifest): ModuleManifest {
  if (legacy.id !== "script_gen") throw new Error("channel-aware script generation requires script_gen");
  const block = createScriptGenBlock((ctx) => requireAuthoredShowBibleVoice(ctx.store["showBible"], "script_gen"));
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
