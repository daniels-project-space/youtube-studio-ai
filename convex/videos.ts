import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/**
 * Finished-videos library (Tranche 4).
 *
 * A "finished" video = a run that has either a `youtubeVideoId` (published) OR
 * at least one asset of `kind === "video"` (rendered, maybe not yet uploaded).
 *
 * Each row is enriched for the client so the Library page can render a card +
 * lightbox without any further round-trips:
 *   - channelName / channelSlug   (join the channels table)
 *   - youtubeVideoId              (free YouTube thumb + embed when present)
 *   - thumbnailKey                (r2Key of the run's `kind === "thumbnail"`
 *                                  asset — the client presigns it via the
 *                                  /api/asset-url route; null when absent)
 *   - videoKey                    (r2Key of the run's `kind === "video"` asset
 *                                  — used by the lightbox <video> fallback)
 *   - title                       (REAL SEO title from the `metadata` runStage,
 *                                  falling back to asset meta → channel name)
 *   - description / tags          (metadata runStage outputs, trimmed for the
 *                                  list payload — full text via getVideoDetail)
 *   - thumbnailTitle / visualRationale  (claude_flux thumbnail intelligence,
 *                                  surfaced in the lightbox detail)
 *   - estimatedViews / estimatedViewsSource  (metadata stage, run fallback)
 *   - durationSec                 (when present on an asset/run meta)
 *   - createdAt / status
 *
 * Newest first. Streams the runs index in desc order and STOPS once `limit`
 * finished rows are found — the old shape collected EVERY owner run (the 16MB
 * query problem) before filtering.
 */

/** The `metadata` block's persisted stage outputs for a run (or {}). */
async function metadataOutputs(
  ctx: QueryCtx,
  runId: Id<"runs">,
): Promise<Record<string, unknown>> {
  const stage = await ctx.db
    .query("runStages")
    .withIndex("by_run_block", (q) => q.eq("runId", runId).eq("block", "metadata"))
    .first();
  const out = stage?.outputs;
  return out && typeof out === "object" ? (out as Record<string, unknown>) : {};
}

