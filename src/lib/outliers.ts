/**
 * Outlier detection (self-hosted, free) — finds videos massively OVERperforming
 * relative to their channel's size in a niche. This is the strongest "what's hot
 * right now" signal for topic selection (the paid tools — vidIQ Outliers, 1of10,
 * OutlierKit — sell exactly this). We compute it from the YouTube Data API we
 * already have access to (API key OR OAuth readonly), so it costs nothing extra.
 *
 * Outlier score = recent video views ÷ the channel's subscriber base. A small
 * channel pulling huge views = a breakout topic/angle worth riding.
 */
import {
  hasYouTubeDataAccess,
  searchVideoIds,
  fetchVideoDetails,
  fetchChannelStats,
} from "@/lib/youtubeData";

export interface OutlierVideo {
  title: string;
  channelTitle: string;
  views: number;
  subs: number;
  /** views ÷ max(subs, floor) — how hard it punches above the channel's weight. */
  score: number;
  videoId: string;
  publishedAt: string;
  durationSec: number;
}

const DAY = 86_400_000;

/**
 * Fetch the top breakout videos for a niche query. Best-effort: returns [] with no
 * Data access, empty query, or any API error (never throws). Recent window only
 * (default 120 days) so it reflects current demand, not all-time evergreen.
 */
export async function fetchNicheOutliers(
  query: string,
  opts: {
    maxResults?: number;
    /** Filter out anything shorter than this (e.g. 120 to skip Shorts for long-form niches). */
    minDurationSec?: number;
    /** Lookback window in days (default 120). */
    windowDays?: number;
    /** Subscriber floor so tiny/zero-sub channels don't produce infinite scores. */
    subsFloor?: number;
    log?: (m: string) => void;
  } = {},
): Promise<OutlierVideo[]> {
  const log = opts.log ?? (() => {});
  if (!hasYouTubeDataAccess() || !query.trim()) return [];
  try {
    const publishedAfter = new Date(Date.now() - (opts.windowDays ?? 120) * DAY).toISOString();
    const ids = await searchVideoIds({ query, maxResults: opts.maxResults ?? 25, publishedAfter });
    if (ids.length === 0) return [];
    const details = await fetchVideoDetails(ids);
    const stats = await fetchChannelStats(details.map((d) => d.channelId));
    const subsByChannel = new Map(stats.map((s) => [s.channelId, s.subscriberCount]));
    const floor = opts.subsFloor ?? 1000;
    const minDur = opts.minDurationSec ?? 0;
    const scored = details
      .filter((d) => d.views > 0 && d.durationSec >= minDur)
      .map((d) => {
        const subs = subsByChannel.get(d.channelId) ?? 0;
        return {
          title: d.title,
          channelTitle: d.channelTitle,
          views: d.views,
          subs,
          score: d.views / Math.max(subs, floor),
          videoId: d.youtubeVideoId,
          publishedAt: d.publishedAt,
          durationSec: d.durationSec,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
    log(`outliers: ${scored.length} for "${query}"${scored[0] ? ` (top ${scored[0].score.toFixed(0)}x)` : ""}`);
    return scored;
  } catch (e) {
    log(`outliers failed (${e instanceof Error ? e.message : e})`);
    return [];
  }
}
