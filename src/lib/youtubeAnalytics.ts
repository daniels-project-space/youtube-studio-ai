/**
 * YouTube Analytics API (OAuth) — the deep per-video signals the learning loop
 * needs: audience retention (averageViewPercentage) + watch time + (when
 * available) thumbnail CTR. Requires the yt-analytics.readonly scope (see
 * scripts/youtube-oauth.ts). Degrades to null without it (403). Evaluate on a
 * ≥72h lag — metrics aren't final for ~3 days.
 */
const BASE = "https://youtubeanalytics.googleapis.com/v2/reports";

export function hasAnalyticsAccess(): boolean {
  return Boolean(process.env.YOUTUBE_REFRESH_TOKEN && process.env.YOUTUBE_CLIENT_ID);
}

export interface VideoAnalytics {
  videoId: string;
  views: number;
  avgViewPct: number; // 0..100 audience retention
  avgViewDurationSec: number;
  estMinutesWatched: number;
  ctr?: number; // thumbnail impressions CTR (0..100), if the metric is available
}

async function query(
  accessToken: string,
  params: Record<string, string>,
): Promise<{ headers: string[]; row: number[] } | null> {
  const url = `${BASE}?${new URLSearchParams({ ids: "channel==MINE", ...params }).toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null; // 403 (no scope) / 400 → degrade
  const j = (await res.json()) as { columnHeaders?: { name: string }[]; rows?: number[][] };
  const headers = (j.columnHeaders ?? []).map((h) => h.name);
  const row = j.rows?.[0];
  if (!row) return null;
  return { headers, row };
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
}): Promise<RetentionPoint[] | null> {
  if (!hasAnalyticsAccess()) return null;
  const { getAccessToken } = await import("@/lib/youtube");
  let accessToken: string;
  try { accessToken = await getAccessToken(); } catch { return null; }
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
}): Promise<VideoAnalytics | null> {
  if (!hasAnalyticsAccess()) return null;
  const { getAccessToken } = await import("@/lib/youtube");
  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch {
    return null;
  }
  const core = await query(accessToken, {
    startDate: args.startDate,
    endDate: args.endDate,
    metrics: "views,averageViewPercentage,averageViewDuration,estimatedMinutesWatched",
    filters: `video==${args.videoId}`,
  });
  if (!core) return null;
  const get = (name: string) => {
    const i = core.headers.indexOf(name);
    return i >= 0 ? Number(core.row[i]) || 0 : 0;
  };
  const out: VideoAnalytics = {
    videoId: args.videoId,
    views: get("views"),
    avgViewPct: get("averageViewPercentage"),
    avgViewDurationSec: get("averageViewDuration"),
    estMinutesWatched: get("estimatedMinutesWatched"),
  };
  // Thumbnail CTR (Jan-2026 metric; not always available) — best-effort.
  const ctrRes = await query(accessToken, {
    startDate: args.startDate,
    endDate: args.endDate,
    metrics: "videoThumbnailImpressionsClickRate",
    filters: `video==${args.videoId}`,
  });
  if (ctrRes) {
    const i = ctrRes.headers.indexOf("videoThumbnailImpressionsClickRate");
    if (i >= 0) out.ctr = Number(ctrRes.row[i]) || 0;
  }
  return out;
}
