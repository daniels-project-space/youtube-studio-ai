"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { VideoRow } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";
import {
  youtubeThumb,
  useAssetUrl,
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
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // On-demand detail (full SEO description, tags, narration script) — a small
  // targeted query so the list payload stays lean.
  const detail = useQuery(
    api.videos.getVideoDetail,
    video ? { runId: video._id as Id<"runs"> } : "skip",
  );
  const [scriptOpen, setScriptOpen] = useState(false);

  const prev = useCallback(
    () => onIndex((index - 1 + count) % count),
    [index, count, onIndex],
  );
  const next = useCallback(
    () => onIndex((index + 1) % count),
    [index, count, onIndex],
  );

  // Preserve where review started, then move focus into the modal. This keeps
  // the real artifact inspection flow usable without a pointer.
  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => openerRef.current?.focus();
  }, []);

  // Keyboard: Esc closes, arrows navigate, Tab remains in the dialog. Lock
  // body scroll while the evidence review surface is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        // Native playback, sliders and editable controls own their arrow keys.
        // Switching clips here would interrupt seeking and discard media focus.
        const target = e.target;
        if (e.defaultPrevented || (target instanceof HTMLElement &&
          (target.isContentEditable || target.closest("video, audio, input, textarea, select, [role='slider']")))) return;
        e.preventDefault();
        if (e.key === "ArrowLeft") prev();
        else next();
        return;
      }
      if (e.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, video[controls], a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => !element.hasAttribute("disabled"));
      if (focusable.length === 0) {
        e.preventDefault();
        closeRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
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

  const hasIntel = Boolean(video.thumbnailTitle || video.visualRationale);

  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "grid",
        placeItems: "center",
        padding: "clamp(12px, 3vw, 32px)",
        background: "rgba(6, 6, 8, 0.78)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
      }}
    >
      {/* Stop propagation so clicks inside don't close */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
        className="glass"
        style={{
          width: "min(960px, 100%)",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "clamp(12px, 2vw, 20px)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-lift)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 44px",
            alignItems: "start",
            gap: "0.5rem 0.75rem",
            marginBottom: "0.9rem",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "0.6rem",
                marginBottom: "0.35rem",
              }}
            >
              <StageBadge status={video.status} size="sm" />
              <span style={{ fontSize: "0.8125rem", color: "var(--color-muted)", overflowWrap: "anywhere" }}>
                {video.channelName} · {fmtDateTime(video.createdAt)}
              </span>
            </div>
          </div>
          <h2
              id={titleId}
              style={{
                gridColumn: "1 / -1",
                gridRow: 2,
                fontSize: "1.15rem",
                fontWeight: 600,
                lineHeight: 1.3,
                margin: 0,
                overflowWrap: "anywhere",
              }}
            >
              {detail?.title ?? video.title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              gridColumn: 2,
              gridRow: 1,
              flexShrink: 0,
              width: 44,
              height: 44,
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

        {/* Keep cross-origin embeds out of the modal's tab loop. The adjacent
            YouTube link remains accessible without trapping Escape in an iframe. */}
        <VideoPlayer video={video} embedTabIndex={-1} />

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
            <div role="group" aria-label="Video navigation" style={{
              display: "flex", alignItems: "center", gap: "0.5rem", marginLeft: "auto",
            }}>
              <NavArrow side="left" onClick={prev} />
              <span style={{ color: "var(--color-muted)", whiteSpace: "nowrap" }}>
                {index + 1} / {count}
              </span>
              <NavArrow side="right" onClick={next} />
            </div>
          )}
        </div>

        {/* SEO description (full text, scrollable) */}
        {detail?.description && (
          <div style={{ marginTop: "1rem" }}>
            <div
              style={{
                fontSize: "0.72rem",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: "var(--color-faint)",
                marginBottom: "0.45rem",
              }}
            >
              Description
            </div>
            <div
              style={{
                maxHeight: 200,
                overflowY: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: "0.85rem",
                lineHeight: 1.55,
                color: "var(--color-muted)",
                padding: "0.75rem 0.9rem",
                borderRadius: 10,
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
              }}
            >
              {detail.description}
            </div>
          </div>
        )}

        {/* SEO tags */}
        {(detail?.tags?.length ?? 0) > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.4rem",
              marginTop: "0.75rem",
            }}
          >
            {detail!.tags.map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: "0.72rem",
                  fontWeight: 500,
                  padding: "0.12rem 0.55rem",
                  borderRadius: 999,
                  color: "var(--color-muted)",
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  whiteSpace: "normal",
                  minWidth: 0,
                  maxWidth: "100%",
                  overflowWrap: "anywhere",
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Narration script (collapsible) */}
        {detail?.script && (
          <div style={{ marginTop: "1rem" }}>
            <button
              type="button"
              onClick={() => setScriptOpen((o) => !o)}
              aria-expanded={scriptOpen}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                font: "inherit",
                fontSize: "0.72rem",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: "var(--color-faint)",
              }}
            >
              <IconChevron
                width={13}
                height={13}
                style={{
                  transform: scriptOpen ? "none" : "rotate(-90deg)",
                  transition: "transform 0.15s ease",
                }}
              />
              Script
            </button>
            {scriptOpen && (
              <div
                style={{
                  marginTop: "0.45rem",
                  maxHeight: 280,
                  overflowY: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontSize: "0.85rem",
                  lineHeight: 1.6,
                  color: "var(--color-muted)",
                  padding: "0.75rem 0.9rem",
                  borderRadius: 10,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                }}
              >
                {detail.script}
              </div>
            )}
          </div>
        )}

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
        flexShrink: 0,
        width: 44,
        height: 44,
        display: "grid",
        placeItems: "center",
        borderRadius: 8,
        border: "1px solid var(--color-border-strong)",
        background: "var(--color-surface)",
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
  const r2Thumb = useAssetUrl(video.thumbnailKey);
  const [errored, setErrored] = useState(false);
  const src = errored
    ? null
    : video.thumbnailKey
      ? r2Thumb
      : video.youtubeVideoId
        ? youtubeThumb(video.youtubeVideoId)
        : null;
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
          onError={() => setErrored(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}
    </button>
  );
}
