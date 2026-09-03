/**
 * YouTube Analytics API (OAuth) — the deep per-video signals the learning loop
 * needs: audience retention (averageViewPercentage) + watch time + (when
 * available) thumbnail CTR. Requires the yt-analytics.readonly scope (see
 * scripts/youtube-oauth.ts). Degrades to null without it (403). Evaluate on a
 * ≥72h lag — metrics aren't final for ~3 days.
 */
const BASE = "https://youtubeanalytics.googleapis.com/v2/reports";

export function hasAnalyticsAccess(refreshToken?: string): boolean {
  return Boolean(refreshToken && process.env.YOUTUBE_CLIENT_ID);
}

export interface VideoAnalytics {
  videoId: string;
  views: number;
  /** Raw Analytics engagedViews; never a derived viewed-vs-swiped proxy. */
  engagedViews?: number;
  avgViewPct: number; // 0..100 audience retention
  avgViewDurationSec: number;
  estMinutesWatched: number;
  ctr?: number; // thumbnail impressions CTR (0..100), if the metric is available
  /**
   * Raw thumbnail impressions. A CTR RATE alone cannot support a significance
   * test — 12% on 50 impressions and 12% on 50,000 are the same number and
   * completely different evidence — so the denominator is pulled alongside it.
   */
  thumbnailImpressions?: number;
}

