"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { useAssetUrlState } from "@/lib/asset-url";
import {
  selectMediaPreview,
  type MediaPreviewSource,
} from "@/lib/mediaPreview";
import styles from "./MediaPreview.module.css";

function joinClassNames(...names: Array<string | undefined>) {
  return names.filter(Boolean).join(" ");
}

export type MediaPreviewPresentation = {
  source: MediaPreviewSource;
  state: "loading" | "ready" | "unavailable";
};

/**
 * One visual boundary for private R2 preview media. It retains the card's
 * aspect ratio while a signed URL is resolving and only moves to a public
 * fallback once the R2 URL or image itself has failed.
 */
export function MediaPreview({
  assetKey,
  alt,
  fallbackSrc,
  fallbackSource = "fallback",
  className,
  imageClassName,
  emptyClassName,
  dataTone,
  style,
  aspectRatio = "16 / 9",
  loadingLabel = "Loading preview",
  unavailableLabel = "Preview unavailable",
  emptyContent,
  overlay,
}: {
  assetKey?: string | null;
  alt: string;
  fallbackSrc?: string | null;
  fallbackSource?: "youtube" | "fallback";
  className?: string;
  imageClassName?: string;
  emptyClassName?: string;
  dataTone?: string;
  style?: CSSProperties;
  aspectRatio?: CSSProperties["aspectRatio"];
  loadingLabel?: string;
  unavailableLabel?: string;
  emptyContent?: ReactNode;
  overlay?: (presentation: MediaPreviewPresentation) => ReactNode;
}) {
  const signedAsset = useAssetUrlState(assetKey);
  const [r2FailedKey, setR2FailedKey] = useState<string | null>(null);
  const [fallbackFailedSrc, setFallbackFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

  const selection = selectMediaPreview({
    assetKey,
    signedUrl: signedAsset.url,
    signedState: signedAsset.status,
    r2ImageFailed: Boolean(assetKey && r2FailedKey === assetKey),
    fallbackSrc,
    fallbackImageFailed: Boolean(fallbackSrc && fallbackFailedSrc === fallbackSrc),
    fallbackSource,
  });
  const state = selection.src && loadedSrc === selection.src
    ? "ready"
    : selection.state;
  const presentation = { source: selection.source, state };
  const isDecorative = alt.length === 0;
  const visibleStateLabel = state === "loading" ? loadingLabel : unavailableLabel;

  return (
    <div
      className={joinClassNames(styles.preview, className)}
      style={{ aspectRatio, ...style }}
      data-preview-source={selection.source}
      data-preview-state={state}
      data-has-source={selection.src ? "true" : "false"}
      data-tone={dataTone}
      aria-busy={state === "loading" || undefined}
    >
      {selection.src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={joinClassNames(styles.image, imageClassName)}
          src={selection.src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoadedSrc(selection.src)}
          onError={() => {
            if (selection.source === "r2" && assetKey) {
              setR2FailedKey(assetKey);
              return;
            }
            if (selection.source !== "unavailable" && fallbackSrc) {
              setFallbackFailedSrc(fallbackSrc);
            }
          }}
        />
      )}

      {state !== "ready" && (
        <span
          className={joinClassNames(styles.state, state === "unavailable" ? emptyClassName : undefined)}
          role={isDecorative ? undefined : "status"}
          aria-live={isDecorative ? undefined : "polite"}
          aria-hidden={isDecorative || undefined}
        >
          {state === "loading" && <span className={styles.spinner} aria-hidden="true" />}
          {state === "unavailable" && emptyContent ? emptyContent : <span className={styles.stateLabel}>{visibleStateLabel}</span>}
          {state === "unavailable" && emptyContent && (
            <span className={styles.screenReaderOnly}>{unavailableLabel}</span>
          )}
          {state === "loading" && <span className={styles.stateLabel}>{visibleStateLabel}</span>}
        </span>
      )}

      {overlay?.(presentation)}
    </div>
  );
}
