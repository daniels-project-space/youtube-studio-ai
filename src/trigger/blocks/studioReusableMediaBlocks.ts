import { COST_PATCH_KEY, type Block } from "@/engine/types";
import type { FamilyKey } from "@/engine/families";
import { assertStudioReusableMediaPlan } from "@/engine/studioReusableMedia";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { claimStudioReusableMediaForRun } from "@/lib/studioReusableMediaRuntime";

function convex(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

function safeTags(...values: unknown[]): string[] {
  return [...new Set(values
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/u))
    .map((value) => value.replace(/^[^a-z]+/u, ""))
    .filter((value) => value.length >= 2)
    .slice(0, 48))]
    .sort();
}

function positiveNumber(value: unknown, fallback: number, maximum: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.min(numeric, maximum) : fallback;
}

/**
 * Claims one immutable channel episode position before any visual source can
 * be reused. This block has no provider path and no best-effort fallback: a
 * storage outage retries before media spend rather than losing the every-third
 * originality cadence or silently exceeding the 40% ceiling.
 */
const studioReusableMediaResolve: Block = {
  id: "studio_reusable_media_resolve",
  consumes: [],
  produces: ["studioReusableMediaPlan", "studioReusableMediaSelections"],
  paid: false,
  run: async (ctx) => {
    const family = typeof ctx.params["family"] === "string" ? ctx.params["family"] : ctx.store["family"];
    if (typeof family !== "string" || !family) {
      throw new Error("studio_reusable_media_resolve: a frozen family is required");
    }
    const targetTimelineSeconds = positiveNumber(
      ctx.store["narrationDurationSec"] ?? ctx.params["targetTimelineSeconds"],
      60,
      28_800,
    );
    const perAssetMaximumScreenSeconds = positiveNumber(
      ctx.params["perAssetMaximumScreenSeconds"],
      12,
      60,
    );
    const nicheKey = typeof ctx.params["nicheKey"] === "string" && ctx.params["nicheKey"].trim()
      ? ctx.params["nicheKey"].trim()
      : undefined;
    const subcategory = typeof ctx.params["subcategory"] === "string" && ctx.params["subcategory"].trim()
      ? ctx.params["subcategory"].trim()
      : undefined;
    const plan = assertStudioReusableMediaPlan(await claimStudioReusableMediaForRun({
      client: convex(),
      request: {
        ownerId: ctx.ownerId,
        channelId: ctx.channelId,
        runId: ctx.runId,
        family: family as FamilyKey,
        ...(nicheKey ? { nicheKey } : {}),
        ...(subcategory ? { subcategory } : {}),
        targetTimelineSeconds,
        perAssetMaximumScreenSeconds,
        queryTags: safeTags(ctx.store["topic"], ctx.store["niche"], nicheKey, subcategory),
        kinds: ["b_roll_video", "ambient_video", "generated_visual_clip"],
      },
    }));
    ctx.log(
      plan.selections.length
        ? `studio_reusable_media_resolve: episode ${plan.episodeOrdinal} selected ${plan.selections.length} channel-scoped clip(s), ${Math.round(plan.plannedReusedTimelineFraction * 100)}% of timeline`
        : `studio_reusable_media_resolve: episode ${plan.episodeOrdinal} is original (${plan.blockers.join(", ") || "no compatible approved media"})`,
    );
    return {
      studioReusableMediaPlan: plan,
      studioReusableMediaSelections: plan.selections,
      [COST_PATCH_KEY]: 0,
    };
  },
};

export const STUDIO_REUSABLE_MEDIA_BLOCKS: readonly Block[] = [studioReusableMediaResolve];
