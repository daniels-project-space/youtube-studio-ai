/** Shared stage context, asset indexing and frozen music-route guards. */
import type { StageContext } from "@/engine/types";
import {
  parseChannelProgramRouteRunSeed,
  type ChannelProgramRouteRunSeed,
} from "@/engine/channelProgramRoute";
import {
  assertOriginalMusicProgramPlanBinding,
  type OriginalMusicProgramPlan,
} from "@/engine/originalMusicProgram";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export function convex(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

export function str(ctx: StageContext, key: string): string {
  const v = ctx.store[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`lofi: expected non-empty string store["${key}"], got ${JSON.stringify(v)}`);
  }
  return v;
}

export function channelProgramRouteFromContext(ctx: StageContext): ChannelProgramRouteRunSeed | undefined {
  const raw = ctx.store["channelProgramRoute"];
  if (raw === undefined) return undefined;
  return parseChannelProgramRouteRunSeed(raw);
}

export function routeSeedForTopicSelection(ctx: StageContext): ChannelProgramRouteRunSeed | undefined {
  const route = channelProgramRouteFromContext(ctx);
  if (!route) return undefined;
  if (!route.requiredBlocks.includes("topic_select")) {
    throw new Error(
      `topic_select: frozen channel program route ${route.routeKey} is owned by a different planner`,
    );
  }
  if (route.directives.claimMode === "certified_quiz_facts") {
    throw new Error("topic_select: certified QuizYear routes must use quiz_topic_plan");
  }
  return route;
}

/**
 * The original-music plan is mandatory only for the new route-owned music
 * foundation. Historical channel pipelines remain replayable, but cannot gain
 * automatic admission until they migrate to the sealed route.
 */
export function musicProgramForCurrentRoute(
  ctx: StageContext,
  topic: string,
): OriginalMusicProgramPlan | undefined {
  const route = channelProgramRouteFromContext(ctx);
  if (!route?.requiredBlocks.includes("music_program_plan")) return undefined;
  return assertOriginalMusicProgramPlanBinding({
    plan: ctx.store["musicProgramPlan"],
    route,
    topic,
  });
}

/** Record an asset row in Convex (best-effort metadata index). */
export async function recordAsset(
  ctx: StageContext,
  kind: string,
  r2Key: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await convex().mutation(api.assets.recordAsset, {
      ownerId: ctx.ownerId,
      channelId: ctx.channelId as Id<"channels">,
      runId: ctx.runId as Id<"runs">,
      kind,
      r2Key,
      meta,
    });
  } catch (e) {
    ctx.log(`recordAsset(${kind}) failed (non-fatal): ${e instanceof Error ? e.message : e}`);
  }
}
