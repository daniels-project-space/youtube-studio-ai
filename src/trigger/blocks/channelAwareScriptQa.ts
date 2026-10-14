import { artifactContract } from "@/engine/artifactSchemas";
import type { ModuleManifest } from "@/engine/moduleManifest";
import { z } from "zod";
import { CHANNEL_AWARE_SCRIPT_QA_VERSION } from "@/engine/channelAwareScriptQaSelection";
import { laneQualityPolicy } from "@/engine/contentLane";
import type { ChannelCritiqueContext } from "@/engine/critiqueLoop";
import type { StageContext } from "@/engine/types";
import { createQaScriptBlock } from "./narratedBlocks";

const scriptContextSchema = z.object({
  channelName: z.string().optional(), persona: z.string().optional(), criticDoctrine: z.string().optional(),
  bannedWords: z.array(z.string().min(1).max(160)).max(32).optional(),
  styleDNA: z.object({ narrative: z.object({
    scriptStyle: z.string().optional(), hookStyle: z.string().optional(),
    pacing: z.string().optional(), delivery: z.string().optional(),
  }).optional() }).nullish(),
});

function scriptCritiqueContext(ctx: StageContext): ChannelCritiqueContext {
  // Visual grammar and acoustic casting are owned by other modules.
  const parsed = scriptContextSchema.parse({ channelName: ctx.store["channelName"],
    persona: ctx.store["persona"], criticDoctrine: ctx.store["criticDoctrine"],
    bannedWords: ctx.store["bannedWords"], styleDNA: ctx.store["styleDNA"] });
  const lane = ctx.store["contentLane"] as { key?: unknown } | null | undefined;
  return { channelName: parsed.channelName, persona: parsed.persona, criticDoctrine: parsed.criticDoctrine,
    bannedWords: parsed.bannedWords,
    narrative: parsed.styleDNA?.narrative,
    ...(typeof lane?.key === "string" ? { contentLaneKey: lane.key } : {}),
    laneEmphasis: laneQualityPolicy(ctx.store["contentLane"]).emphasis };
}

export { CHANNEL_AWARE_SCRIPT_QA_VERSION } from "@/engine/channelAwareScriptQaSelection";

/** Explicit revision: existing pipelines retain their original critic policy. */
export function createChannelAwareScriptQaManifest(legacy: ModuleManifest): ModuleManifest {
  if (legacy.id !== "qa_script") throw new Error("channel-aware script QA requires qa_script");
  const block = createQaScriptBlock(scriptCritiqueContext);
  return {
    ...legacy, version: CHANNEL_AWARE_SCRIPT_QA_VERSION,
    consumes: { ...legacy.consumes, channelName: artifactContract("channelName") },
    optionalConsumes: { ...legacy.optionalConsumes,
      styleDNA: artifactContract("styleDNA"), criticDoctrine: artifactContract("criticDoctrine"),
      contentLane: artifactContract("contentLane"), bannedWords: artifactContract("bannedWords") },
    certification: { status: "contract",
      evidence: "Opt-in channel-conditioned critic policy; requires real-output evaluation before production qualification." },
    block, execute: block.run,
  };
}
