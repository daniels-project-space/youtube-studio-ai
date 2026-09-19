"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { useAssetUrlState } from "@/lib/asset-url";
import {
  selectMediaPreview,
  type MediaPreviewSource,
} from "@/lib/mediaPreview";
import styles from "./MediaPreview.module.css";

// The delivery routes already retry transient R2 edge misses server-side.
// This is the client-side upper bound for a request that never settles at
// all, so a stalled private object becomes an honest unavailable preview
// rather than leaving a Library card on its loading skeleton indefinitely.
const PREVIEW_AVAILABILITY_TIMEOUT_MS = 12_000;

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
  allowVideoStill = true,
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
  /**
   * Card grids should not stream multi-hundred-megabyte masters just to paint
   * a tile. Surfaces enable this only for a pending Lo-Fi row, whose exact
   * 15-second frame is the required thumbnail; detailed workbench views may
   * also enable it for source review.
   */
  allowVideoStill?: boolean;
}) {
  const [reviewedFailedSrc, setReviewedFailedSrc] = useState<string | null>(null);
  const [r2FailedKey, setR2FailedKey] = useState<string | null>(null);
  const [videoStillFailedKey, setVideoStillFailedKey] = useState<string | null>(null);
  const [videoProbe, setVideoProbe] = useState<{ src: string; state: "checking" | "ready" } | null>(null);
  const [imageProbe, setImageProbe] = useState<{ src: string; state: "ready" } | null>(null);
  const [fallbackFailedSrc, setFallbackFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const decodedVideoSourceRef = useRef<string | null>(null);
  // A retained Lo-Fi master is potentially hours long.  Metadata-only loading
  // is cheap, but it may never fetch the frame at 15 seconds; decode only
  // when the card is near view (or explicitly above the fold) instead of
  // preloading every master in a carousel.
  const [videoFrameRequested, setVideoFrameRequested] = useState(priority);
  const shouldBufferVideoFrame = priority || videoFrameRequested;
  // useSyncExternalStore gives the server a stable false snapshot and flips to
  // true only after hydration, without a synchronous setState-in-effect.
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const showingReviewed = Boolean(reviewedSrc && reviewedFailedSrc !== reviewedSrc);
  const sourceVideoStillKey = allowVideoStill ? videoStillKey : undefined;
  // Resolve only the source we can actually display. Fallback hooks remain
  // mounted, but do not sign an unused master or an image hidden by a review.
  const signedAsset = useAssetUrlState(showingReviewed ? undefined : assetKey);
  const signedVideoStill = useAssetUrlState(!showingReviewed && !assetKey ? sourceVideoStillKey : undefined);

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
    assetKey: sourceVideoStillKey,
    signedUrl: signedVideoStill.url,
    signedState: signedVideoStill.status,
    r2ImageFailed: Boolean(sourceVideoStillKey && videoStillFailedKey === sourceVideoStillKey),
    fallbackSrc: undefined,
    fallbackImageFailed: true,
  });
  const fallbackSelection = assetKey ? imageSelection : sourceVideoStillKey ? videoStillSelection : imageSelection;
  const selection = showingReviewed && reviewedSrc
    ? { source: "reviewed" as const, src: reviewedSrc, state: "loading" as const }
    : fallbackSelection;
  const showingVideoStill = !showingReviewed && !assetKey && Boolean(sourceVideoStillKey) && selection.source === "r2";
  useEffect(() => {
    if (!showingVideoStill || shouldBufferVideoFrame) return;
    if (typeof IntersectionObserver === "undefined") {
      const timer = window.setTimeout(() => setVideoFrameRequested(true), 0);
      return () => window.clearTimeout(timer);
    }
    const node = previewRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      setVideoFrameRequested(true);
    }, { rootMargin: "240px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [showingVideoStill, shouldBufferVideoFrame]);
  // The same-origin delivery route verifies both the initial native-player
  // range and a later seek in one server-side proof wave. Keep the browser
  // to one request per card: the old client cascade was five sequential
  // requests and made a valid Lo-Fi source-frame visibly stall.
  useEffect(() => {
    if (!showingVideoStill || !selection.src || !sourceVideoStillKey) {
      return;
    }
    const src = selection.src;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), PREVIEW_AVAILABILITY_TIMEOUT_MS);
    let cancelled = false;
    const verifyRetainedPreview = async (): Promise<void> => {
      const response = await fetch(`${src}${src.includes("?") ? "&" : "?"}probe=1`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error("video source probe unavailable");
      const result = await response.json() as { available?: unknown };
      if (result.available !== true) throw new Error("video source unavailable");
    };
    verifyRetainedPreview()
      .then(() => {
        if (!cancelled) setVideoProbe({ src, state: "ready" });
      })
      .catch(() => {
        if (!cancelled) setVideoStillFailedKey(sourceVideoStillKey);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [showingVideoStill, selection.src, sourceVideoStillKey]);
  const videoSourceReady = showingVideoStill && Boolean(selection.src)
    && hydrated && videoProbe?.src === selection.src && videoProbe.state === "ready";
  useEffect(() => {
    // Native media does not consistently upgrade a metadata request when a
    // non-zero seek is issued through the same-origin range proxy. Once this
    // card is admitted and the source proof has passed, restart that one video
    // with auto buffering exactly once. This is deliberately after viewport
    // admission, never a carousel-wide eager download.
    if (!showingVideoStill || !shouldBufferVideoFrame || !videoSourceReady || !selection.src) return;
    if (decodedVideoSourceRef.current === selection.src) return;
    const video = videoRef.current;
    if (!video) return;
    decodedVideoSourceRef.current = selection.src;
    video.preload = "auto";
    video.load();
  }, [selection.src, shouldBufferVideoFrame, showingVideoStill, videoSourceReady]);
  const showingPrivateImage = !showingReviewed && Boolean(selection.src)
    && selection.source === "r2" && !showingVideoStill;
  useEffect(() => {
    if (!showingPrivateImage || !selection.src || !assetKey) return;
    const src = selection.src;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), PREVIEW_AVAILABILITY_TIMEOUT_MS);
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
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [showingPrivateImage, selection.src, assetKey]);
  const imageSourceReady = !showingPrivateImage
    || (hydrated && imageProbe?.src === selection.src);
  // Do not mount an <img> until the private-object probe has completed. An
  // image element with an undefined src causes Chromium to paint its alt text
  // as if the thumbnail were broken, which is especially noisy in card grids.
  // Keep the explicit loading state visible until the same source is safe to
  // request, then let the native load event settle the ready state.
  const state = showingPrivateImage && !imageSourceReady
    ? "loading"
    : selection.src && loadedSrc === selection.src
      ? "ready"
      : selection.state;
  const presentation = { source: selection.source, state, src: selection.src };
  const isDecorative = alt.length === 0;
  const visibleStateLabel = state === "loading" ? loadingLabel : unavailableLabel;

  return (
    <>
    <div
      ref={previewRef}
      className={joinClassNames(styles.preview, className)}
      style={{ aspectRatio, ...style }}
      data-preview-source={selection.source}
      data-preview-state={state}
      data-has-source={selection.src ? "true" : "false"}
      data-tone={dataTone}
      aria-busy={state === "loading" || undefined}
    >
      {selection.src && !showingVideoStill && imageSourceReady && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={joinClassNames(styles.image, imageClassName)}
          src={selection.src}
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
          ref={videoRef}
          className={joinClassNames(styles.image, imageClassName)}
          src={videoSourceReady ? selection.src : undefined}
          muted
          playsInline
          preload={shouldBufferVideoFrame ? "auto" : "metadata"}
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
            if (sourceVideoStillKey) setVideoStillFailedKey(sourceVideoStillKey);
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
