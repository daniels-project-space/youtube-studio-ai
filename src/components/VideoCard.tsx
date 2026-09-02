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
  libraryAction,
}: {
  video: VideoRow;
  onOpen?: (video: VideoRow) => void;
  libraryAction?: {
    label: string;
    busy: boolean;
    onAction: () => void;
  };
}) {
  const views = fmtViews(video.estimatedViews);

  const content = (
    <>
      <MediaPreview
        className="video-card-media"
        imageClassName="video-card-image"
        emptyClassName="video-card-placeholder"
        assetKey={video.thumbnailKey}
        reviewedSrc={video.reviewedThumbnailUrl}
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

      <div className="video-card-body">
        <h3>{video.title}</h3>
        <div className="video-card-meta">
          <span>{video.channelName}</span>
          <time>{fmtDateTime(video.createdAt)}</time>
        </div>
        <div className="video-card-evidence">
          <span className="video-card-evidence-label">Master evidence</span>
          <ReleaseEvidenceBadge status={video.releaseEvidenceStatus} />
        </div>
        {views && <div className="video-card-views">~{views} est. views</div>}
      </div>
    </>
  );

  return (
    <article className="glass video-card" data-library-state={video.libraryState ?? "active"}>
      {onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(video)}
          className="video-card-open"
          aria-label={`Open ${video.title}`}
        >
          {content}
        </button>
      ) : (
        <div className="video-card-open">{content}</div>
      )}
      {libraryAction ? (
        <footer className="video-card-footer">
          <span>{video.libraryState === "archived" ? "Out of the active library" : "Active collection"}</span>
          <button
            type="button"
            className="video-card-library-action"
            onClick={libraryAction.onAction}
            disabled={libraryAction.busy}
          >
            {libraryAction.busy ? "Updating…" : libraryAction.label}
          </button>
        </footer>
      ) : null}
    </article>
  );
}
