import { artifactContract } from "@/engine/artifactSchemas";
import type { ModuleManifest } from "@/engine/moduleManifest";
import { channelCritiqueContext, createQaScriptBlock } from "./narratedBlocks";

export const CHANNEL_AWARE_SCRIPT_QA_VERSION = "2.0.0-channel-aware";

/** Explicit revision: existing pipelines retain their original critic policy. */
export function createChannelAwareScriptQaManifest(legacy: ModuleManifest): ModuleManifest {
  if (legacy.id !== "qa_script") throw new Error("channel-aware script QA requires qa_script");
  const block = createQaScriptBlock(channelCritiqueContext);
  return {
    ...legacy, version: CHANNEL_AWARE_SCRIPT_QA_VERSION,
    consumes: { ...legacy.consumes, channelName: artifactContract("channelName") },
    optionalConsumes: { ...legacy.optionalConsumes,
      styleGrammar: artifactContract("styleGrammar"), criticDoctrine: artifactContract("criticDoctrine"),
      contentLane: artifactContract("contentLane") },
    certification: { status: "contract",
      evidence: "Opt-in channel-conditioned critic policy; requires real-output evaluation before production qualification." },
    block, execute: block.run,
  };
}
