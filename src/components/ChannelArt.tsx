"use client";

import { useCallback, useState } from "react";
import { invalidateAssetUrl, useAssetUrlState } from "@/lib/asset-url";
import { NicheMotionGlyph } from "@/components/NicheMotionGlyph";
import { channelMotionMotifFor, type ChannelMotionMotif } from "@/lib/channelMotion";

/**
 * Channel avatar / banner. Presigns the R2 art key via /api/asset-url; while it
 * loads (or if the channel has no art yet) it falls back to a tasteful gradient
 * derived from the channel's palette — never a broken image, never empty.
 */
const MOTIF_FALLBACK_PALETTES: Readonly<Record<ChannelMotionMotif, readonly [string, string, string]>> = {
  lofi: ["#102337", "#1d5670", "#78b9b1"],
  lesson: ["#241b35", "#4b3768", "#c48770"],
  ledger: ["#101d32", "#2e4b69", "#c4a45e"],
  circuit: ["#0c2630", "#155d67", "#72d2b1"],
  heart: ["#341725", "#813b5d", "#e99b9d"],
  steam: ["#2e2119", "#744728", "#e5ad5f"],
  compass: ["#172033", "#394864", "#c5ad70"],
  clapper: ["#201729", "#5b2844", "#e27866"],
  mind: ["#1a1937", "#463b79", "#9d9be8"],
  casefile: ["#17191f", "#41424b", "#be8e50"],
  book: ["#2a1d1b", "#654034", "#d0a46b"],
  pen: ["#29201e", "#68433d", "#d58a6d"],
  summit: ["#16232f", "#3d5860", "#dd9a5c"],
  health: ["#102b31", "#28706f", "#a4d6bd"],
  business: ["#161d35", "#344a78", "#b9a1e8"],
  lotus: ["#101d32", "#285576", "#79b7dd"],
  seaside: ["#10293d", "#236681", "#e0a56f"],
};

/**
 * Keep an artwork-free channel recognizable while its real R2 asset loads.
 * The palette is derived from the same named motif as the glyph, so a
 * fallback cannot quietly turn every channel into the same purple tile.
 */
export function fallbackPaletteFor(input: {
  palette?: string[];
  name?: string | null;
  niche?: string | null;
}): readonly string[] {
  if (input.palette && input.palette.length >= 2) {
    const cols = input.palette.slice(0, 3);
    return cols;
  }
  return MOTIF_FALLBACK_PALETTES[channelMotionMotifFor({ niche: input.niche, channelName: input.name })]
    ?? MOTIF_FALLBACK_PALETTES.lesson;
}

function paletteGradient(input: {
  palette?: string[];
  name?: string | null;
  niche?: string | null;
}): string {
  const cols = fallbackPaletteFor(input);
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
  niche,
  palette,
  size = 56,
  radius = 14,
}: {
  imageKey?: string | null;
  fallbackKeys?: Array<string | null | undefined>;
  name: string;
  niche?: string | null;
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
        background: paletteGradient({ palette, name, niche }),
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
      ) : niche ? (
        <span style={{ width: "68%", height: "68%", display: "block" }}>
          <NicheMotionGlyph niche={niche} channelName={name} />
        </span>
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
  niche,
  palette,
  height = 160,
  aspectRatio,
  className,
  children,
}: {
  bannerKey?: string | null;
  fallbackKeys?: Array<string | null | undefined>;
  name: string;
  /** Used to keep artwork-free banners identifiable while media resolves. */
  niche?: string | null;
  palette?: string[];
  height?: number;
  aspectRatio?: string;
  /** Optional surface-specific treatment; the media and R2 fallback behavior stays shared. */
  className?: string;
  children?: React.ReactNode;
}) {
  const { url, onError } = useFallbackAssetUrl([bannerKey, ...fallbackKeys]);
  return (
    <div
      aria-label={`${name} artwork`}
      className={className}
      style={{
        position: "relative",
        height: aspectRatio ? undefined : height,
        aspectRatio,
        borderRadius: 16,
        overflow: "hidden",
        background: paletteGradient({ palette, name, niche }),
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
      {!url && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            right: "7%",
            top: "12%",
            width: "24%",
            maxWidth: 108,
            minWidth: 52,
            aspectRatio: "1",
            display: "grid",
            placeItems: "center",
            color: "rgba(255,255,255,0.72)",
            opacity: 0.62,
            border: "1px solid rgba(255,255,255,0.16)",
            borderRadius: "50%",
            background: "rgba(8,10,18,0.24)",
            boxShadow: "inset 0 0 24px rgba(255,255,255,0.06), 0 12px 30px rgba(0,0,0,0.18)",
            pointerEvents: "none",
          }}
        >
          <span style={{ width: "62%", height: "62%", display: "block" }}>
            <NicheMotionGlyph niche={niche} channelName={name} />
          </span>
        </span>
      )}
      {children && (
        <div style={{ position: "absolute", inset: 0 }}>{children}</div>
      )}
    </div>
  );
}
