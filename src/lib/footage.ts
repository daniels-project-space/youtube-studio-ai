/**
 * Stock footage via the Pexels video API. Keyword search → best HD landscape
 * (or vertical) mp4 link. Free tier; pure helper for the `stock_footage` block.
 */
export function hasPexelsKey(): boolean {
  return Boolean(process.env.PEXELS_API_KEY);
}

export interface FootageClip {
  url: string;
  width: number;
  height: number;
  durationSec: number;
  query: string;
}

interface PexelsFile {
  link: string;
  quality?: string;
  width?: number;
  height?: number;
  file_type?: string;
}
interface PexelsVideo {
  duration?: number;
  width?: number;
  height?: number;
  video_files?: PexelsFile[];
}

/** Pick the largest mp4 file not wider than `maxW` (default 1920). */
function bestFile(v: PexelsVideo, maxW = 1920): PexelsFile | null {
  const mp4s = (v.video_files ?? []).filter(
    (f) => (f.file_type ?? "").includes("mp4") && typeof f.link === "string",
  );
  if (mp4s.length === 0) return null;
  const within = mp4s.filter((f) => (f.width ?? 0) <= maxW);
  const pool = within.length > 0 ? within : mp4s;
  return pool.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
}

/**
 * Technical quality score (v1 method): prefer HD+ and clips long enough to give
 * trim room. Used to RANK candidates before the relevance gate, so we pick the
 * best clip per query instead of the first.
 */
export function scoreClip(c: FootageClip, minDurationSec = 4): number {
  let s = 0;
  const h = c.height ?? 0;
  if (h >= 1080) s += 40;
  else if (h >= 720) s += 25;
  else s += 10;
  if (c.durationSec >= minDurationSec * 2) s += 30;
  else if (c.durationSec >= minDurationSec) s += 20;
  else if (c.durationSec >= minDurationSec * 0.5) s += 10;
  return s;
}

/**
 * Search Pexels for up to `count` clips matching `query`. orientation:
 * "landscape" (16:9) or "portrait" (9:16). Returns mp4 links + dimensions.
 */
export async function searchFootage(
  query: string,
  count = 2,
  orientation: "landscape" | "portrait" = "landscape",
): Promise<FootageClip[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) throw new Error("PEXELS_API_KEY is not configured");
  const url =
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}` +
    `&per_page=${Math.max(1, Math.min(count, 10))}&orientation=${orientation}&size=medium`;
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) {
    throw new Error(`Pexels HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
  }
  const json = (await res.json()) as { videos?: PexelsVideo[] };
  const out: FootageClip[] = [];
  for (const v of json.videos ?? []) {
    const f = bestFile(v, orientation === "portrait" ? 1080 : 1920);
    if (!f) continue;
    out.push({
      url: f.link,
      width: f.width ?? v.width ?? 0,
      height: f.height ?? v.height ?? 0,
      durationSec: v.duration ?? 0,
      query,
    });
    if (out.length >= count) break;
  }
  return out;
}