async function query(
  accessToken: string,
  params: Record<string, string>,
  timeoutMs?: number,
  beforeRequest?: () => void,
): Promise<{ headers: string[]; row: number[] } | null> {
  const url = `${BASE}?${new URLSearchParams({ ids: "channel==MINE", ...params }).toString()}`;
  const controller = timeoutMs === undefined ? undefined : new AbortController();
  const timeout = controller === undefined
    ? undefined
    : setTimeout(() => controller.abort(), timeoutMs);
  try {
    // This is intentionally adjacent to `fetch`: callers with a durable
    // dispatch capability can reject an event-loop pause before it spends a
    // second Analytics request.
    beforeRequest?.();
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!res.ok) return null; // 403 (no scope) / 400 → degrade
    const j = (await res.json()) as { columnHeaders?: { name: string }[]; rows?: number[][] };
    const headers = (j.columnHeaders ?? []).map((h) => h.name);
    const row = j.rows?.[0];
    if (!row) return null;
    return { headers, row };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/** Resolve OAuth before the lease-fenced Analytics request boundary. */
export async function getAnalyticsAccessToken(refreshToken: string): Promise<string | null> {
  if (!hasAnalyticsAccess(refreshToken)) return null;
  const { getAccessToken } = await import("@/lib/youtube");
  try {
    return await getAccessToken(refreshToken);
  } catch {
    return null;
  }
}

export interface RetentionPoint {
  /** 0..1 position in the video (elapsedVideoTimeRatio). */
  ratio: number;
  /** audienceWatchRatio — fraction of views still watching at this point. */
  watch: number;
  /** relativeRetentionPerformance vs similar-length videos (0..1), if returned. */
  relative?: number;
}

/**
 * The SECOND-BY-SECOND retention curve (audienceWatchRatio per
 * elapsedVideoTimeRatio) — the ground truth the learning loop joins against
 * the run's known timeline (opening device, cards, inserts, chapters).
 */
export async function fetchRetentionCurve(args: {
  videoId: string;
  startDate: string;
  endDate: string;
  refreshToken: string;
}): Promise<RetentionPoint[] | null> {
  const accessToken = await getAnalyticsAccessToken(args.refreshToken);
  if (!accessToken) return null;
  const url = `${BASE}?${new URLSearchParams({
    ids: "channel==MINE",
    startDate: args.startDate,
    endDate: args.endDate,
    metrics: "audienceWatchRatio,relativeRetentionPerformance",
    dimensions: "elapsedVideoTimeRatio",
    filters: `video==${args.videoId};audienceType==ORGANIC`,
  }).toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const j = (await res.json()) as { columnHeaders?: { name: string }[]; rows?: number[][] };
  const headers = (j.columnHeaders ?? []).map((h) => h.name);
  const ri = headers.indexOf("elapsedVideoTimeRatio");
  const wi = headers.indexOf("audienceWatchRatio");
  const pi = headers.indexOf("relativeRetentionPerformance");
  const rows = j.rows ?? [];
  if (ri < 0 || wi < 0 || rows.length === 0) return null;
  return rows
    .map((r) => ({
      ratio: Number(r[ri]) || 0,
      watch: Number(r[wi]) || 0,
      ...(pi >= 0 ? { relative: Number(r[pi]) || 0 } : {}),
    }))
    .sort((a, b) => a.ratio - b.ratio);
}

/** Fetch retention/watch metrics for one video over [startDate, endDate] (YYYY-MM-DD). */
export async function fetchVideoAnalytics(args: {
  videoId: string;
  startDate: string;
  endDate: string;
  refreshToken: string;
  /** Pre-resolved immediately before the lease-fenced GET boundary. */
  accessToken?: string;
  /** Bounded per-GET timeout; callers with a lease must keep it below that lease. */
  timeoutMs?: number;
  /** Add raw engagedViews to the existing fenced core Analytics GET. */
  includeEngagedViews?: boolean;
  /** Synchronous final fence, run directly before every outbound Analytics GET. */
  beforeRequest?: () => void;
}): Promise<VideoAnalytics | null> {
  const accessToken = args.accessToken ?? await getAnalyticsAccessToken(args.refreshToken);
  if (!accessToken) return null;
  const core = await query(accessToken, {
    startDate: args.startDate,
    endDate: args.endDate,
    metrics: args.includeEngagedViews
      ? "views,engagedViews,averageViewPercentage,averageViewDuration,estimatedMinutesWatched"
      : "views,averageViewPercentage,averageViewDuration,estimatedMinutesWatched",
    filters: `video==${args.videoId}`,
  }, args.timeoutMs, args.beforeRequest);
  if (!core) return null;
  const get = (name: string) => {
    const i = core.headers.indexOf(name);
    return i >= 0 ? Number(core.row[i]) || 0 : 0;
  };
  const getOptionalFinite = (name: string): number | undefined => {
    const i = core.headers.indexOf(name);
    if (i < 0) return undefined;
    const value = Number(core.row[i]);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  };
  const engagedViews = args.includeEngagedViews
    ? getOptionalFinite("engagedViews")
    : undefined;
  // A v2 batch must not persist a missing/invalid provider metric as zero.
  if (args.includeEngagedViews && engagedViews === undefined) return null;
  const out: VideoAnalytics = {
    videoId: args.videoId,
    views: get("views"),
    ...(engagedViews === undefined ? {} : { engagedViews }),
    avgViewPct: get("averageViewPercentage"),
    avgViewDurationSec: get("averageViewDuration"),
    estMinutesWatched: get("estimatedMinutesWatched"),
  };
  // Thumbnail CTR (Jan-2026 metric; not always available) — best-effort. Both
  // the rate and its denominator are requested in one call so downstream
  // analysis can weight a channel's evidence by volume instead of treating
  // every video's percentage as equally trustworthy.
  const ctrRes = await query(accessToken, {
    startDate: args.startDate,
    endDate: args.endDate,
    metrics: "videoThumbnailImpressionsClickRate,videoThumbnailImpressions",
    filters: `video==${args.videoId}`,
  }, args.timeoutMs, args.beforeRequest);
  if (ctrRes) {
    const rateIndex = ctrRes.headers.indexOf("videoThumbnailImpressionsClickRate");
    if (rateIndex >= 0) out.ctr = Number(ctrRes.row[rateIndex]) || 0;
    const impressionsIndex = ctrRes.headers.indexOf("videoThumbnailImpressions");
    if (impressionsIndex >= 0) {
      const impressions = Number(ctrRes.row[impressionsIndex]);
      if (Number.isFinite(impressions) && impressions >= 0) out.thumbnailImpressions = impressions;
    }
  }
  return out;
}