export const listVideos = query({
  args: {
    ownerId: v.string(),
    channelId: v.optional(v.id("channels")),
    status: v.optional(v.string()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Bound the scan even when the caller passes no limit (all current
    // callers do); early termination below keeps the common case cheap.
    const limit = args.limit ?? 200;
    const needle = args.search?.trim().toLowerCase() ?? "";

    // Narrowest index first: by_channel when filtered, else by_owner. desc =
    // newest _creationTime first (≈ startedAt order; runs stamp startedAt at
    // insert), so we can stop as soon as `limit` finished rows are collected.
    const source = args.channelId
      ? ctx.db
          .query("runs")
          .withIndex("by_channel", (q) => q.eq("channelId", args.channelId!))
          .order("desc")
      : ctx.db
          .query("runs")
          .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
          .order("desc");

    // Channel-name cache so we join each channel at most once.
    const channelCache = new Map<
      string,
      { name: string; slug: string } | null
    >();
    const getChannel = async (channelId: Id<"channels">) => {
      const key = channelId as string;
      if (channelCache.has(key)) return channelCache.get(key)!;
      const ch = await ctx.db.get(channelId);
      const val = ch ? { name: ch.name, slug: ch.slug } : null;
      channelCache.set(key, val);
      return val;
    };

    const rows: Array<Record<string, unknown>> = [];

    for await (const run of source) {
      if (rows.length >= limit) break;
      // Tenancy guard when reading the channel index.
      if (run.ownerId !== args.ownerId) continue;
      // Server-side status filter.
      if (args.status && run.status !== args.status) continue;

      // Pull this run's assets once; pick out thumbnail + video.
      const assets = await ctx.db
        .query("assets")
        .withIndex("by_run", (q) => q.eq("runId", run._id))
        .collect();

      const videoAsset = assets.find((a) => a.kind === "video");
      const thumbAsset = assets.find((a) => a.kind === "thumbnail");

      // A shippable video = published (youtubeVideoId) OR a rendered video from
      // a run that did NOT fail. A FAILED run that only left an intermediate
      // video asset (e.g. died at qa_visual after the engine uploaded a draft
      // key) is a stranded orphan, not a video — it used to clutter the Library
      // with duplicate rows (3 rows for 1 usable video). Published runs always
      // show regardless of status.
      const isFinished =
        Boolean(run.youtubeVideoId) || (Boolean(videoAsset) && run.status !== "failed");
      if (!isFinished) continue;

      const channel = await getChannel(run.channelId);

      // The REAL title/SEO live in the `metadata` stage outputs (they were
      // previously stranded there — asset meta rarely carries a title).
      const mOut = await metadataOutputs(ctx, run._id);
      const vMeta = (videoAsset?.meta ?? {}) as Record<string, unknown>;
      const tMeta = (thumbAsset?.meta ?? {}) as Record<string, unknown>;
      const title =
        (typeof mOut.title === "string" && mOut.title) ||
        (typeof vMeta.title === "string" && vMeta.title) ||
        (typeof tMeta.thumbnailTitle === "string" && tMeta.thumbnailTitle) ||
        (typeof tMeta.title === "string" && tMeta.title) ||
        (channel?.name ?? "Untitled video");

      // Optional title search — must run BEFORE the row counts toward `limit`.
      if (needle && !String(title).toLowerCase().includes(needle)) continue;

      const description =
        typeof mOut.description === "string"
          ? mOut.description.slice(0, 400)
          : undefined;
      const tags = Array.isArray(mOut.tags)
        ? (mOut.tags.filter((t) => typeof t === "string") as string[]).slice(0, 20)
        : undefined;

      // Optional duration from either asset's meta.
      const durationSec =
        typeof vMeta.durationSec === "number"
          ? (vMeta.durationSec as number)
          : typeof vMeta.duration === "number"
            ? (vMeta.duration as number)
            : undefined;

      // Estimated views: metadata stage first, legacy run fields as fallback.
      const runAny = run as unknown as Record<string, unknown>;
      const estimatedViews =
        typeof mOut.estimatedViews === "number"
          ? (mOut.estimatedViews as number)
          : typeof runAny.estimatedViews === "number"
            ? (runAny.estimatedViews as number)
            : undefined;
      const estimatedViewsSource =
        typeof mOut.estimatedViewsSource === "string"
          ? (mOut.estimatedViewsSource as string)
          : typeof runAny.estimatedViewsSource === "string"
            ? (runAny.estimatedViewsSource as string)
            : undefined;

      rows.push({
        _id: run._id,
        status: run.status,
        createdAt: run.startedAt ?? run._creationTime,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        youtubeVideoId: run.youtubeVideoId,
        // Fold the private-draft watch URL into the row so the Library can link
        // straight to the uploaded draft (it used to be stranded in the
        // upload_draft stage outputs, never surfaced to the UI).
        watchUrl: run.youtubeVideoId
          ? `https://www.youtube.com/watch?v=${run.youtubeVideoId}`
          : undefined,
        channelId: run.channelId,
        channelName: channel?.name ?? "(unknown)",
        channelSlug: channel?.slug ?? "",
        title: title as string,
        description,
        tags,
        thumbnailKey: thumbAsset?.r2Key ?? null,
        videoKey: videoAsset?.r2Key ?? null,
        thumbnailTitle:
          typeof tMeta.thumbnailTitle === "string"
            ? (tMeta.thumbnailTitle as string)
            : undefined,
        visualRationale:
          typeof tMeta.visualRationale === "string"
            ? (tMeta.visualRationale as string)
            : undefined,
        estimatedViews,
        estimatedViewsSource,
        durationSec,
      });
    }

    // Newest first (startedAt can drift a hair from _creationTime).
    rows.sort((a, b) => (b.createdAt as number) - (a.createdAt as number));
    return rows;
  },
});

/**
 * On-demand detail for one finished run's lightbox: FULL description, tags,
 * and the narration script (stranded in runStages outputs until now). Small
 * targeted reads — one stage row per block via by_run_block.
 */
export const getVideoDetail = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;

    const stageOutputs = async (block: string) => {
      const stage = await ctx.db
        .query("runStages")
        .withIndex("by_run_block", (q) =>
          q.eq("runId", args.runId).eq("block", block),
        )
        .first();
      const out = stage?.outputs;
      return out && typeof out === "object"
        ? (out as Record<string, unknown>)
        : {};
    };

    const mOut = await stageOutputs("metadata");

    // Script text: script_gen first, then the self-contained narration engines.
    let script: string | null = null;
    for (const block of ["script_gen", "whiteboard_scribe", "motion_comic"]) {
      const out = await stageOutputs(block);
      if (typeof out.narrationText === "string" && out.narrationText.trim()) {
        script = out.narrationText;
        break;
      }
    }

    const assets = await ctx.db
      .query("assets")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    const videoAsset = assets.find((a) => a.kind === "video");
    const thumbAsset = assets.find((a) => a.kind === "thumbnail");
    const vMeta = (videoAsset?.meta ?? {}) as Record<string, unknown>;
    const tMeta = (thumbAsset?.meta ?? {}) as Record<string, unknown>;

    const channel = await ctx.db.get(run.channelId);
    const title =
      (typeof mOut.title === "string" && mOut.title) ||
      (typeof vMeta.title === "string" && vMeta.title) ||
      (typeof tMeta.thumbnailTitle === "string" && tMeta.thumbnailTitle) ||
      (channel?.name ?? "Untitled video");

    return {
      title: title as string,
      description:
        typeof mOut.description === "string" ? mOut.description : null,
      tags: Array.isArray(mOut.tags)
        ? (mOut.tags.filter((t) => typeof t === "string") as string[])
        : [],
      script,
      thumbnailKey: thumbAsset?.r2Key ?? null,
      videoKey: videoAsset?.r2Key ?? null,
      estimatedViews:
        typeof mOut.estimatedViews === "number"
          ? (mOut.estimatedViews as number)
          : null,
      estimatedViewsSource:
        typeof mOut.estimatedViewsSource === "string"
          ? (mOut.estimatedViewsSource as string)
          : null,
      pinnedComment:
        typeof mOut.pinnedComment === "string" ? mOut.pinnedComment : null,
      titleAlternate:
        typeof mOut.titleAlternate === "string" ? mOut.titleAlternate : null,
    };
  },
});
