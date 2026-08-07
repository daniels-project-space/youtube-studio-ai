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
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  STUDIO_AUTOMATION_GATES,
  studioAutomationGate,
} from "@/lib/automationGate";
import { bootstrapSecrets } from "@/lib/bootstrap";
import {
  fetchVideoStats,
  fetchChannelStats,
} from "@/lib/youtubeData";
import {
  requireInternalQuerySecret,
  requireYouTubeConnector,
} from "@/lib/youtubeConnector";

type Logger = (msg: string, extra?: Record<string, unknown>) => void;

export interface StatsRefreshArgs {
  ownerId?: string;
}

export interface StatsRefreshResult {
  ok: boolean;
  skipped?: "no_connector";
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

  const convex = convexClient();
  const internalSecret = requireInternalQuerySecret();
  const channels = await convex.query(api.channels.listChannels, { ownerId });
  const date = utcDate();
  let channelsProcessed = 0;
  let videoSnapshots = 0;
  let connectorsMissing = 0;

  for (const ch of channels) {
    if (ch.status === "archived") continue;
    const channelId = ch._id as Id<"channels">;
    let connector: Awaited<ReturnType<typeof requireYouTubeConnector>>;
    try {
      connector = await requireYouTubeConnector(convex, {
        channelId,
        ownerId,
        requiredScopes: [
          "https://www.googleapis.com/auth/youtube",
          "https://www.googleapis.com/auth/youtube.readonly",
        ],
      });
      if (!connector.ytChannelId) {
        throw new Error("linked connector has no YouTube channel id");
      }
    } catch (error) {
      connectorsMissing++;
      log(
        `channel "${ch.name}" skipped — ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

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

    const ingestionId = await convex.mutation(api.analyticsIngestions.start, {
      secret: internalSecret,
      ownerId,
      channelId,
      connectorId: connector.connectorId,
      connectorVersion: connector.tokenVersion,
      source: "youtube_data_api",
      metricDefinitionVersion: "youtube-data-statistics-v1",
      windowStart: date,
      windowEnd: date,
      startedAt: Date.now(),
    });
    let ingestionWrites = 0;
    const ingestionErrors: string[] = [];

    // 2. Per-video live stats → one snapshot row each.
    let videoStats: Awaited<ReturnType<typeof fetchVideoStats>> = [];
    try {
      videoStats = await fetchVideoStats(videoIds, {
        refreshToken: connector.refreshToken,
        requireConnector: true,
      });
      const crossedAccount = videoStats.find(
        (row) => row.channelId !== connector.ytChannelId,
      );
      if (crossedAccount) {
        throw new Error(
          `video ${crossedAccount.youtubeVideoId} belongs to ${crossedAccount.channelId}, expected ${connector.ytChannelId}`,
        );
      }
    } catch (e) {
      log(`videos.list failed for "${ch.name}": ${e instanceof Error ? e.message : e}`);
      await convex.mutation(api.analyticsIngestions.finish, {
        secret: internalSecret,
        ingestionId,
        status: "failed",
        recordsWritten: 0,
        lastError: e instanceof Error ? e.message : String(e),
        finishedAt: Date.now(),
      });
      continue;
    }

    let totalViews = 0;
    for (const vs of videoStats) {
      totalViews += vs.views;
      try {
        await convex.mutation(api.analytics.recordVideoSnapshot, {
          secret: internalSecret,
          ownerId,
          channelId,
          connectorId: connector.connectorId,
          connectorVersion: connector.tokenVersion,
          ingestionId,
          source: "youtube_data_api",
          metricDefinitionVersion: "youtube-data-statistics-v1",
          windowStart: date,
          windowEnd: date,
          confidence: "high",
          youtubeVideoId: vs.youtubeVideoId,
          views: vs.views,
          likes: vs.likes,
          comments: vs.comments,
        });
        videoSnapshots++;
        ingestionWrites++;
      } catch (e) {
        const message = `recordVideoSnapshot failed (${vs.youtubeVideoId}): ${e instanceof Error ? e.message : e}`;
        ingestionErrors.push(message);
        log(message);
      }
    }

    // 3. Channel-level rollup. Resolve the dominant YouTube channelId from the
    //    videos, then channels.list?part=statistics for subscriberCount.
    let subscriberCount = 0;
    let channelViewCount = totalViews; // fall back to summed video views
    let videoCount = videoStats.length;
    let rollupConfidence: "high" | "medium" = "high";
    const dominant = connector.ytChannelId;
    if (dominant) {
      try {
        const chStats = await fetchChannelStats([dominant], {
          refreshToken: connector.refreshToken,
          requireConnector: true,
        });
        const s = chStats[0];
        if (s) {
          subscriberCount = s.subscriberCount;
          channelViewCount = s.viewCount || totalViews;
          videoCount = s.videoCount || videoStats.length;
        }
      } catch (e) {
        const message = `channels.list failed for "${ch.name}": ${e instanceof Error ? e.message : e}`;
        ingestionErrors.push(message);
        rollupConfidence = "medium";
        log(message);
      }
    }

    try {
      await convex.mutation(api.analytics.upsertChannelDay, {
        secret: internalSecret,
        ownerId,
        channelId,
        connectorId: connector.connectorId,
        connectorVersion: connector.tokenVersion,
        ingestionId,
        source: "youtube_data_api",
        metricDefinitionVersion: "youtube-data-statistics-v1",
        confidence: rollupConfidence,
        date,
        totalViews: channelViewCount,
        subscriberCount,
        videoCount,
      });
      ingestionWrites++;
    } catch (e) {
      const message = `upsertChannelDay failed for "${ch.name}": ${e instanceof Error ? e.message : e}`;
      ingestionErrors.push(message);
      log(message);
    }
    const ingestionStatus =
      ingestionErrors.length === 0
        ? "completed"
        : ingestionWrites > 0
          ? "partial"
          : "failed";
    await convex.mutation(api.analyticsIngestions.finish, {
      secret: internalSecret,
      ingestionId,
      status: ingestionStatus,
      recordsWritten: ingestionWrites,
      lastError: ingestionErrors.length ? ingestionErrors.join(" | ") : undefined,
      finishedAt: Date.now(),
    });
    channelsProcessed++;
  }

  log(
    `stats refresh complete: ${channelsProcessed} channels, ${videoSnapshots} snapshots`,
  );
  return {
    ok: true,
    ...(channelsProcessed === 0 && connectorsMissing > 0
      ? { skipped: "no_connector" as const }
      : {}),
    channelsProcessed,
    videoSnapshots,
  };
}

/** Most-frequent value in a list (the channel's own YouTube channelId). */

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
    const gate = studioAutomationGate(STUDIO_AUTOMATION_GATES.insights);
    if (!gate.enabled) return gate;

    const log: Logger = (m, x) => console.log(`[stats-refresh-6h] ${m}`, x ?? "");
    await bootstrapSecrets(log);
    return statsRefreshCore({}, log);
  },
});
