"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useAssetUrlState } from "@/lib/asset-url";
import { AssetImg } from "./AssetImg";
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
  if (!seconds) return "";
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  return `${minutes}:${String(rounded % 60).padStart(2, "0")}`;
}

/** Recent rendered masters. Cards always open the saved R2 video, never YouTube. */
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
  const videos = useQuery(api.videos.listVideos, {
    ownerId,
    ...(channelId ? { channelId } : {}),
    limit,
  }) as RenderedVideo[] | undefined;

  const renders = videos?.filter(
    (video): video is RenderedVideo & { videoKey: string } => Boolean(video.videoKey),
  );

  if (renders !== undefined && renders.length === 0) return null;

  const move = (direction: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({
      left: direction * Math.max(track.clientWidth * 0.78, 260),
      behavior: "smooth",
    });
  };

  const closeSelected = () => {
    setSelected(null);
    window.requestAnimationFrame(() => openerRef.current?.focus());
  };

  return (
    <section className={styles.section} aria-labelledby="recent-renders-title">
      <header className={styles.header}>
        <div>
          <h2 id="recent-renders-title">Recent renders</h2>
          <span>R2 masters</span>
        </div>
        <div className={styles.controls} aria-label="Carousel controls">
          <button type="button" onClick={() => move(-1)} aria-label="Previous renders">
            ‹
          </button>
          <button type="button" onClick={() => move(1)} aria-label="Next renders">
            ›
          </button>
        </div>
      </header>

      <div ref={trackRef} className={styles.track}>
        {renders === undefined
          ? Array.from({ length: 3 }, (_, index) => (
              <div key={index} className={`${styles.card} ${styles.skeleton}`} aria-hidden="true" />
            ))
          : renders.map((video) => (
              <button
                type="button"
                key={video._id}
                className={styles.card}
                onClick={(event) => {
                  openerRef.current = event.currentTarget;
                  setSelected(video);
                }}
                aria-label={`Open R2 render: ${video.title}`}
              >
                <div className={styles.media}>
                  <AssetImg
                    k={video.thumbnailKey ?? undefined}
                    alt=""
                    fallbackSrc={
                      video.youtubeVideoId
                        ? `https://i.ytimg.com/vi/${video.youtubeVideoId}/hqdefault.jpg`
                        : undefined
                    }
                    fallbackSource="youtube"
                    style={{ width: "100%", height: "100%" }}
                  />
                  <span className={styles.play} aria-hidden="true">▶</span>
                  {video.durationSec ? (
                    <span className={styles.duration}>{fmtDur(video.durationSec)}</span>
                  ) : null}
                </div>
                <span className={styles.copy}>
                  <strong>{video.title}</strong>
                  <small>
                    {video.channelName}
                    {video.createdAt ? ` · ${renderDate.format(new Date(video.createdAt))}` : ""}
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
  const asset = useAssetUrlState(video.videoKey);

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
            <span>{video.channelName} · R2 master</span>
            <h2 id={titleId}>{video.title}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close video">
            ×
          </button>
        </header>

        <div className={styles.player}>
          {asset.status === "ready" && asset.url ? (
            <video src={asset.url} controls autoPlay playsInline preload="metadata" />
          ) : asset.status === "error" ? (
            <span>Could not open this R2 master.</span>
          ) : (
            <span>Opening R2 master…</span>
          )}
        </div>
      </div>
    </div>
  );
}
