"use client";

import type { VideoRow } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";
import {
  youtubeThumb,
  useAssetUrl,
  fmtViews,
} from "@/lib/asset-url";
import { StageBadge } from "./StageBadge";
import { IconLibrary } from "./icons";

/**
 * A single finished-video tile: 16:9 thumbnail + status badge + title (2-line
 * clamp) + channel/date + an estimated-views line when present. Thumbnail
 * prefers the free YouTube image; falls back to a presigned R2 thumbnail.
 * Clicking opens the lightbox (handled by the parent via `onOpen`).
 */
export function VideoCard({
  video,
  onOpen,
}: {
  video: VideoRow;
  onOpen?: (video: VideoRow) => void;
}) {
  // YouTube thumb is free (no presign). Only presign R2 when there's no
  // youtubeVideoId — the hook no-ops on a null key.
  const r2Thumb = useAssetUrl(
    video.youtubeVideoId ? null : video.thumbnailKey,
  );
  const thumbSrc = video.youtubeVideoId
    ? youtubeThumb(video.youtubeVideoId)
    : r2Thumb;

  const views = fmtViews(video.estimatedViews);

  return (
    <button
      type="button"
      onClick={() => onOpen?.(video)}
      className="glass glass-shine lift"
      style={{
        display: "block",
        textAlign: "left",
        padding: 0,
        overflow: "hidden",
        cursor: "pointer",
        font: "inherit",
        color: "inherit",
        width: "100%",
      }}
    >
      {/* 16:9 thumbnail */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "16 / 9",
          background:
            "linear-gradient(135deg, var(--color-surface-solid), #101013)",
          overflow: "hidden",
        }}
      >
        {thumbSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbSrc}
            alt={video.title}
            loading="lazy"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : (
          <span
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              color: "var(--color-faint)",
            }}
          >
            <IconLibrary width={28} height={28} />
          </span>
        )}

        {/* Status badge, top-left */}
        <span style={{ position: "absolute", top: 8, left: 8 }}>
          <StageBadge status={video.status} size="sm" />
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: "0.8rem 0.9rem 0.95rem", display: "grid", gap: "0.4rem" }}>
        <h3
          style={{
            fontSize: "0.92rem",
            fontWeight: 600,
            lineHeight: 1.35,
            margin: 0,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {video.title}
        </h3>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.6rem",
            fontSize: "0.76rem",
            color: "var(--color-faint)",
          }}
        >
          <span
            style={{
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {video.channelName}
          </span>
          <span style={{ whiteSpace: "nowrap" }}>
            {fmtDateTime(video.createdAt)}
          </span>
        </div>
        {views && (
          <div
            style={{
              fontSize: "0.74rem",
              color: "var(--color-secondary)",
              fontFamily: "var(--font-mono)",
            }}
          >
            ~{views} est. views
          </div>
        )}
      </div>
    </button>
  );
}
