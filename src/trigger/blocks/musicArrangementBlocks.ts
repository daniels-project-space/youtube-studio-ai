import {
  createAcceptedMusicArrangement,
  createMusicReviewContext,
  MusicArrangementIntentSchema,
  MusicSymbolicScoreSchema,
} from "@/engine/acceptedMusicArrangement";
import { z } from "zod";
import {
  briefComposerWithArrangement,
  ComposerBriefWithArrangementSchema,
} from "@/engine/creative/crew";
import { manifestFromBlock, type ModuleManifest } from "@/engine/moduleManifest";
import type { Block } from "@/engine/types";
import type { ComposerDirectives } from "@/lib/crew/composer";
import { agentJsonConfiguration } from "@/agents/mastra";
import { arrangementComposerReservation, assertArrangementComposerAdmission } from "@/lib/arrangementComposerBudget";
import { createComposerBriefBlock } from "./crewBlocks";

export const ARRANGEMENT_COMPOSER_VERSION = "2.0.0-accepted-arrangement";
export const SCORED_ARRANGEMENT_COMPOSER_VERSION = "3.0.0-yue2-score";
export const YUE2_INTENT_ARRANGEMENT_VERSION = "1.0.0-yue2-intent";

const IntentArrangementParams = z.object({
  musicIntent: MusicArrangementIntentSchema,
  direction: z.string().trim().min(8).max(3_000),
}).strict();

export const musicIntentArrangementPlan: Block = {
  id: "music_intent_arrangement",
  consumes: ["topic"],
  produces: ["acceptedMusicArrangement"],
  paid: false,
  run: async (ctx) => {
    const { musicIntent, direction } = IntentArrangementParams.parse(ctx.params);
    const topic = ctx.store["topic"];
    if (typeof topic !== "string" || !topic.trim()) throw new Error("music_intent_arrangement requires a non-empty topic");
    const ending = musicIntent.ending ?? (musicIntent.playback === "repeat" ? "seamless_wrap" : "natural_cadence");
    const channelName = typeof ctx.store["channelName"] === "string" ? String(ctx.store["channelName"]).trim() : "";
    const symbolicScore = [
      "X:1", "T:Bright QuizYear Instrumental", "M:4/4", "L:1/8", "Q:1/4=100", "K:C",
      '"C" C2 E2 G2 E2 | "F" A2 G2 E2 C2 | "Am" A2 c2 B2 A2 | "G" G2 B2 d2 B2 |',
      '"F" A2 c2 A2 F2 | "C" G2 E2 C2 E2 | "G" G2 B2 d2 B2 | "C" c2 G2 E4 |',
      '"Am" A2 c2 e2 c2 | "F" A2 G2 F2 A2 | "G" B2 d2 g2 d2 | "C" c2 G2 E4 |',
    ].join("\n");
    const arrangement = {
      ...musicIntent,
      form: musicIntent.form ?? "sectional",
      ending,
      direction: [direction, `Episode focus: ${topic.trim()}.`, "Instrumental only; no vocals or lyrics."].join(" "),
      sections: [
        { id: "opening", label: "Opening identity", startFraction: 0, endFraction: 0.12, energy: 0.32, instruction: `Establish the channel sound from the opening: ${direction}` },
        { id: "main-bed", label: "Main bed", startFraction: 0.12, endFraction: 0.76, energy: 0.46, instruction: `Sustain the episode bed beneath ${topic.trim()} without competing with on-screen information.` },
        { id: "lift", label: "Answer lift", startFraction: 0.76, endFraction: 0.92, energy: 0.58, instruction: "Add a restrained harmonic lift for the reveal; preserve the established instrumentation and motif." },
        { id: "resolution", label: "Resolution", startFraction: 0.92, endFraction: 1, energy: 0.3, instruction: ending === "seamless_wrap" ? "Resolve smoothly into the opening motif with no abrupt cutoff." : "Resolve with a natural cadence and audible musical ending." },
      ],
    };
    return {
      acceptedMusicArrangement: createAcceptedMusicArrangement({
        ownerId: ctx.ownerId,
        channelId: ctx.channelId,
        runId: ctx.runId,
        topic: topic.trim(),
        sourceBrief: {
          musicIntent,
          direction,
          symbolicScore,
          symbolicScorePolicy: "instrumental",
          reviewContext: createMusicReviewContext({
            topic: topic.trim(), family: "quiz_year", channelName: channelName || null,
            promptContext: [direction, `Episode focus: ${topic.trim()}.`,
              channelName ? `Channel: ${channelName}.` : "Channel name was not provided.",
              "Fixed family constraints: upbeat game-show instrumental, marimba-led identity, light percussion, loop-ready cadence; no vocals or lyrics."].join(" "),
          }),
        },
        arrangement,
      }),
    };
  },
};

export function createMusicIntentArrangementManifest(): ModuleManifest {
  const block: Block & { version: string } = { ...musicIntentArrangementPlan, version: YUE2_INTENT_ARRANGEMENT_VERSION };
  return {
    ...manifestFromBlock(block, {
      version: YUE2_INTENT_ARRANGEMENT_VERSION,
      capabilities: ["music.arrangement.accepted"],
      optionalConsumes: ["channelName"],
      providerProfiles: [{ id: "deterministic-music-intent", provider: "local", quality: "production", allowFallback: false }],
      maxCostUsd: 0,
      maxLatencySec: 1,
      certification: "contract",
      certificationEvidence: "Seals explicit family/channel music intent into a typed arrangement without a text-model call.",
      qualityRequired: true,
    }),
    configSchema: IntentArrangementParams,
  };
}

export function createArrangementComposerManifest(legacy: ModuleManifest, includeSymbolicScore = false): ModuleManifest {
  if (legacy.id !== "composer_brief") throw new Error("arrangement composer requires composer_brief");
  const reservation = () => arrangementComposerReservation(agentJsonConfiguration("composer_arrangement").model, includeSymbolicScore);
  const producer = createComposerBriefBlock();
  const block: Block = {
    ...producer,
    paid: true,
    run: async (ctx) => {
      const musicIntent = ctx.params.musicIntent === undefined ? undefined : MusicArrangementIntentSchema.parse(ctx.params.musicIntent);
      const admission = {
        budgetUsd: ctx.budgetUsd, stageBudgetUsd: ctx.stageBudgetUsd,
        beforeDispatch: ctx.assertInlinePaidExecutionLease,
      };
      assertArrangementComposerAdmission(agentJsonConfiguration("composer_arrangement").model, admission, includeSymbolicScore);
      const boundProducer = createComposerBriefBlock((bible, crewContext) =>
        briefComposerWithArrangement(bible, { ...crewContext, ...(musicIntent ? { musicIntent } : {}) }, admission, includeSymbolicScore));
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
    version: includeSymbolicScore ? SCORED_ARRANGEMENT_COMPOSER_VERSION : ARRANGEMENT_COMPOSER_VERSION,
    configSchema: legacy.configSchema.and(z.object({ musicIntent: MusicArrangementIntentSchema.optional() }).passthrough()),
    capabilities: [...legacy.capabilities, "crew.accepted_music_arrangement", ...(includeSymbolicScore ? ["crew.symbolic_music_score"] : [])],
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
        schema: legacy.produces.musicBrief.schema.and(ComposerBriefWithArrangementSchema)
          .and(includeSymbolicScore ? z.object({ symbolicScore: MusicSymbolicScoreSchema }) : z.unknown()),
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
 * acceptedMusicArrangement feeds the explicit CLI and opt-in shared YuE2 source
 * version. Neither acceptance nor a generated candidate grants release approval.
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
