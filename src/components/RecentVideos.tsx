"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useAssetUrlState } from "@/lib/asset-url";
import { MediaPreview } from "./MediaPreview";
import { SignedVideoPlayer } from "./SignedVideoPlayer";
import styles from "./RecentVideos.module.css";

type RenderedVideo = {
  _id: string;
  title: string;
  channelName: string;
  youtubeVideoId?: string;
  thumbnailKey?: string | null;
  videoKey?: string | null;
  durationSec?: number;
  createdAt?: number;
};

const renderDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

function fmtDur(seconds?: number) {
  if (!Number.isFinite(seconds) || !seconds || seconds < 0) return "";
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor(rounded / 60) % 60;
  const tail = `${String(minutes).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
  return hours ? `${hours}:${tail}` : `${minutes}:${String(rounded % 60).padStart(2, "0")}`;
}

/** Recent rendered masters. Cards preview and open only saved R2 media, never YouTube artwork. */
export function RecentVideos({
  ownerId,
  channelId,
  limit = 10,
}: {
  ownerId: string;
  channelId?: Id<"channels">;
  limit?: number;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const [selected, setSelected] = useState<RenderedVideo | null>(null);
  const [scrollable, setScrollable] = useState({ previous: false, next: false });
  const videos = useQuery(api.videos.listVideos, {
    ownerId,
    ...(channelId ? { channelId } : {}),
    limit,
  }) as RenderedVideo[] | undefined;

  const renders = videos?.filter(
    (video): video is RenderedVideo & { videoKey: string } => Boolean(video.videoKey),
  );
  const renderCount = renders?.length;

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const previous = track.scrollLeft > 2;
      const next = track.scrollLeft + track.clientWidth < track.scrollWidth - 2;
      setScrollable(old => old.previous === previous && old.next === next ? old : { previous, next });
    };
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    track.addEventListener("scroll", measure, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      track.removeEventListener("scroll", measure);
    };
  }, [renderCount, channelId]);

  if (renders !== undefined && renders.length === 0) return null;

  const move = (direction: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({
      left: direction * Math.max(track.clientWidth * 0.78, 260),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  };

  const closeSelected = () => {
    setSelected(null);
    window.requestAnimationFrame(() => openerRef.current?.focus());
  };

  return (
    <section className={styles.section} aria-labelledby="recent-renders-title" data-recent-renders>
      <header className={styles.header}>
        <div>
          <h2 id="recent-renders-title">Recent renders</h2>
        </div>
        <div className={styles.controls} aria-label="Carousel controls">
          <button type="button" onClick={() => move(-1)} aria-label="Previous renders" disabled={!scrollable.previous}>
            ‹
          </button>
          <button type="button" onClick={() => move(1)} aria-label="Next renders" disabled={!scrollable.next}>
            ›
          </button>
        </div>
      </header>

      <div ref={trackRef} className={styles.track} data-render-track>
        {renders === undefined
          ? Array.from({ length: 3 }, (_, index) => (
              <div key={index} className={`${styles.card} ${styles.skeleton}`} aria-hidden="true" />
            ))
          : renders.map((video) => (
              <button
                type="button"
                key={video._id}
                className={styles.card}
                data-render-id={video._id}
                onClick={(event) => {
                  openerRef.current = event.currentTarget;
                  setSelected(video);
                }}
                aria-label={`Open saved video: ${video.title}`}
              >
                <div className={styles.media}>
                  <MediaPreview
                    assetKey={video.thumbnailKey ?? undefined}
                    videoStillKey={video.videoKey}
                    alt=""
                    style={{ width: "100%", height: "100%" }}
                    unavailableLabel="Retained preview unavailable"
                  />
                  <span className={styles.play} aria-hidden="true">▶</span>
                  {fmtDur(video.durationSec) ? (
                    <span className={styles.duration}>{fmtDur(video.durationSec)}</span>
                  ) : null}
                </div>
                <span className={styles.copy}>
                  <strong title={video.title}>{video.title}</strong>
                  <small>
                    <span>{video.channelName}</span>
                    {Number.isFinite(video.createdAt) ? (
                      <time dateTime={new Date(video.createdAt!).toISOString()}>
                        {renderDate.format(new Date(video.createdAt!))}
                      </time>
                    ) : null}
                  </small>
                </span>
              </button>
            ))}
      </div>

      {selected && <R2VideoDialog video={selected} onClose={closeSelected} />}
    </section>
  );
}

function R2VideoDialog({
  video,
  onClose,
}: {
  video: RenderedVideo;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [openAttempt, setOpenAttempt] = useState(0);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, video[controls], a[href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => !element.hasAttribute("disabled"));
      if (focusable.length === 0) {
        event.preventDefault();
        closeRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.dialogHeader}>
          <div>
            <span>{video.channelName}</span>
            <h2 id={titleId}>{video.title}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close video">
            ×
          </button>
        </header>

        <div className={styles.player}>
          <SavedVideoPlayback
            key={`${video.videoKey}:${openAttempt}`}
            assetKey={video.videoKey ?? ""}
            onRetry={() => {
              // Retry removes its own button; keep focus on a stable dialog control.
              closeRef.current?.focus({ preventScroll: true });
              setOpenAttempt(attempt => attempt + 1);
            }}
          />
        </div>
      </div>
    </div>
  );
}

function SavedVideoPlayback({ assetKey, onRetry }: { assetKey: string; onRetry: () => void }) {
  const asset = useAssetUrlState(assetKey);
  if (asset.status === "ready" && asset.url) {
    return <SignedVideoPlayer assetKey={assetKey} src={asset.url} controls autoPlay playsInline preload="metadata" />;
  }
  if (asset.status === "error") {
    return <div className={styles.openError} role="status">
      <span>Could not open this saved video.</span>
      <button type="button" onClick={onRetry}>Retry video</button>
    </div>;
  }
  return <span role="status">Opening video…</span>;
}
