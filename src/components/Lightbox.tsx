"use client";

import { useCallback, useEffect } from "react";
import type { VideoRow } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";
import {
  youtubeThumb,
  useAssetUrl,
  fmtViews,
} from "@/lib/asset-url";
import { VideoPlayer } from "./VideoPlayer";
import { StageBadge } from "./StageBadge";
import { IconChevron, IconExternal, IconSpark } from "./icons";

/**
 * Full-screen lightbox over a list of videos (project-hub style: dark backdrop
 * blur, large centered player, prev/next, caption, a thumbnail filmstrip).
 * `videos` is the already-scoped set (current channel group) so prev/next
 * stays within that channel. Surfaces the claude_flux thumbnail intelligence
 * (thumbnailTitle + visualRationale) when present.
 */
export function Lightbox({
  videos,
  index,
  onIndex,
  onClose,
}: {
  videos: VideoRow[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const video = videos[index];
  const count = videos.length;

  const prev = useCallback(
    () => onIndex((index - 1 + count) % count),
    [index, count, onIndex],
  );
  const next = useCallback(
    () => onIndex((index + 1) % count),
    [index, count, onIndex],
  );

  // Keyboard: Esc closes, arrows navigate. Lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [prev, next, onClose]);

  if (!video) return null;

  const views = fmtViews(video.estimatedViews);
  const hasIntel = Boolean(video.thumbnailTitle || video.visualRationale);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "grid",
        placeItems: "center",
        padding: "clamp(1rem, 4vw, 3rem)",
        background: "rgba(6, 6, 8, 0.78)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
      }}
    >
      {/* Stop propagation so clicks inside don't close */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass"
        style={{
          width: "min(960px, 100%)",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "1.1rem 1.2rem 1.3rem",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-lift)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "1rem",
            marginBottom: "0.9rem",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
                marginBottom: "0.35rem",
              }}
            >
              <StageBadge status={video.status} size="sm" />
              <span style={{ fontSize: "0.78rem", color: "var(--color-faint)" }}>
                {video.channelName} · {fmtDateTime(video.createdAt)}
              </span>
            </div>
            <h2
              style={{
                fontSize: "1.15rem",
                fontWeight: 600,
                lineHeight: 1.3,
                margin: 0,
              }}
            >
              {video.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              flexShrink: 0,
              width: 32,
              height: 32,
              borderRadius: 8,
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              color: "var(--color-muted)",
              cursor: "pointer",
              fontSize: "1.1rem",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Player + prev/next */}
        <div style={{ position: "relative" }}>
          <VideoPlayer video={video} />
          {count > 1 && (
            <>
              <NavArrow side="left" onClick={prev} />
              <NavArrow side="right" onClick={next} />
            </>
          )}
        </div>

        {/* Caption / meta row */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "1.1rem",
            marginTop: "0.85rem",
            fontSize: "0.8rem",
            color: "var(--color-muted)",
          }}
        >
          {views && (
            <span style={{ color: "var(--color-secondary)" }}>
              ~{views} est. views
              {video.estimatedViewsSource ? ` · ${video.estimatedViewsSource}` : ""}
            </span>
          )}
          {video.youtubeVideoId && (
            <a
              href={`https://www.youtube.com/watch?v=${video.youtubeVideoId}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.3rem",
                color: "var(--color-accent)",
              }}
            >
              Watch on YouTube <IconExternal width={13} height={13} />
            </a>
          )}
          {count > 1 && (
            <span style={{ marginLeft: "auto", color: "var(--color-faint)" }}>
              {index + 1} / {count}
            </span>
          )}
        </div>

        {/* Thumbnail intelligence (claude_flux) */}
        {hasIntel && (
          <div
            className="glass-shine"
            style={{
              marginTop: "1rem",
              padding: "0.9rem 1rem",
              borderRadius: 12,
              border:
                "1px solid color-mix(in srgb, var(--color-accent) 24%, transparent)",
              background: "var(--color-accent-soft)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.45rem",
                fontSize: "0.72rem",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: "var(--color-accent)",
                marginBottom: "0.5rem",
              }}
            >
              <IconSpark width={14} height={14} /> Thumbnail intelligence
            </div>
            {video.thumbnailTitle && (
              <div
                style={{
                  fontWeight: 600,
                  fontSize: "0.95rem",
                  marginBottom: video.visualRationale ? "0.35rem" : 0,
                }}
              >
                “{video.thumbnailTitle}”
              </div>
            )}
            {video.visualRationale && (
              <p
                style={{
                  margin: 0,
                  fontSize: "0.85rem",
                  lineHeight: 1.55,
                  color: "var(--color-muted)",
                }}
              >
                {video.visualRationale}
              </p>
            )}
          </div>
        )}

        {/* Filmstrip */}
        {count > 1 && (
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              overflowX: "auto",
              marginTop: "1rem",
              paddingBottom: "0.25rem",
            }}
          >
            {videos.map((v, i) => (
              <FilmstripThumb
                key={v._id}
                video={v}
                active={i === index}
                onClick={() => onIndex(i)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NavArrow({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous" : "Next"}
      style={{
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        [side]: 8,
        width: 38,
        height: 38,
        display: "grid",
        placeItems: "center",
        borderRadius: "50%",
        border: "1px solid var(--color-border-strong)",
        background: "rgba(10, 10, 11, 0.65)",
        backdropFilter: "blur(6px)",
        color: "var(--color-fg)",
        cursor: "pointer",
      }}
    >
      <IconChevron
        width={18}
        height={18}
        style={{ transform: `rotate(${side === "left" ? 90 : -90}deg)` }}
      />
    </button>
  );
}

function FilmstripThumb({
  video,
  active,
  onClick,
}: {
  video: VideoRow;
  active: boolean;
  onClick: () => void;
}) {
  const r2Thumb = useAssetUrl(video.youtubeVideoId ? null : video.thumbnailKey);
  const src = video.youtubeVideoId
    ? youtubeThumb(video.youtubeVideoId)
    : r2Thumb;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Go to ${video.title}`}
      style={{
        flexShrink: 0,
        width: 104,
        aspectRatio: "16 / 9",
        borderRadius: 8,
        overflow: "hidden",
        padding: 0,
        cursor: "pointer",
        background: "var(--color-surface-solid)",
        border: `2px solid ${active ? "var(--color-accent)" : "transparent"}`,
        opacity: active ? 1 : 0.6,
      }}
    >
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={video.title}
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}
    </button>
  );
}
