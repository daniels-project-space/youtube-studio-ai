"use client";

import type { CSSProperties } from "react";
import { MediaPreview } from "./MediaPreview";

/**
 * Backwards-compatible private-asset image entry point. The media primitive
 * retains the area while a signed R2 URL resolves and only uses a public
 * fallback after the retained asset cannot be loaded.
 */
export function AssetImg({
  k,
  alt,
  style,
  fallbackSrc,
  fallbackSource = "fallback",
}: {
  k?: string | null;
  alt: string;
  style?: CSSProperties;
  fallbackSrc?: string;
  fallbackSource?: "youtube" | "fallback";
}) {
  return (
    <MediaPreview
      assetKey={k}
      alt={alt}
      fallbackSrc={fallbackSrc}
      fallbackSource={fallbackSource}
      style={style}
    />
  );
}
