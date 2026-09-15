"use client";

import { useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
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
  /** The resolved displayed source, so composition slots need no second presign hook. */
  src: string | null;
};

/**
 * One visual boundary for private R2 preview media. It retains the card's
 * aspect ratio while a signed URL is resolving and only moves to a public
 * fallback once the R2 URL or image itself has failed.
 */
export function MediaPreview({
  assetKey,
  videoStillKey,
  reviewedSrc,
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
  footer,
  priority = false,
}: {
  assetKey?: string | null;
  /** A paused 15-second frame from a saved final master; used only as a truthful Lo-Fi fallback. */
  videoStillKey?: string | null;
  /** Owner-authorized, immutable reviewed replacement preview. */
  reviewedSrc?: string | null;
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
  /** Render controls outside the artwork without resolving its source again. */
  footer?: (presentation: MediaPreviewPresentation) => ReactNode;
  /** Prioritize above-the-fold artwork while keeping the rest lazy. */
  priority?: boolean;
}) {
  const [reviewedFailedSrc, setReviewedFailedSrc] = useState<string | null>(null);
  const [r2FailedKey, setR2FailedKey] = useState<string | null>(null);
  const [videoStillFailedKey, setVideoStillFailedKey] = useState<string | null>(null);
  const [videoProbe, setVideoProbe] = useState<{ src: string; state: "checking" | "ready" } | null>(null);
  const [imageProbe, setImageProbe] = useState<{ src: string; state: "ready" } | null>(null);
  const [fallbackFailedSrc, setFallbackFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  // useSyncExternalStore gives the server a stable false snapshot and flips to
  // true only after hydration, without a synchronous setState-in-effect.
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const showingReviewed = Boolean(reviewedSrc && reviewedFailedSrc !== reviewedSrc);
  // Resolve only the source we can actually display. Fallback hooks remain
  // mounted, but do not sign an unused master or an image hidden by a review.
  const signedAsset = useAssetUrlState(showingReviewed ? undefined : assetKey);
  const signedVideoStill = useAssetUrlState(!showingReviewed && !assetKey ? videoStillKey : undefined);

  const imageSelection = selectMediaPreview({
    assetKey,
    signedUrl: signedAsset.url,
    signedState: signedAsset.status,
    r2ImageFailed: Boolean(assetKey && r2FailedKey === assetKey),
    fallbackSrc,
    fallbackImageFailed: Boolean(fallbackSrc && fallbackFailedSrc === fallbackSrc),
    fallbackSource,
  });
  const videoStillSelection = selectMediaPreview({
    assetKey: videoStillKey,
    signedUrl: signedVideoStill.url,
    signedState: signedVideoStill.status,
    r2ImageFailed: Boolean(videoStillKey && videoStillFailedKey === videoStillKey),
    fallbackSrc: undefined,
    fallbackImageFailed: true,
  });
  const fallbackSelection = assetKey ? imageSelection : videoStillKey ? videoStillSelection : imageSelection;
  const selection = showingReviewed && reviewedSrc
    ? { source: "reviewed" as const, src: reviewedSrc, state: "loading" as const }
    : fallbackSelection;
  const showingVideoStill = !showingReviewed && !assetKey && Boolean(videoStillKey) && selection.source === "r2";
  // Probe the retained master with a quiet one-byte request before mounting a
  // media element. A missing legacy object then becomes an honest unavailable
  // state instead of a browser-console 404; valid sources still use the exact
  // video element below to seek the 15-second frame.
  useEffect(() => {
    if (!showingVideoStill || !selection.src || !videoStillKey) {
      return;
    }
    const src = selection.src;
    const controller = new AbortController();
    let cancelled = false;
    fetch(`${src}${src.includes("?") ? "&" : "?"}probe=1`, {
      headers: { Range: "bytes=0-0" },
      signal: controller.signal,
      cache: "no-store",
    })
      .then((response) => {
        if (!response.ok) throw new Error("video source probe unavailable");
        return response.json() as Promise<{ available?: unknown }>;
      })
      .then((result) => {
        if (result.available !== true) throw new Error("video source unavailable");
        if (!cancelled) setVideoProbe({ src, state: "ready" });
      })
      .catch(() => {
        if (!cancelled) setVideoStillFailedKey(videoStillKey);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [showingVideoStill, selection.src, videoStillKey]);
  const videoSourceReady = showingVideoStill && Boolean(selection.src)
    && hydrated && videoProbe?.src === selection.src && videoProbe.state === "ready";
  const showingPrivateImage = !showingReviewed && Boolean(selection.src)
    && selection.source === "r2" && !showingVideoStill;
  useEffect(() => {
    if (!showingPrivateImage || !selection.src || !assetKey) return;
    const src = selection.src;
    const controller = new AbortController();
    let cancelled = false;
    fetch(`${src}${src.includes("?") ? "&" : "?"}probe=1`, { signal: controller.signal, cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("image source probe unavailable");
        return response.json() as Promise<{ available?: unknown }>;
      })
      .then((result) => {
        if (result.available !== true) throw new Error("image source unavailable");
        if (!cancelled) setImageProbe({ src, state: "ready" });
      })
      .catch(() => {
        if (!cancelled) setR2FailedKey(assetKey);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [showingPrivateImage, selection.src, assetKey]);
  const imageSourceReady = !showingPrivateImage
    || (hydrated && imageProbe?.src === selection.src);
  const state = selection.src && loadedSrc === selection.src
    ? "ready"
    : selection.state;
  const presentation = { source: selection.source, state, src: selection.src };
  const isDecorative = alt.length === 0;
  const visibleStateLabel = state === "loading" ? loadingLabel : unavailableLabel;

  return (
    <>
    <div
      className={joinClassNames(styles.preview, className)}
      style={{ aspectRatio, ...style }}
      data-preview-source={selection.source}
      data-preview-state={state}
      data-has-source={selection.src ? "true" : "false"}
      data-tone={dataTone}
      aria-busy={state === "loading" || undefined}
    >
      {selection.src && !showingVideoStill && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={joinClassNames(styles.image, imageClassName)}
          src={imageSourceReady ? selection.src : undefined}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          onLoad={() => setLoadedSrc(selection.src)}
          onError={() => {
            if (selection.source === "reviewed" && reviewedSrc) {
              setReviewedFailedSrc(reviewedSrc);
              return;
            }
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
      {selection.src && showingVideoStill && (
        <video
          className={joinClassNames(styles.image, imageClassName)}
          src={videoSourceReady ? selection.src : undefined}
          muted
          playsInline
          preload="metadata"
          aria-label={alt}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            const duration = Number.isFinite(video.duration) ? video.duration : 0;
            const frameTime = Math.min(15, Math.max(0, duration - 0.05));
            if (frameTime > 0 && Math.abs(video.currentTime - frameTime) > 0.01) {
              video.currentTime = frameTime;
            } else {
              video.pause();
              setLoadedSrc(selection.src);
            }
          }}
          onSeeked={(event) => {
            event.currentTarget.pause();
            setLoadedSrc(selection.src);
          }}
          onError={() => {
            if (videoStillKey) setVideoStillFailedKey(videoStillKey);
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
        </span>
      )}

      {overlay?.(presentation)}
    </div>
    {footer?.(presentation)}
    </>
  );
}
