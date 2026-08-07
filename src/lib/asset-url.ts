"use client";

import { useEffect, useState } from "react";

/**
 * Build the free, no-presign YouTube thumbnail URL for a published video.
 * `hqdefault` is 480x360 and always exists; good enough for a 16:9 card.
 */
export function youtubeThumb(youtubeVideoId: string): string {
  return `https://i.ytimg.com/vi/${youtubeVideoId}/hqdefault.jpg`;
}

/** YouTube watch + embed URLs (kept in one place). */
export function youtubeEmbed(youtubeVideoId: string): string {
  return `https://www.youtube.com/embed/${youtubeVideoId}`;
}

const CLIENT_CACHE_TTL_MS = 9 * 60_000;
const cache = new Map<string, { url: string; expiresAt: number }>();

function cachedAssetUrl(key: string): string | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.url;
}

export type AssetUrlState = {
  url: string | null;
  status: "idle" | "loading" | "ready" | "error";
};

export function invalidateAssetUrl(key: string | null | undefined): void {
  if (key) cache.delete(key);
}

/**
 * Resolve a private R2 object key to a short-lived presigned URL via the
 * server-only /api/asset-url route. R2 credentials never touch the client —
 * we only ever receive the signed URL. Results are memoised per key for the
 * lifetime of the page. Pass `null` to skip (e.g. YouTube-thumb path).
 */
export function useAssetUrlState(
  key: string | null | undefined,
  onResolveError?: () => void,
): AssetUrlState {
  const [resolved, setResolved] = useState<{ key: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!key || cachedAssetUrl(key)) return;
    let cancelled = false;
    fetch(`/api/asset-url?key=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: { url?: string }) => {
        if (!data.url) throw new Error("asset URL response did not include a URL");
        if (cancelled) return;
        cache.set(key, { url: data.url, expiresAt: Date.now() + CLIENT_CACHE_TTL_MS });
        setResolved({ key, url: data.url });
      })
      .catch(() => {
        if (!cancelled) {
          setResolved({ key, url: null });
          onResolveError?.();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key, onResolveError]);

  if (!key) return { url: null, status: "idle" };
  const cached = cachedAssetUrl(key);
  if (cached) return { url: cached, status: "ready" };
  if (resolved?.key !== key) return { url: null, status: "loading" };
  return resolved.url
    ? { url: resolved.url, status: "ready" }
    : { url: null, status: "error" };
}

export function useAssetUrl(key: string | null | undefined): string | null {
  return useAssetUrlState(key).url;
}

/** Compact view-count formatter: 1234 → "1.2K", 1500000 → "1.5M". */
export function fmtViews(n?: number): string | null {
  if (n === undefined || n === null) return null;
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
}
