/**
 * Stock footage — FEDERATED across providers. Each provider is a small adapter
 * returning the same `FootageClip` shape; `searchFootage` fans out across every
 * provider that has a key, in parallel, and merges the pool. The block's
 * existing technical score + Gemini relevance gate then pick across the merged
 * candidates, so adding a source widens the talent pool without touching the
 * selection logic. Adding a provider later is one adapter object.
 *
 * Resolution: every adapter pulls the HIGHEST-resolution file (up to UHD/4K)
 * the provider offers — the downstream canvas is 1080p, so a 4K source means
 * a crisp downscale and lossless Ken-Burns push-ins instead of a soft upscale.
 *
 * Providers (key → vault service):
 *   pexels  PEXELS_API_KEY   (free)            — always-on baseline
 *   pixabay PIXABAY_API_KEY  (free, self-serve)
 *   coverr  COVERR_API_KEY   (free, self-serve; api.coverr.co)
 *   videvo  VIDEVO_API_KEY   (partner; VIDEVO_API_BASE overridable)
 */

export interface FootageClip {
  url: string;
  width: number;
  height: number;
  durationSec: number;
  query: string;
  /** Which provider supplied it (logging + per-provider dedup namespacing). */
  provider: string;
}

export function hasPexelsKey(): boolean {
  return Boolean(process.env.PEXELS_API_KEY);
}

/** True when ANY footage provider is configured. */
export function hasAnyFootageProvider(): boolean {
  return PROVIDERS.some((p) => p.hasKey());
}

/** Names of the currently-configured providers (for logging). */
export function activeProviders(): string[] {
  return PROVIDERS.filter((p) => p.hasKey()).map((p) => p.name);
}

/** A clip counts as 4K when its long edge is UHD/DCI (≈3840+). */
export function is4k(c: { width: number; height: number }): boolean {
  return Math.max(c.width, c.height) >= 3800;
}

/**
 * 4K-only is the DEFAULT for every channel (operator law 2026-06-13: "only 4k
 * footage gets taken"). Flip with FOOTAGE_4K_ONLY=0 to fall back to
 * highest-available (so 1080p sources like Pixabay/Coverr-free contribute).
 * NOTE: under 4K-only, free Pixabay (1080p cap) and free Coverr (4K is paid)
 * are filtered out — Pexels carries 4K.
 */
export function fourKOnly(): boolean {
  return process.env.FOOTAGE_4K_ONLY !== "0";
}

/**
 * Technical quality score (v1 method + UHD bonus): prefer 4K/HD and clips long
 * enough to give trim room. Ranks candidates before the relevance gate.
 */
export function scoreClip(c: FootageClip, minDurationSec = 4): number {
  let s = 0;
  const h = c.height ?? 0;
  if (h >= 2160) s += 55;
  else if (h >= 1440) s += 48;
  else if (h >= 1080) s += 40;
  else if (h >= 720) s += 25;
  else s += 10;
  if (c.durationSec >= minDurationSec * 2) s += 30;
  else if (c.durationSec >= minDurationSec) s += 20;
  else if (c.durationSec >= minDurationSec * 0.5) s += 10;
  return s;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch JSON with 3 retries on 429/5xx/network; returns null on hard failure. */
async function getJson<T>(url: string, init: RequestInit, label: string): Promise<T | null> {
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return (await res.json()) as T;
      lastErr = `${label} HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 140)}`;
      if (res.status !== 429 && res.status < 500) break;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await sleep(1200 * (attempt + 1));
  }
  if (lastErr) console.warn(`footage: ${lastErr}`);
  return null;
}

type Orientation = "landscape" | "portrait";

interface Provider {
  name: string;
  hasKey: () => boolean;
  search: (query: string, count: number, orientation: Orientation) => Promise<FootageClip[]>;
}

/* ------------------------------- Pexels -------------------------------- */

interface PexelsFile { link: string; quality?: string; width?: number; height?: number; file_type?: string }
interface PexelsVideo { duration?: number; width?: number; height?: number; video_files?: PexelsFile[] }

/** Largest mp4 not wider than `maxW` (UHD allowed — the canvas downscales). */
function bestPexelsFile(v: PexelsVideo, maxW: number): PexelsFile | null {
  const mp4s = (v.video_files ?? []).filter((f) => (f.file_type ?? "").includes("mp4") && typeof f.link === "string");
  if (mp4s.length === 0) return null;
  const within = mp4s.filter((f) => (f.width ?? 0) <= maxW);
  return (within.length > 0 ? within : mp4s).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
}

