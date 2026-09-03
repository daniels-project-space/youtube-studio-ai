/**
 * THUMBNAIL PERFORMANCE PULL.
 *
 * Phase two of the CTR loop. `intelligenceBlocks` records the craft decisions a
 * thumbnail made at render time; this attaches what those decisions actually
 * did once YouTube has enough data, and reports whether the evidence yet
 * supports saying anything at all.
 *
 * DELIBERATELY SEPARATE FROM `learn.ts`. That task pulls the same Analytics API
 * behind a lease-fenced quota boundary with Convex-recorded dispatch
 * capabilities, because its GETs are expensive and must never be replayed
 * ambiguously. Threading a second, unrelated concern through that fence would
 * put thumbnail bookkeeping inside a correctness boundary built for something
 * else — and a bug here would then look like a retention-learning bug. This
 * runs on its own schedule, reads its own store, and cannot corrupt that path.
 *
 * It is also entirely advisory. Nothing here gates a render; the worst outcome
 * of this task failing completely is that the CTR advisory stays empty, which
 * is already its normal state until a channel has real volume.
 */
import { schedules } from "@trigger.dev/sdk";

import { fetchVideoAnalytics, getAnalyticsAccessToken } from "@/lib/youtubeAnalytics";
import { analyseThumbnailCtr } from "@/lib/thumbnailCtrFeedback";
import {
  attachPerformanceMetrics,
  loadPerformanceSamples,
} from "@/lib/thumbnailLearningStore";

/** YouTube needs time before thumbnail impressions mean anything. */
const MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ThumbnailPerformanceInput {
  keyPrefix: string;
  channelName: string;
  refreshToken: string;
  /** Published videos for this channel, joined run -> youtubeVideoId upstream. */
  videos: readonly { videoKey: string; youtubeVideoId: string; publishedAt: number }[];
  now?: number;
}

function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Pull metrics for one channel and report what, if anything, they support.
 *
 * Exported separately from the schedule so it can be run against a single
 * channel by hand and unit-tested without the Trigger runtime.
 */
export async function pullThumbnailPerformance(args: ThumbnailPerformanceInput): Promise<{
  attached: number;
  skipped: number;
  conclusive: boolean;
  advisory: string;
  limitation?: string;
}> {
  const now = args.now ?? Date.now();
  let attached = 0;
  let skipped = 0;

  const accessToken = await getAnalyticsAccessToken(args.refreshToken);
  if (!accessToken) {
    return { attached: 0, skipped: args.videos.length, conclusive: false, advisory: "", limitation: "no analytics access token" };
  }

  for (const video of args.videos) {
    // A thumbnail measured too early reports a number that will move a lot,
    // and an early number stored as evidence is worse than no evidence.
    if (now - video.publishedAt < MIN_AGE_MS) {
      skipped++;
      continue;
    }
    let analytics: Awaited<ReturnType<typeof fetchVideoAnalytics>> = null;
    try {
      analytics = await fetchVideoAnalytics({
        videoId: video.youtubeVideoId,
        startDate: ymd(video.publishedAt),
        endDate: ymd(now),
        refreshToken: args.refreshToken,
        accessToken,
        timeoutMs: 30_000,
      });
    } catch {
      skipped++;
      continue;
    }
    if (!analytics) {
      skipped++;
      continue;
    }
    const result = await attachPerformanceMetrics({
      keyPrefix: args.keyPrefix,
      channelName: args.channelName,
      videoKey: video.videoKey,
      analytics,
    });
    if (result.attached) attached++;
    else skipped++;
  }

  const samples = await loadPerformanceSamples({
    keyPrefix: args.keyPrefix,
    channelName: args.channelName,
  });
  // Zero-impression rows are traits-only placeholders awaiting metrics.
  const report = analyseThumbnailCtr({ samples: samples.filter((sample) => sample.impressions > 0) });
  return {
    attached,
    skipped,
    conclusive: report.conclusive,
    advisory: report.advisory,
    ...(report.limitation ? { limitation: report.limitation } : {}),
  };
}

/**
 * Weekly, because the input changes on the timescale of publishing, not hours.
 * Polling harder would not produce evidence any faster — it would only re-read
 * the same videos and burn Analytics quota that `learn.ts` needs.
 */
export const thumbnailPerformanceSchedule = schedules.task({
  id: "thumbnail-performance-pull",
  cron: "0 4 * * 1",
  run: async () => {
    // The channel roster and its run -> youtubeVideoId join live in Convex and
    // are supplied by the caller in production; this schedule is the seam that
    // owns the cadence, not the roster.
    return {
      ok: true,
      note:
        "cadence owner only — invoke pullThumbnailPerformance per channel with its " +
        "refresh token and published-video join",
    };
  },
});
