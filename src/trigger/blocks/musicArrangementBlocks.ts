import {
  createAcceptedMusicArrangement,
} from "@/engine/acceptedMusicArrangement";
import {
  briefComposerWithArrangement,
  ComposerBriefWithArrangementSchema,
} from "@/engine/creative/crew";
import type { ModuleManifest } from "@/engine/moduleManifest";
import type { Block } from "@/engine/types";
import type { ComposerDirectives } from "@/lib/crew/composer";
import { agentJsonConfiguration } from "@/agents/mastra";
import { arrangementComposerReservation, assertArrangementComposerAdmission } from "@/lib/arrangementComposerBudget";
import { createComposerBriefBlock } from "./crewBlocks";

export const ARRANGEMENT_COMPOSER_VERSION = "2.0.0-accepted-arrangement";

export function createArrangementComposerManifest(legacy: ModuleManifest): ModuleManifest {
  if (legacy.id !== "composer_brief") throw new Error("arrangement composer requires composer_brief");
  const reservation = () => arrangementComposerReservation(agentJsonConfiguration("composer_arrangement").model);
  const producer = createComposerBriefBlock();
  const block: Block = {
    ...producer,
    paid: true,
    run: async (ctx) => {
      const admission = {
        budgetUsd: ctx.budgetUsd, stageBudgetUsd: ctx.stageBudgetUsd,
        beforeDispatch: ctx.assertInlinePaidExecutionLease,
      };
      assertArrangementComposerAdmission(agentJsonConfiguration("composer_arrangement").model, admission);
      const boundProducer = createComposerBriefBlock((bible, crewContext) =>
        briefComposerWithArrangement(bible, crewContext, admission));
      const patch = await boundProducer.run(ctx);
      const brief = patch.musicBrief as { directives: ComposerDirectives };
      const { voiceFx, ...directives } = brief.directives;
      // The legacy resolver represents absent voice FX as undefined; the new
      // typed JSON artifact must omit it without changing the default block.
      return { ...patch, musicBrief: {
        ...brief,
        directives: { ...directives, ...(voiceFx === undefined ? {} : { voiceFx }) },
      } };
    },
  };
  return {
    ...legacy,
    version: ARRANGEMENT_COMPOSER_VERSION,
    capabilities: [...legacy.capabilities, "crew.accepted_music_arrangement"],
    providerProfiles: [{
      id: agentJsonConfiguration("composer_arrangement").model,
      provider: "openrouter", quality: "production", allowFallback: false,
    }],
    costAndLatency: {
      ...legacy.costAndLatency, paid: true,
      get maxCostUsd() { return reservation(); },
      maxCostUsdFor: reservation,
    },
    idempotency: { required: true, scope: "run_module" },
    retryAndResume: { ...legacy.retryAndResume, durableCheckpoint: true },
    securityAndSideEffects: {
      ...legacy.securityAndSideEffects,
      effects: [...legacy.securityAndSideEffects.effects.filter((effect) => effect !== "none" && effect !== "paid_compute"), "paid_compute"],
    },
    produces: {
      ...legacy.produces,
      musicBrief: {
        ...legacy.produces.musicBrief,
        schema: legacy.produces.musicBrief.schema.and(ComposerBriefWithArrangementSchema),
      },
    },
    certification: {
      status: "contract",
      evidence: "Opt-in typed composer arrangement handoff; not provider or Golden audio qualification.",
    },
    block,
    execute: block.run,
  };
}

/**
 * Deterministic acceptance only: no text generation, inferred form, or provider authority.
 * acceptedMusicArrangement is terminal evaluation evidence for the explicit CLI
 * handoff, not yet an input to a production block (audit-inert-produces baseline).
 */
export const musicArrangementPlan: Block = {
  id: "music_arrangement_plan",
  consumes: ["topic", "musicBrief"],
  produces: ["acceptedMusicArrangement"],
  run: async (ctx) => {
    const sourceBrief = ctx.store["musicBrief"];
    const brief = ComposerBriefWithArrangementSchema.parse(sourceBrief);
    const topic = ctx.store["topic"];
    if (typeof topic !== "string" || !topic.trim()) {
      throw new Error("music_arrangement_plan requires a non-empty topic");
    }
    if (!ctx.channelId) throw new Error("music_arrangement_plan requires a channel id");
    return {
      acceptedMusicArrangement: createAcceptedMusicArrangement({
        ownerId: ctx.ownerId,
        channelId: ctx.channelId,
        runId: ctx.runId,
        topic,
        sourceBrief,
        arrangement: brief.arrangement,
      }),
    };
  },
};
