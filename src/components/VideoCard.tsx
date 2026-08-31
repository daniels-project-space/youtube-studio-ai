"use client";
import type { VideoRow } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";
import {
  youtubeThumb,
  fmtViews,
} from "@/lib/asset-url";
import { StageBadge } from "./StageBadge";
import { ReleaseEvidenceBadge } from "./ReleaseEvidenceBadge";
import { IconLibrary } from "./icons";
import { MediaPreview } from "./MediaPreview";

/**
 * A single finished-video tile: 16:9 thumbnail + status badge + title (2-line
 * clamp) + channel/date + an estimated-views line when present. Thumbnail
 * holds space for the retained R2 image, then falls back to YouTube only if it
 * cannot be resolved or loaded.
 * Clicking opens the lightbox (handled by the parent via `onOpen`).
 */
export function VideoCard({
  video,
  onOpen,
}: {
  video: VideoRow;
  onOpen?: (video: VideoRow) => void;
}) {
  const views = fmtViews(video.estimatedViews);

  return (
    <button
      type="button"
      onClick={() => onOpen?.(video)}
      className="glass video-card"
    >
      {/* 16:9 thumbnail */}
      <MediaPreview
        className="video-card-media"
        imageClassName="video-card-image"
        emptyClassName="video-card-placeholder"
        assetKey={video.thumbnailKey}
        fallbackSrc={video.youtubeVideoId ? youtubeThumb(video.youtubeVideoId) : undefined}
        fallbackSource="youtube"
        alt={video.title}
        emptyContent={<IconLibrary width={28} height={28} />}
        overlay={() => (
          <span className="video-card-badge">
            <StageBadge status={video.status} size="sm" />
          </span>
        )}
      />

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
        <div className="video-card-evidence">
          <span className="video-card-evidence-label">Master evidence</span>
          <ReleaseEvidenceBadge status={video.releaseEvidenceStatus} />
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