const pexels: Provider = {
  name: "pexels",
  hasKey: () => Boolean(process.env.PEXELS_API_KEY),
  async search(query, count, orientation) {
    const key = process.env.PEXELS_API_KEY!;
    // size=large biases to higher-res results; bestPexelsFile then pulls UHD.
    const url =
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}` +
      `&per_page=${Math.max(1, Math.min(count, 15))}&orientation=${orientation}&size=large`;
    const json = await getJson<{ videos?: PexelsVideo[] }>(url, { headers: { Authorization: key } }, "pexels");
    if (!json) return [];
    const maxW = orientation === "portrait" ? 2160 : 3840;
    const out: FootageClip[] = [];
    for (const v of json.videos ?? []) {
      const f = bestPexelsFile(v, maxW);
      if (!f) continue;
      out.push({ url: f.link, width: f.width ?? v.width ?? 0, height: f.height ?? v.height ?? 0, durationSec: v.duration ?? 0, query, provider: "pexels" });
    }
    return out;
  },
};

/* ------------------------------- Pixabay ------------------------------- */

interface PixabayFile { url?: string; width?: number; height?: number; size?: number }
interface PixabayHit { duration?: number; videos?: Record<string, PixabayFile> }

const pixabay: Provider = {
  name: "pixabay",
  hasKey: () => Boolean(process.env.PIXABAY_API_KEY),
  async search(query, count, orientation) {
    const key = process.env.PIXABAY_API_KEY!;
    const url =
      `https://pixabay.com/api/videos/?key=${key}&q=${encodeURIComponent(query)}` +
      `&per_page=${Math.max(3, Math.min(count, 20))}&video_type=film&safesearch=true`;
    const json = await getJson<{ hits?: PixabayHit[] }>(url, {}, "pixabay");
    if (!json) return [];
    const out: FootageClip[] = [];
    for (const h of json.hits ?? []) {
      // Pixabay returns a size map (large/medium/small/tiny + UHD on some) —
      // take the widest file that fits the orientation.
      const files = Object.values(h.videos ?? {}).filter((f): f is PixabayFile => Boolean(f?.url && f.width && f.height));
      const oriented = files.filter((f) => (orientation === "portrait" ? f.height! >= f.width! : f.width! >= f.height!));
      const best = (oriented.length ? oriented : files).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
      if (!best?.url) continue;
      out.push({ url: best.url, width: best.width ?? 0, height: best.height ?? 0, durationSec: h.duration ?? 0, query, provider: "pixabay" });
    }
    return out;
  },
};

/* -------------------------------- Coverr ------------------------------- */

interface CoverrUrls { mp4?: string; mp4_download?: string; mp4_preview?: string }
interface CoverrRendition { width?: number; height?: number; url?: string; is_plus?: boolean }
interface CoverrVideo {
  id?: string;
  urls?: CoverrUrls;
  max_height?: number;
  max_width?: number;
  aspect_ratio?: string;
  duration?: number | string;
  default_variant?: { renditions?: CoverrRendition[] };
}

const coverr: Provider = {
  name: "coverr",
  hasKey: () => Boolean(process.env.COVERR_API_KEY),
  async search(query, count, orientation) {
    const key = process.env.COVERR_API_KEY!;
    const url =
      `https://api.coverr.co/videos?query=${encodeURIComponent(query)}` +
      `&page_size=${Math.max(3, Math.min(count, 20))}&urls=true`;
    const json = await getJson<{ hits?: CoverrVideo[]; data?: CoverrVideo[] }>(
      url,
      { headers: { Authorization: `Bearer ${key}` } },
      "coverr",
    );
    if (!json) return [];
    const rows = json.hits ?? json.data ?? [];
    const out: FootageClip[] = [];
    for (const v of rows) {
      // Prefer an explicit is_plus:false rendition when the response carries
      // renditions (single-video shape); the search response usually does not.
      const free = (v.default_variant?.renditions ?? [])
        .filter((r) => r.is_plus !== true && r.url && r.width && r.height)
        .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
      const link = free?.url ?? v.urls?.mp4_download ?? v.urls?.mp4 ?? v.urls?.mp4_preview;
      if (!link) continue;
      // TRUE downloaded resolution: Coverr embeds the rendition in the file
      // name (/{base}/1080p.mp4). The search response's max_height is the
      // SOURCE max, but the free default is ≤1080p (the 4K "original" is
      // is_plus/paid) — so the URL height is what actually downloads. Never
      // trust max_height here, or 1080p files masquerade as 4K.
      const m = link.match(/\/(\d+)p\.mp4/);
      const h = free?.height ?? (m ? Number(m[1]) : Math.min(v.max_height ?? 1080, 1080));
      const w = free?.width ?? (v.aspect_ratio === "16:9" || !v.aspect_ratio ? Math.round((h * 16) / 9) : Math.round((h * 9) / 16));
      if (orientation === "portrait" && w > h) continue;
      out.push({ url: link, width: w, height: h, durationSec: Number(v.duration) || 0, query, provider: "coverr" });
    }
    return out;
  },
};

