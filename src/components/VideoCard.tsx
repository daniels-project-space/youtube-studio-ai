"use client";

import { useState } from "react";
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
  // Prefer the generated R2 thumbnail (works for private drafts AND surfaces the
  // branded claude_flux thumbnail); fall back to the public YouTube image only
  // when no thumbnail was stored. On any load error, drop to the placeholder —
  // private-draft YouTube thumbs 404, so without this they'd show broken images.
  const r2Thumb = useAssetUrl(video.thumbnailKey);
  const [errored, setErrored] = useState(false);
  const thumbSrc = errored
    ? null
    : video.thumbnailKey
      ? r2Thumb
      : video.youtubeVideoId
        ? youtubeThumb(video.youtubeVideoId)
        : null;

  const views = fmtViews(video.estimatedViews);

  return (
    <button
      type="button"
      onClick={() => onOpen?.(video)}
      className="glass video-card"
    >
      {/* 16:9 thumbnail */}
      <div className="video-card-media">
        {thumbSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbSrc}
            alt={video.title}
            loading="lazy"
            onError={() => setErrored(true)}
            className="video-card-image"
          />
        ) : (
          <span className="video-card-placeholder">
            <IconLibrary width={28} height={28} />
          </span>
        )}

        {/* Status badge, top-left */}
        <span className="video-card-badge">
          <StageBadge status={video.status} size="sm" />
        </span>
      </div>

      {/* Body */}
      <div className="video-card-body">
        <h3>
          {video.title}
        </h3>
        <div className="video-card-meta">
          <span>
            {video.channelName}
          </span>
          <time>
            {fmtDateTime(video.createdAt)}
          </time>
        </div>
        {views && (
          <div className="video-card-views">
            ~{views} est. views
          </div>
        )}
      </div>
    </button>
  );
}
