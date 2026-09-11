"use client";
import type { VideoRow } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";
import { youtubeThumb } from "@/lib/asset-url";
import { StageBadge } from "./StageBadge";
import { ReleaseEvidenceBadge } from "./ReleaseEvidenceBadge";
import { IconLibrary } from "./icons";
import { MediaPreview } from "./MediaPreview";

function thumbnailLabel(video: VideoRow): string {
  switch (video.thumbnailPresentation) {
    case "current_golden_candidate":
      return "Current thumbnail";
    case "lofi_rendered_frame":
      return "4K master frame";
    case "lofi_frame_pending":
      return "15s frame pending";
    default:
      return video.thumbnailKey ? "Retained source" : "No thumbnail yet";
  }
}

/**
 * A single finished-video tile: 16:9 thumbnail + status badge + title (2-line
 * clamp) + channel/date + retained-master evidence. Thumbnail
 * holds space for the retained R2 image, then falls back to YouTube only if it
 * cannot be resolved or loaded.
 * Clicking opens the lightbox (handled by the parent via `onOpen`).
 */
export function VideoCard({
  video,
  onOpen,
  libraryAction,
  priority = false,
}: {
  video: VideoRow;
  onOpen?: (video: VideoRow) => void;
  libraryAction?: {
    label: string;
    busy: boolean;
    onAction: () => void;
  };
  priority?: boolean;
}) {
  const content = (
    <>
      <MediaPreview
        className="video-card-media"
        imageClassName="video-card-image"
        emptyClassName="video-card-placeholder"
        assetKey={video.thumbnailKey}
        reviewedSrc={video.reviewedThumbnailUrl}
        videoStillKey={video.thumbnailPresentation === "lofi_frame_pending" ? video.videoKey : undefined}
        // A retained key is authoritative. If its signed preview fails, show
        // an honest unavailable state rather than silently swapping in an old
        // public YouTube image and making the Library look unrefreshed.
        fallbackSrc={video.thumbnailKey || video.thumbnailPresentation === "lofi_frame_pending"
          ? undefined
          : video.youtubeVideoId ? youtubeThumb(video.youtubeVideoId) : undefined}
        fallbackSource="youtube"
        alt={video.title}
        priority={priority}
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
          <span className="video-card-thumbnail-label" data-tone={video.thumbnailPresentation ?? "retained_source"}>
            {thumbnailLabel(video)}
          </span>
          <ReleaseEvidenceBadge status={video.releaseEvidenceStatus} wrap />
        </div>
      </div>
    </>
  );

  return (
    <article className="glass video-card" data-library-state={video.libraryState ?? "active"} data-thumbnail-presentation={video.thumbnailPresentation ?? "retained_source"}>
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