/* -------------------------------- Videvo ------------------------------- */

interface VidevoClip { id?: string | number; download_url?: string; mp4_url?: string; url?: string; width?: number; height?: number; duration?: number }

/**
 * Videvo is a partner/enterprise API — base URL + auth shape vary by plan, so
 * both are env-overridable (VIDEVO_API_BASE, VIDEVO_API_KEY). Defensive parse:
 * unknown shape → []. Confirm the endpoint with the partner key, then it lights
 * up like the rest.
 */
const videvo: Provider = {
  name: "videvo",
  hasKey: () => Boolean(process.env.VIDEVO_API_KEY),
  async search(query, count, orientation) {
    const key = process.env.VIDEVO_API_KEY!;
    const base = (process.env.VIDEVO_API_BASE ?? "https://api.videvo.net/v1").replace(/\/$/, "");
    const url = `${base}/videos/search?query=${encodeURIComponent(query)}&per_page=${Math.max(3, Math.min(count, 20))}`;
    const json = await getJson<{ results?: VidevoClip[]; data?: VidevoClip[]; videos?: VidevoClip[] }>(
      url,
      { headers: { Authorization: `Bearer ${key}`, "x-api-key": key } },
      "videvo",
    );
    if (!json) return [];
    const rows = json.results ?? json.data ?? json.videos ?? [];
    const out: FootageClip[] = [];
    for (const v of rows) {
      const link = v.download_url ?? v.mp4_url ?? v.url;
      if (!link) continue;
      const w = v.width ?? 0;
      const h = v.height ?? 0;
      if (orientation === "portrait" && w && h && w > h) continue;
      out.push({ url: link, width: w, height: h, durationSec: v.duration ?? 0, query, provider: "videvo" });
    }
    return out;
  },
};

const PROVIDERS: Provider[] = [pexels, pixabay, coverr, videvo];

/**
 * Federated search: query EVERY configured provider in parallel for `query`,
 * merge the results, and return them ranked by technical score (best first).
 * Caller-facing signature unchanged from the single-provider version, so the
 * block keeps its dedup + relevance gate. `count` is per-provider.
 */
export async function searchFootage(
  query: string,
  count = 2,
  orientation: Orientation = "landscape",
): Promise<FootageClip[]> {
  const active = PROVIDERS.filter((p) => p.hasKey());
  if (active.length === 0) throw new Error("searchFootage: no footage provider configured (need at least PEXELS_API_KEY)");
  const results = await Promise.all(
    active.map((p) =>
      p.search(query, count, orientation).catch((e) => {
        console.warn(`footage: ${p.name} search "${query}" failed: ${e instanceof Error ? e.message : e}`);
        return [] as FootageClip[];
      }),
    ),
  );
  // Merge, drop empties. 4K-only by default (every channel): keep only UHD
  // clips so a 1080p source never sneaks into the timeline.
  let merged = results.flat().filter((c) => c.url);
  if (fourKOnly()) {
    const before = merged.length;
    merged = merged.filter(is4k);
    if (before > merged.length && merged.length === 0) {
      console.warn(`footage: 4K-only dropped all ${before} candidate(s) for "${query}" (no UHD across providers)`);
    }
  }
  // Rank best-first so the block's top-N slice spans providers (a great 4K
  // clip from any source outranks a soft one).
  return merged.sort((a, b) => scoreClip(b) - scoreClip(a));
}
