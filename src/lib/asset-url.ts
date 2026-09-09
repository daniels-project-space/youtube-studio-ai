"use client";

import { useEffect, useRef, useState } from "react";

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
const MAX_CACHED_ASSETS = 256;
const cache = new Map<string, { url: string; expiresAt: number }>();
const pending = new Map<string, { promise: Promise<string>; controller: AbortController }>();

function cachedAssetUrl(key: string): string | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  // Touch the entry so unused artwork is evicted before frequently opened media.
  cache.delete(key);
  cache.set(key, entry);
  return entry.url;
}

/** Share signing work without sharing a component's playback/source lifetime. */
export function resolveAssetUrl(key: string): Promise<string> {
  const cached = cachedAssetUrl(key);
  if (cached) return Promise.resolve(cached);
  const existing = pending.get(key);
  if (existing) return existing.promise;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const promise = fetch(`/api/asset-url?key=${encodeURIComponent(key)}`, { signal: controller.signal })
    .then(response => {
      if (!response.ok) throw new Error("Asset URL request failed");
      return response.json() as Promise<{ url?: unknown }>;
    })
    .then(data => {
      if (typeof data.url !== "string" || !data.url.trim()) throw new Error("Asset URL response is missing its URL");
      if (pending.get(key)?.promise !== promise) throw new Error("Asset URL request was invalidated");
      cache.set(key, { url: data.url, expiresAt: Date.now() + CLIENT_CACHE_TTL_MS });
      while (cache.size > MAX_CACHED_ASSETS) cache.delete(cache.keys().next().value!);
      return data.url;
    })
    .finally(() => {
      clearTimeout(timer);
      if (pending.get(key)?.promise === promise) pending.delete(key);
    });
  pending.set(key, { promise, controller });
  return promise;
}

export type AssetUrlState = {
  url: string | null;
  status: "idle" | "loading" | "ready" | "error";
};

export function invalidateAssetUrl(key: string | null | undefined): void {
  if (!key) return;
  cache.delete(key);
  const obsolete = pending.get(key);
  pending.delete(key);
  obsolete?.controller.abort();
}

/**
 * Resolve a private R2 object key to a short-lived presigned URL via the
 * server-only /api/asset-url route. R2 credentials never touch the client —
 * we only ever receive the signed URL. Results are memoised per key for the
 * next nine minutes. Mounted media retains its resolved URL so another
 * component refreshing the cache cannot restart playback. Pass `null` to skip.
 */
export function useAssetUrlState(
  key: string | null | undefined,
  onResolveError?: () => void,
): AssetUrlState {
  const [resolved, setResolved] = useState<{ key: string; url: string | null } | null>(null);
  const errorCallback = useRef(onResolveError);
  useEffect(() => { errorCallback.current = onResolveError; }, [onResolveError]);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    resolveAssetUrl(key)
      .then((url) => {
        if (cancelled) return;
        setResolved({ key, url });
      })
      .catch(() => {
        if (!cancelled) {
          setResolved({ key, url: null });
          errorCallback.current?.();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!key) return { url: null, status: "idle" };
  if (resolved?.key === key && resolved.url) return { url: resolved.url, status: "ready" };
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
