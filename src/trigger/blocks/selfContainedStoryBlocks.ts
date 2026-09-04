/**
 * Shared self-contained-story handoff.
 *
 * `self_contained_story_plan` owns the bounded, critic-approved text planning
 * action. `self_contained_story` then remains deliberately provider-free and
 * seals that native plan to the frozen route/topic before its matching
 * renderer sees it. Existing routes remain on their legacy direct planner path
 * unless an admitted composition explicitly opts into this pair.
 */
import { COST_PATCH_KEY, type Block, type StageContext } from "@/engine/types";
import { getVisualBrief } from "@/engine/creative/brief";
import { PRICE } from "@/engine/pricing";
import { createSelfContainedStoryReceiptFromRoute } from "@/engine/selfContainedStoryReceipt";
import { produceSelfContainedStoryPlan } from "@/engine/selfContainedStoryPlanning";
import {
  planScribeWithCritique,
  type CritiquedWhiteboardStoryboard,
} from "@/trigger/blocks/whiteboardScribeBlocks";
import {
  planComicWithCritique,
  type CritiquedMotionComicStoryboard,
} from "@/trigger/blocks/motionComicBlocks";
import {
  loreBeatCount,
  planLoreWithCritiqueOutcome,
  type CritiquedLorePlan,
} from "@/trigger/blocks/loreShortBlocks";
import { motionComicPanelCount, type MotionComicBrief } from "@/lib/motionComic";
import {
  channelProgramRouteRunSeedFingerprint,
  parseChannelProgramRouteRunSeed,
} from "@/engine/channelProgramRoute";
import {
  assertSerializedProgramEpisodeContextBinding,
} from "@/lib/serializedProgramEpisodeContext";
import { serializedProgramEpisodeIdentity } from "@/lib/serializedProgramEpisode";
import { type WhiteboardSyncBrief } from "@/lib/whiteboardSync";
import { fallbackNarratorPersona } from "@/lib/identitySpread";

/** Two bounded plan attempts plus two bounded critic passes. */
export const SELF_CONTAINED_STORY_PLAN_MAX_TEXT_COST_USD = 4 * PRICE.boundedTextPassUsd;

function requiredTopic(ctx: StageContext): string {
  const topic = typeof ctx.store["topic"] === "string" ? ctx.store["topic"].trim() : "";
  if (!topic) throw new Error("self_contained_story_plan: a frozen topic is required before story planning");
  return topic;
}

function sourceFacts(ctx: StageContext): string | undefined {
  return typeof ctx.store["researchNotes"] === "string" && ctx.store["researchNotes"].trim()
    ? ctx.store["researchNotes"]
    : (typeof ctx.store["factSheet"] === "string" && ctx.store["factSheet"].trim()
      ? ctx.store["factSheet"]
      : undefined);
}

function whiteboardBrief(ctx: StageContext): WhiteboardSyncBrief {
  const topic = requiredTopic(ctx);
  const visual = getVisualBrief(ctx.store);
  const targetSeconds = Math.max(0, Number(ctx.params["targetSeconds"] ?? 0));
  const panels = targetSeconds > 0 ? Math.max(4, Math.min(16, Math.round(targetSeconds / 22))) : undefined;
  return {
    topic,
    facts: sourceFacts(ctx),
    styleId: String(ctx.params["styleId"] ?? "history"),
    artStyle: visual?.promptStyle,
    ...(panels ? { panels } : {}),
    ...(targetSeconds > 0 ? { targetWords: Math.round(targetSeconds * 3.1) } : {}),
  };
}

function motionComicBrief(ctx: StageContext): MotionComicBrief {
  const topic = requiredTopic(ctx);
  const visual = getVisualBrief(ctx.store);
  const explicitStyle = typeof ctx.params["style"] === "string" ? ctx.params["style"].trim() : "";
  const style = (explicitStyle || visual?.promptStyle || "").replace(/[.\s]+$/, "");
  const targetSeconds = Math.max(0, Number(ctx.params["targetSeconds"] ?? 0));
  const route = parseChannelProgramRouteRunSeed(ctx.store["channelProgramRoute"]);
  const serialIdentity = serializedProgramEpisodeIdentity(route);
  const seriesContinuity = !route.serializedProgram
    ? undefined
    : (() => {
      if (!serialIdentity) {
        throw new Error("self_contained_story_plan: serialized route has no canonical series identity");
      }
      const context = assertSerializedProgramEpisodeContextBinding({
        context: ctx.store["serializedProgramEpisodeContext"],
        routeFingerprint: route.routeFingerprint,
        routeRunSeedFingerprint: channelProgramRouteRunSeedFingerprint(route),
        runId: ctx.runId,
        seriesIdentity: serialIdentity.value,
        seriesTitle: serialIdentity.seriesTitle,
        ...(serialIdentity.seriesCount === undefined ? {} : { seriesCount: serialIdentity.seriesCount }),
        topic,
      });
      return {
        seriesTitle: context.seriesTitle,
        episodeNumber: context.episodeNumber,
        ...(context.seriesCount === undefined ? {} : { seriesCount: context.seriesCount }),
        ...(context.continuity.arcSummary ? { arcSummary: context.continuity.arcSummary } : {}),
        recentPlotBeats: context.continuity.recentPlotBeats.map((entry) => ({ ...entry })),
        unresolvedThreads: [...context.continuity.unresolvedThreads],
        entities: context.continuity.entities.map((entry) => ({ ...entry })),
      };
    })();
  return {
    topic,
    facts: sourceFacts(ctx),
    panels: motionComicPanelCount(ctx.params["panels"]),
    ...(style ? { style } : {}),
    ...(targetSeconds > 0 ? { targetSeconds } : {}),
    ...(seriesContinuity ? { seriesContinuity } : {}),
  };
}

