export type SignedAssetPreviewState = "idle" | "loading" | "ready" | "error";

/** The source that is actually on screen, not an artifact quality judgement. */
export type MediaPreviewSource = "r2" | "youtube" | "fallback" | "unavailable";

export type MediaPreviewState = "loading" | "ready" | "unavailable";

export type MediaPreviewSelection = {
  source: MediaPreviewSource;
  src: string | null;
  state: MediaPreviewState;
};

/**
 * Select a browser-safe preview without treating a public fallback as proof
 * that the retained R2 artifact exists. If an R2 key was supplied, a fallback
 * is deliberately held back until URL resolution or image loading has failed.
 */
export function selectMediaPreview({
  assetKey,
  signedUrl,
  signedState,
  r2ImageFailed,
  fallbackSrc,
  fallbackImageFailed,
  fallbackSource = "fallback",
}: {
  assetKey?: string | null;
  signedUrl?: string | null;
  signedState: SignedAssetPreviewState;
  r2ImageFailed: boolean;
  fallbackSrc?: string | null;
  fallbackImageFailed: boolean;
  fallbackSource?: Exclude<MediaPreviewSource, "r2" | "unavailable">;
}): MediaPreviewSelection {
  const usableFallback = fallbackSrc && !fallbackImageFailed
    ? { source: fallbackSource, src: fallbackSrc, state: "loading" as const }
    : null;

  if (!assetKey) {
    return usableFallback ?? { source: "unavailable", src: null, state: "unavailable" };
  }

  if (!r2ImageFailed && signedState === "ready" && signedUrl) {
    return { source: "r2", src: signedUrl, state: "loading" };
  }

  // A public image is not shown while a private asset is still resolving. That
  // keeps the UI honest about which retained asset the operator is reviewing.
  if (!r2ImageFailed && signedState !== "error") {
    return { source: "r2", src: null, state: "loading" };
  }

  return usableFallback ?? { source: "unavailable", src: null, state: "unavailable" };
}
