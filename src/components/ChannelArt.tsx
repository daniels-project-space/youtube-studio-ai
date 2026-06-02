"use client";

import { useAssetUrl } from "@/lib/asset-url";

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

export function ChannelAvatar({
  imageKey,
  name,
  palette,
  size = 56,
  radius = 14,
}: {
  imageKey?: string | null;
  name: string;
  palette?: string[];
  size?: number;
  radius?: number;
}) {
  const url = useAssetUrl(imageKey ?? null);
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
  name,
  palette,
  height = 160,
  children,
}: {
  bannerKey?: string | null;
  name: string;
  palette?: string[];
  height?: number;
  children?: React.ReactNode;
}) {
  const url = useAssetUrl(bannerKey ?? null);
  return (
    <div
      style={{
        position: "relative",
        height,
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