function loreBrief(ctx: StageContext): { topic: string; narrator: string; nScenes: number } {
  const topic = requiredTopic(ctx);
  const targetSeconds = Math.max(0, Number(ctx.params["targetSeconds"] ?? 0));
  // See loreShortBlocks: the same hard-coded persona lived in both files.
  const narrator =
    (typeof ctx.params["narrator"] === "string" ? ctx.params["narrator"].trim() : "") ||
    (typeof ctx.store["persona"] === "string" ? ctx.store["persona"].trim() : "") ||
    fallbackNarratorPersona(String(ctx.store["channelName"] ?? ""));
  return { topic, narrator, nScenes: loreBeatCount(targetSeconds) };
}

function requirePlanningReservation(ctx: StageContext): void {
  if (
    typeof ctx.stageBudgetUsd !== "number"
    || !Number.isFinite(ctx.stageBudgetUsd)
    || ctx.stageBudgetUsd < SELF_CONTAINED_STORY_PLAN_MAX_TEXT_COST_USD
  ) {
    throw new Error(
      `self_contained_story_plan: requires a compiler-signed $${SELF_CONTAINED_STORY_PLAN_MAX_TEXT_COST_USD.toFixed(3)} text-planning reservation before any planner call`,
    );
  }
}

/**
 * The route decides the lane-specific critic threshold. Do not let a manually
 * assembled invocation plan a whiteboard/comic story under an unrelated—or
 * absent—lane policy merely because both values happen to be present in the
 * loose stage store.
 */
function requireFrozenContentLane(ctx: StageContext): void {
  const route = ctx.store["channelProgramRoute"] as { contentLaneKey?: unknown } | undefined;
  const lane = ctx.store["contentLane"] as { key?: unknown } | undefined;
  const routeLane = typeof route?.contentLaneKey === "string" ? route.contentLaneKey : "";
  const activeLane = typeof lane?.key === "string" ? lane.key : "";
  if (!routeLane || !activeLane || activeLane !== routeLane) {
    throw new Error(
      `self_contained_story_plan: active content lane ${activeLane || "<missing>"} must match the frozen route lane ${routeLane || "<missing>"}`,
    );
  }
}

export const selfContainedStoryPlan: Block = {
  id: "self_contained_story_plan",
  consumes: ["topic", "channelProgramRoute", "contentLane"],
  produces: ["selfContainedStoryPlan"],
  paid: true,
  run: async (ctx) => {
    requirePlanningReservation(ctx);
    requireFrozenContentLane(ctx);
    const plan = await produceSelfContainedStoryPlan({
      route: ctx.store["channelProgramRoute"],
      planners: {
        whiteboard: async (): Promise<CritiquedWhiteboardStoryboard> => planScribeWithCritique(ctx, whiteboardBrief(ctx)),
        comic: async (): Promise<CritiquedMotionComicStoryboard> => planComicWithCritique(ctx, motionComicBrief(ctx)),
        loreshort: async (): Promise<CritiquedLorePlan> => planLoreWithCritiqueOutcome(ctx, loreBrief(ctx)),
      },
    });
    const observedTextCost = ctx.modelUsageCostUsd?.(["text"]) ?? 0;
    ctx.log(
      `self_contained_story_plan: produced ${plan.storyKind} with accepted critic score ${plan.critique.score.toFixed(2)} ` +
      `(${plan.critique.iterations} bounded iteration(s))`,
    );
    return {
      selfContainedStoryPlan: plan,
      [COST_PATCH_KEY]: observedTextCost,
    };
  },
};

export const selfContainedStory: Block = {
  id: "self_contained_story",
  consumes: ["topic", "channelProgramRoute", "selfContainedStoryPlan"],
  produces: ["selfContainedStoryReceipt"],
  run: async (ctx) => {
    const receipt = createSelfContainedStoryReceiptFromRoute({
      topic: ctx.store["topic"],
      route: ctx.store["channelProgramRoute"],
      plan: ctx.store["selfContainedStoryPlan"],
    });
    ctx.log(
      `self_contained_story: sealed ${receipt.storyKind} for ${receipt.contentLaneKey} ` +
      `against the frozen route (provider calls: 0)`,
    );
    return { selfContainedStoryReceipt: receipt };
  },
};

export const selfContainedStoryBlocks: Block[] = [selfContainedStoryPlan, selfContainedStory];
