/**
 * YouTube Data API v3 client (read-only, for competitor research).
 *
 * Distinct from src/lib/youtube.ts (OAuth upload). This uses a simple API key
 * (YOUTUBE_DATA_API_KEY) for public read endpoints: search.list + videos.list.
 *
 * If the key is absent, `hasYouTubeDataKey()` is false and callers degrade —
 * functions throw loud only when actually invoked, so build never crashes.
 */

const BASE = "https://www.googleapis.com/youtube/v3";

export class YouTubeDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YouTubeDataError";
  }
}

export function hasYouTubeDataKey(): boolean {
  return Boolean(process.env.YOUTUBE_DATA_API_KEY);
}

function key(): string {
  const k = process.env.YOUTUBE_DATA_API_KEY;
  if (!k) throw new YouTubeDataError("YOUTUBE_DATA_API_KEY is not configured");
  return k;
}

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams({ ...params, key: key() }).toString();
  const res = await fetch(`${BASE}/${path}?${qs}`);
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new YouTubeDataError(
      `youtube/${path} -> HTTP ${res.status}: ${json.error?.message ?? ""}`,
    );
  }
  return json as T;
}

interface SearchResponse {
  items?: { id?: { videoId?: string } }[];
}

/** search.list ordered by viewCount → returns up to `maxResults` video ids. */
export async function searchVideoIds(args: {
  query: string;
  maxResults?: number;
  publishedAfter?: string; // RFC3339, e.g. 2024-01-01T00:00:00Z
  relevanceLanguage?: string;
}): Promise<string[]> {
  const json = await get<SearchResponse>("search", {
    part: "id",
    q: args.query,
    type: "video",
    order: "viewCount",
    maxResults: String(args.maxResults ?? 25),
    relevanceLanguage: args.relevanceLanguage ?? "en",
    ...(args.publishedAfter ? { publishedAfter: args.publishedAfter } : {}),
  });
  return (json.items ?? [])
    .map((i) => i.id?.videoId)
    .filter((id): id is string => Boolean(id));
}

export interface VideoDetail {
  youtubeVideoId: string;
  title: string;
  channelTitle: string;
  views: number;
  likes: number;
  comments: number;
  tags: string[];
  thumbnailUrl: string;
  durationSec: number;
  publishedAt: string;
}

interface VideosResponse {
  items?: {
    id: string;
    snippet?: {
      title?: string;
      channelId?: string;
      channelTitle?: string;
      tags?: string[];
      publishedAt?: string;
      thumbnails?: Record<string, { url?: string }>;
    };
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
    contentDetails?: { duration?: string };
  }[];
}

/** Parse an ISO-8601 duration (PT#H#M#S) into seconds. */
export function parseIsoDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const [, h, mn, s] = m;
  return (Number(h) || 0) * 3600 + (Number(mn) || 0) * 60 + (Number(s) || 0);
}

/** videos.list for a batch of ids (≤50) → full snippet/stats/duration. */
export async function fetchVideoDetails(ids: string[]): Promise<VideoDetail[]> {
  const out: VideoDetail[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    if (batch.length === 0) continue;
    const json = await get<VideosResponse>("videos", {
      part: "snippet,contentDetails,statistics",
      id: batch.join(","),
    });
    for (const it of json.items ?? []) {
      const sn = it.snippet ?? {};
      const st = it.statistics ?? {};
      const thumbs = sn.thumbnails ?? {};
      const thumbUrl =
        thumbs.maxres?.url ??
        thumbs.high?.url ??
        thumbs.medium?.url ??
        thumbs.default?.url ??
        "";
      out.push({
        youtubeVideoId: it.id,
        title: sn.title ?? "",
        channelTitle: sn.channelTitle ?? "Unknown",
        views: Number(st.viewCount) || 0,
        likes: Number(st.likeCount) || 0,
        comments: Number(st.commentCount) || 0,
        tags: sn.tags ?? [],
        thumbnailUrl: thumbUrl,
        durationSec: parseIsoDuration(it.contentDetails?.duration ?? ""),
        publishedAt: sn.publishedAt ?? "",
      });
    }
  }
  return out;
}

// --------------------------- Stats refresh ---------------------------
// Lightweight readers used by the `stats-refresh` Trigger task (Tranche 5).
// Distinct from fetchVideoDetails (which is the heavier competitor-research
// shape): here we only need the live engagement numbers + each video's owning
// YouTube channelId so we can roll up subscriber/view counts.

export interface VideoStat {
  youtubeVideoId: string;
  channelId: string; // YouTube channelId (UC...), for channels.list rollup
  views: number;
  likes: number;
  comments: number;
}

/** videos.list?part=snippet,statistics for a batch of ids → live numbers. */
export async function fetchVideoStats(ids: string[]): Promise<VideoStat[]> {
  const out: VideoStat[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    if (batch.length === 0) continue;
    const json = await get<VideosResponse>("videos", {
      part: "snippet,statistics",
      id: batch.join(","),
    });
    for (const it of json.items ?? []) {
      const sn = it.snippet ?? {};
      const st = it.statistics ?? {};
      out.push({
        youtubeVideoId: it.id,
        channelId: sn.channelId ?? "",
        views: Number(st.viewCount) || 0,
        likes: Number(st.likeCount) || 0,
        comments: Number(st.commentCount) || 0,
      });
    }
  }
  return out;
}

export interface ChannelStat {
  channelId: string; // YouTube channelId (UC...)
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
}

interface ChannelsResponse {
  items?: {
    id: string;
    statistics?: {
      subscriberCount?: string;
      viewCount?: string;
      videoCount?: string;
    };
  }[];
}

/** channels.list?part=statistics for a batch of YouTube channelIds (≤50). */
export async function fetchChannelStats(
  channelIds: string[],
): Promise<ChannelStat[]> {
  const out: ChannelStat[] = [];
  const unique = [...new Set(channelIds.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    if (batch.length === 0) continue;
    const json = await get<ChannelsResponse>("channels", {
      part: "statistics",
      id: batch.join(","),
    });
    for (const it of json.items ?? []) {
      const st = it.statistics ?? {};
      out.push({
        channelId: it.id,
        subscriberCount: Number(st.subscriberCount) || 0,
        viewCount: Number(st.viewCount) || 0,
        videoCount: Number(st.videoCount) || 0,
      });
    }
  }
  return out;
}
