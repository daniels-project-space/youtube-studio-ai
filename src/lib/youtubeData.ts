/**
 * YouTube Data API v3 client (read-only, for competitor research).
 *
 * Distinct from src/lib/youtube.ts (OAuth upload). This uses a simple API key
 * (YOUTUBE_DATA_API_KEY) for public read endpoints: search.list + videos.list.
 *
 * If the key is absent, `hasYouTubeDataKey()` is false and callers degrade —
 * functions throw loud only when actually invoked, so build never crashes.
 */

import {
  createPublicEvidenceCache,
  normalizeEvidenceKey,
} from "@/lib/publicEvidenceCache";

const BASE = "https://www.googleapis.com/youtube/v3";
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const searchEvidenceCache = createPublicEvidenceCache<string[]>(SEARCH_CACHE_TTL_MS);
const videoDetailsCache = createPublicEvidenceCache<VideoDetail[]>(SEARCH_CACHE_TTL_MS);

/** Clear public YouTube evidence between isolated tests or an operator reset. */
export function clearYouTubeDataEvidenceCache(): void {
  searchEvidenceCache.clear();
  videoDetailsCache.clear();
}

export class YouTubeDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YouTubeDataError";
  }
}

export function hasYouTubeDataKey(): boolean {
  return Boolean(process.env.YOUTUBE_DATA_API_KEY);
}

/**
 * Read access exists via EITHER an API key (public read) OR the OAuth refresh
 * token (needs the youtube.readonly scope — see scripts/youtube-oauth.ts). This
 * lets a scope re-consent unblock competitor SEO without a separate API key.
 */
export function hasYouTubeDataAccess(): boolean {
  return (
    Boolean(process.env.YOUTUBE_DATA_API_KEY) ||
    Boolean(process.env.YOUTUBE_REFRESH_TOKEN && process.env.YOUTUBE_CLIENT_ID)
  );
}

export interface YouTubeDataAccess {
  /** Exact channel-bound connector token; preferred whenever supplied. */
  refreshToken?: string;
  /** Refuse API-key/global fallbacks for tenant-owned data. */
  requireConnector?: boolean;
}

async function get<T>(
  path: string,
  params: Record<string, string>,
  access: YouTubeDataAccess = {},
): Promise<T> {
  const apiKey = process.env.YOUTUBE_DATA_API_KEY;
  let url: string;
  const headers: Record<string, string> = {};
  if (access.refreshToken) {
    const { getAccessToken } = await import("@/lib/youtube");
    headers.Authorization = `Bearer ${await getAccessToken(access.refreshToken)}`;
    url = `${BASE}/${path}?${new URLSearchParams(params).toString()}`;
  } else if (access.requireConnector) {
    throw new YouTubeDataError("channel-bound YouTube Data access is required");
  } else if (apiKey) {
    url = `${BASE}/${path}?${new URLSearchParams({ ...params, key: apiKey }).toString()}`;
  } else if (process.env.YOUTUBE_REFRESH_TOKEN) {
    const { getAccessToken } = await import("@/lib/youtube");
    headers.Authorization = `Bearer ${await getAccessToken(process.env.YOUTUBE_REFRESH_TOKEN)}`;
    url = `${BASE}/${path}?${new URLSearchParams(params).toString()}`;
  } else {
    throw new YouTubeDataError("no YouTube Data access (set YOUTUBE_DATA_API_KEY or OAuth)");
  }
  const res = await fetch(url, { headers });
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
  const key = `search:${JSON.stringify({
    query: normalizeEvidenceKey(args.query),
    maxResults: args.maxResults ?? 25,
    publishedAfter: args.publishedAfter ?? "",
    relevanceLanguage: args.relevanceLanguage ?? "en",
  })}`;
  const cached = searchEvidenceCache.get(key);
  if (cached) return [...cached];
  const active = searchEvidenceCache.getInflight(key);
  if (active) return [...(await active)];

  const request = (async () => {
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
  })();
  searchEvidenceCache.setInflight(key, request);
  try {
    const result = await request;
    searchEvidenceCache.set(key, result);
    return [...result];
  } finally {
    searchEvidenceCache.deleteInflight(key);
  }
}

export interface VideoDetail {
  youtubeVideoId: string;
  title: string;
  channelId: string;
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
  if (ids.length === 0) return [];
  const key = `video-details:${ids.join(",")}`;
  const cached = videoDetailsCache.get(key);
  if (cached) return cached.map(cloneVideoDetail);
  const active = videoDetailsCache.getInflight(key);
  if (active) return (await active).map(cloneVideoDetail);

  const request = (async () => {
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
          channelId: sn.channelId ?? "",
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
  })();
  videoDetailsCache.setInflight(key, request);
  try {
    const result = await request;
    videoDetailsCache.set(key, result);
    return result.map(cloneVideoDetail);
  } finally {
    videoDetailsCache.deleteInflight(key);
  }
}

function cloneVideoDetail(detail: VideoDetail): VideoDetail {
  return { ...detail, tags: [...detail.tags] };
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
export async function fetchVideoStats(
  ids: string[],
  access: YouTubeDataAccess = {},
): Promise<VideoStat[]> {
  const out: VideoStat[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    if (batch.length === 0) continue;
    const json = await get<VideosResponse>(
      "videos",
      {
        part: "snippet,statistics",
        id: batch.join(","),
      },
      access,
    );
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
  access: YouTubeDataAccess = {},
): Promise<ChannelStat[]> {
  const out: ChannelStat[] = [];
  const unique = [...new Set(channelIds.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    if (batch.length === 0) continue;
    const json = await get<ChannelsResponse>(
      "channels",
      {
        part: "statistics",
        id: batch.join(","),
      },
      access,
    );
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
