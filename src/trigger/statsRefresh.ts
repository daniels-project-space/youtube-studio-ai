/**
 * `stats-refresh` Trigger tasks (Tranche 5 — analytics ingest).
 *
 *   statsRefreshTask     — callable; args {ownerId?} (defaults to the operator).
 *   statsRefreshSchedule — every 6h; refreshes every owner channel's stats.
 *
 * For each channel:
 *   1. collect the channel's uploaded youtubeVideoIds (from its runs),
 *   2. videos.list?part=snippet,statistics → recordVideoSnapshot per video
 *      (live views/likes/comments) + the owning YouTube channelId,
 *   3. channels.list?part=statistics for the resolved YouTube channelId →
 *      upsertChannelDay (daily rollup with a computed subscriberDelta).
 *
 * SOURCE: YouTube Data API v3 ONLY. KEY-GUARDED — if YOUTUBE_DATA_API_KEY is
 * absent the task logs + skips (no crash). This populates `channelAnalytics`,
 * the table v1 left empty (so all the growth charts were blank).
 */
import { task, schedules } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import {
  hasYouTubeDataAccess,
  fetchVideoStats,
  fetchChannelStats,
} from "@/lib/youtubeData";

type Logger = (msg: string, extra?: Record<string, unknown>) => void;

export interface StatsRefreshArgs {
  ownerId?: string;
}

export interface StatsRefreshResult {
  ok: boolean;
  skipped?: "no_youtube_key";
  channelsProcessed: number;
  videoSnapshots: number;
}

function convexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

/** UTC YYYY-MM-DD for the daily channelAnalytics key. */
function utcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Core refresh — pure (no task() side effects), so the callable task and the
 * schedule share one implementation. Key-guarded: returns a skip result if the
 * YouTube Data API key is missing rather than throwing.
 */
export async function statsRefreshCore(
  args: StatsRefreshArgs,
  log: Logger = () => {},
): Promise<StatsRefreshResult> {
  const ownerId =
    args.ownerId ?? process.env.NEXT_PUBLIC_OWNER_ID ?? "owner_daniel";

  if (!hasYouTubeDataAccess()) {
    log("no YouTube Data access (API key or OAuth) — skipping stats refresh gracefully");
    return {
      ok: true,
      skipped: "no_youtube_key",
      channelsProcessed: 0,
      videoSnapshots: 0,
    };
  }

  const convex = convexClient();
  const channels = await convex.query(api.channels.listChannels, { ownerId });
  const date = utcDate();
  let channelsProcessed = 0;
  let videoSnapshots = 0;

  for (const ch of channels) {
    if (ch.status === "archived") continue;
    const channelId = ch._id as Id<"channels">;

    // 1. Uploaded video ids for this channel (from its completed runs).
    let videoIds: string[] = [];
    try {
      const runs = await convex.query(api.runs.listRunsByChannel, { channelId });
      videoIds = [
        ...new Set(
          runs
            .map((r) => r.youtubeVideoId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
    } catch (e) {
      log(`runs lookup failed for "${ch.name}": ${e instanceof Error ? e.message : e}`);
    }

    if (videoIds.length === 0) {
      log(`channel "${ch.name}" has no uploaded videos yet — skipping`);
      continue;
    }

    // 2. Per-video live stats → one snapshot row each.
    let videoStats: Awaited<ReturnType<typeof fetchVideoStats>> = [];
    try {
      videoStats = await fetchVideoStats(videoIds);
    } catch (e) {
      log(`videos.list failed for "${ch.name}": ${e instanceof Error ? e.message : e}`);
      continue;
    }

    let totalViews = 0;
    const ytChannelIds: string[] = [];
    for (const vs of videoStats) {
      totalViews += vs.views;
      if (vs.channelId) ytChannelIds.push(vs.channelId);
      try {
        await convex.mutation(api.analytics.recordVideoSnapshot, {
          ownerId,
          channelId,
          youtubeVideoId: vs.youtubeVideoId,
          views: vs.views,
          likes: vs.likes,
          comments: vs.comments,
        });
        videoSnapshots++;
      } catch (e) {
        log(`recordVideoSnapshot failed (${vs.youtubeVideoId}): ${e instanceof Error ? e.message : e}`);
      }
    }

    // 3. Channel-level rollup. Resolve the dominant YouTube channelId from the
    //    videos, then channels.list?part=statistics for subscriberCount.
    let subscriberCount = 0;
    let channelViewCount = totalViews; // fall back to summed video views
    let videoCount = videoStats.length;
    const dominant = mode(ytChannelIds);
    if (dominant) {
      try {
        const chStats = await fetchChannelStats([dominant]);
        const s = chStats[0];
        if (s) {
          subscriberCount = s.subscriberCount;
          channelViewCount = s.viewCount || totalViews;
          videoCount = s.videoCount || videoStats.length;
        }
      } catch (e) {
        log(`channels.list failed for "${ch.name}": ${e instanceof Error ? e.message : e}`);
      }
    }

    try {
      await convex.mutation(api.analytics.upsertChannelDay, {
        ownerId,
        channelId,
        date,
        totalViews: channelViewCount,
        subscriberCount,
        videoCount,
      });
    } catch (e) {
      log(`upsertChannelDay failed for "${ch.name}": ${e instanceof Error ? e.message : e}`);
    }
    channelsProcessed++;
  }

  log(
    `stats refresh complete: ${channelsProcessed} channels, ${videoSnapshots} snapshots`,
  );
  return { ok: true, channelsProcessed, videoSnapshots };
}

/** Most-frequent value in a list (the channel's own YouTube channelId). */
function mode(values: string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [val, n] of counts) {
    if (n > bestN) {
      best = val;
      bestN = n;
    }
  }
  return best;
}

/** Callable task — invoke manually or from another task. */
export const statsRefreshTask = task({
  id: "stats-refresh",
  maxDuration: 900,
  run: async (payload: StatsRefreshArgs) => {
    await bootstrapSecrets((m, x) =>
      console.log(`[stats-refresh] ${m}`, x ?? ""),
    );
    return statsRefreshCore(payload ?? {}, (m, x) =>
      console.log(`[stats-refresh] ${m}`, x ?? ""),
    );
  },
});

/** Scheduled refresh every 6 hours for the operator's channels. */
export const statsRefreshSchedule = schedules.task({
  id: "stats-refresh-6h",
  cron: "0 */6 * * *", // every 6 hours
  maxDuration: 1800,
  run: async () => {
    const log: Logger = (m, x) => console.log(`[stats-refresh-6h] ${m}`, x ?? "");
    await bootstrapSecrets(log);
    return statsRefreshCore({}, log);
  },
});
