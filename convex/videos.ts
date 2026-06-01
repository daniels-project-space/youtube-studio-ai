import { query } from "./_generated/server";
import { v } from "convex/values";

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
 *   - title                       (best-effort from asset/run meta)
 *   - thumbnailTitle / visualRationale  (claude_flux thumbnail intelligence,
 *                                  surfaced in the lightbox detail)
 *   - estimatedViews / estimatedViewsSource  (when present on the run)
 *   - durationSec                 (when present on an asset/run meta)
 *   - createdAt / status
 *
 * Newest first. Optional server-side filters keep the common case cheap; the
 * client layers richer filtering/sorting on top.
 */
export const listVideos = query({
  args: {
    ownerId: v.string(),
    channelId: v.optional(v.id("channels")),
    status: v.optional(v.string()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();

    // Channel-name cache so we join each channel at most once.
    const channelCache = new Map<
      string,
      { name: string; slug: string } | null
    >();
    const getChannel = async (channelId: string) => {
      if (channelCache.has(channelId)) return channelCache.get(channelId)!;
      const ch = await ctx.db.get(channelId as typeof runs[number]["channelId"]);
      const val = ch ? { name: ch.name, slug: ch.slug } : null;
      channelCache.set(channelId, val);
      return val;
    };

    const rows: Array<Record<string, unknown>> = [];

    for (const run of runs) {
      // Server-side channel filter (cheap, before the asset fan-out).
      if (args.channelId && run.channelId !== args.channelId) continue;
      // Server-side status filter.
      if (args.status && run.status !== args.status) continue;

      // Pull this run's assets once; pick out thumbnail + video.
      const assets = await ctx.db
        .query("assets")
        .withIndex("by_run", (q) => q.eq("runId", run._id))
        .collect();

      const videoAsset = assets.find((a) => a.kind === "video");
      const thumbAsset = assets.find((a) => a.kind === "thumbnail");

      // Finished = published (youtubeVideoId) OR has a rendered video asset.
      const isFinished = Boolean(run.youtubeVideoId) || Boolean(videoAsset);
      if (!isFinished) continue;

      const channel = await getChannel(run.channelId);

      // Best-effort title: video asset meta → thumbnail meta → channel name.
      const vMeta = (videoAsset?.meta ?? {}) as Record<string, unknown>;
      const tMeta = (thumbAsset?.meta ?? {}) as Record<string, unknown>;
      const title =
        (typeof vMeta.title === "string" && vMeta.title) ||
        (typeof tMeta.thumbnailTitle === "string" && tMeta.thumbnailTitle) ||
        (typeof tMeta.title === "string" && tMeta.title) ||
        (channel?.name ?? "Untitled video");

      // Optional duration from either asset's meta.
      const durationSec =
        typeof vMeta.durationSec === "number"
          ? (vMeta.durationSec as number)
          : typeof vMeta.duration === "number"
            ? (vMeta.duration as number)
            : undefined;

      // Estimated views live on the run (loose-typed; analytics owns the
      // schema). Read defensively so absence is fine.
      const runAny = run as unknown as Record<string, unknown>;
      const estimatedViews =
        typeof runAny.estimatedViews === "number"
          ? (runAny.estimatedViews as number)
          : undefined;
      const estimatedViewsSource =
        typeof runAny.estimatedViewsSource === "string"
          ? (runAny.estimatedViewsSource as string)
          : undefined;

      rows.push({
        _id: run._id,
        status: run.status,
        createdAt: run.startedAt ?? run._creationTime,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        youtubeVideoId: run.youtubeVideoId,
        channelId: run.channelId,
        channelName: channel?.name ?? "(unknown)",
        channelSlug: channel?.slug ?? "",
        title: title as string,
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

    // Optional title search (case-insensitive substring).
    let filtered = rows;
    if (args.search && args.search.trim()) {
      const needle = args.search.trim().toLowerCase();
      filtered = rows.filter((r) =>
        String(r.title ?? "")
          .toLowerCase()
          .includes(needle),
      );
    }

    // Newest first.
    filtered.sort(
      (a, b) => (b.createdAt as number) - (a.createdAt as number),
    );

    return typeof args.limit === "number"
      ? filtered.slice(0, args.limit)
      : filtered;
  },
});
