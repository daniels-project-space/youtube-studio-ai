"use client";

import { useCallback, useState } from "react";
import { invalidateAssetUrl, useAssetUrlState } from "@/lib/asset-url";

/**
 * Channel avatar / banner. Presigns the R2 art key via /api/asset-url; while it
 * loads (or if the channel has no art yet) it falls back to a tasteful gradient
 * derived from the channel's palette — never a broken image, never empty.
 */
function paletteGradient(palette?: string[]): string {
  const cols =
    palette && palette.length >= 2
      ? palette.slice(0, 3)
      : ["#2a2a3a", "#3a2a44", "#22343a"];
  return `linear-gradient(135deg, ${cols.join(", ")})`;
}

export function orderedAssetKeys(
  keys: Array<string | null | undefined>,
): string[] {
  return [...new Set(keys.filter((key): key is string => Boolean(key?.trim())))];
}

function useFallbackAssetUrl(keys: Array<string | null | undefined>) {
  const candidates = orderedAssetKeys(keys);
  const signature = candidates.join("\u0000");
  const [selection, setSelection] = useState({ signature, index: 0 });
  const candidateIndex = selection.signature === signature ? selection.index : 0;
  const candidate = candidates[candidateIndex];
  const advance = useCallback(() => {
    invalidateAssetUrl(candidate);
    setSelection((current) => {
      const currentIndex = current.signature === signature ? current.index : 0;
      return {
        signature,
        index: Math.min(currentIndex + 1, candidates.length),
      };
    });
  }, [candidate, candidates.length, signature]);
  const asset = useAssetUrlState(candidate, advance);

  return {
    url: asset.url,
    onError: advance,
  };
}

export function ChannelAvatar({
  imageKey,
  fallbackKeys = [],
  name,
  palette,
  size = 56,
  radius = 14,
}: {
  imageKey?: string | null;
  fallbackKeys?: Array<string | null | undefined>;
  name: string;
  palette?: string[];
  size?: number;
  radius?: number;
}) {
  const { url, onError } = useFallbackAssetUrl([imageKey, ...fallbackKeys]);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        flexShrink: 0,
        overflow: "hidden",
        background: paletteGradient(palette),
        border: "1px solid var(--color-border)",
        display: "grid",
        placeItems: "center",
        position: "relative",
      }}
      aria-label={`${name} avatar`}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={name}
          loading="lazy"
          onError={onError}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize: size * 0.4,
            color: "rgba(255,255,255,0.85)",
          }}
        >
          {name.trim().charAt(0).toUpperCase() || "?"}
        </span>
      )}
    </div>
  );
}

export function ChannelBanner({
  bannerKey,
  fallbackKeys = [],
  name,
  palette,
  height = 160,
  aspectRatio,
  children,
}: {
  bannerKey?: string | null;
  fallbackKeys?: Array<string | null | undefined>;
  name: string;
  palette?: string[];
  height?: number;
  aspectRatio?: string;
  children?: React.ReactNode;
}) {
  const { url, onError } = useFallbackAssetUrl([bannerKey, ...fallbackKeys]);
  return (
    <div
      aria-label={`${name} artwork`}
      style={{
        position: "relative",
        height: aspectRatio ? undefined : height,
        aspectRatio,
        borderRadius: 16,
        overflow: "hidden",
        background: paletteGradient(palette),
        border: "1px solid var(--color-border)",
      }}
    >
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`${name} banner`}
          onError={onError}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      )}
      {/* Legibility scrim so overlaid content always reads. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to top, rgba(10,10,11,0.85) 0%, rgba(10,10,11,0.25) 55%, rgba(10,10,11,0.1) 100%)",
        }}
      />
      {children && (
        <div style={{ position: "absolute", inset: 0 }}>{children}</div>
      )}
    </div>
  );
}
