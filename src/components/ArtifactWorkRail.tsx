"use client";

import { useId, type ReactNode } from "react";
import type { VideoRow } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";
import { youtubeThumb } from "@/lib/asset-url";
import { ReleaseEvidenceBadge } from "./ReleaseEvidenceBadge";
import { StageBadge } from "./StageBadge";
import { MediaPreview } from "./MediaPreview";
import styles from "./ArtifactWorkRail.module.css";

/**
 * A compact, artifact-first view of persisted video output.  It deliberately
 * consumes the same finished-video rows as the Library: every preview is a
 * stored master/draft asset or a linked YouTube video, never a mock campaign
 * card or a forecast passed off as published work.
 */
export function ArtifactWorkRail({
  videos,
  onOpen,
  title = "Recent output",
  eyebrow = "Actual video artifacts",
  description,
  action,
  emptyMessage = "No rendered or uploaded video artifacts match this view yet.",
  maxItems = 4,
}: {
  videos: VideoRow[] | undefined;
  onOpen?: (video: VideoRow) => void;
  title?: string;
  eyebrow?: string;
  description?: string;
  action?: ReactNode;
  emptyMessage?: string;
  maxItems?: number;
}) {
  const headingId = useId();
  const visible = videos?.slice(0, maxItems) ?? [];

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.header}>
        <div className={styles.headingGroup}>
          <span className={styles.eyebrow}>{eyebrow}</span>
          <h2 id={headingId} className={styles.heading}>{title}</h2>
          {description && <p className={styles.description}>{description}</p>}
        </div>
        {action && <div className={styles.action}>{action}</div>}
      </div>

      {videos === undefined ? (
        <div
          className={styles.rail}
          aria-label={`Loading ${title} video artifacts`}
          aria-busy="true"
          tabIndex={0}
        >
          {Array.from({ length: Math.min(maxItems, 4) }, (_, index) => (
            <div key={index} className={styles.loadingCard} />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className={styles.empty}>{emptyMessage}</div>
      ) : (
        <div
          className={styles.rail}
          aria-label={`${title} video artifacts`}
          tabIndex={0}
        >
          {visible.map((video, index) => (
            <ArtifactCard key={video._id} video={video} onOpen={onOpen} priority={index < 3} />
          ))}
        </div>
      )}
    </section>
  );
}

function ArtifactCard({
  video,
  onOpen,
  priority = false,
}: {
  video: VideoRow;
  onOpen?: (video: VideoRow) => void;
  priority?: boolean;
}) {
  const cardContent = (
    <>
      <MediaPreview
        className={styles.media}
        emptyClassName={styles.mediaFallback}
        assetKey={video.thumbnailKey}
        reviewedSrc={video.reviewedThumbnailUrl}
        videoStillKey={video.thumbnailPresentation === "lofi_frame_pending" ? video.videoKey : undefined}
        // Never mask a retained/current candidate with stale public artwork.
        // YouTube is a fallback only for rows that have no retained key.
        fallbackSrc={video.thumbnailKey || video.thumbnailPresentation === "lofi_frame_pending"
          ? undefined
          : video.youtubeVideoId ? youtubeThumb(video.youtubeVideoId) : undefined}
        fallbackSource="youtube"
        alt={video.title}
        priority={priority}
        overlay={({ source, state }) => (
          <>
            <div className={styles.mediaBadges}>
              <StageBadge status={video.status} size="sm" />
              {state === "ready" && source !== "unavailable" && (
                <span className={styles.sourceBadge}>
                  {source === "reviewed" ? "Reviewed" : source === "r2" ? "Saved" : source === "youtube" ? "YouTube" : "Public"}
                </span>
              )}
            </div>
            {video.thumbnailPresentation === "lofi_rendered_frame" || video.thumbnailPresentation === "lofi_frame_pending" ? (
              <span className={styles.lofiQualityBadge} aria-label="4K source-frame thumbnail">4K</span>
            ) : null}
          </>
        )}
      />
      <div className={styles.body}>
        <h3 className={styles.title}>{video.title}</h3>
        <div className={styles.metadata}>
          <span title={video.channelName}>{video.channelName}</span>
          <time dateTime={new Date(video.createdAt).toISOString()}>{fmtDateTime(video.createdAt)}</time>
        </div>
        <div className={styles.proof}>
          <span className={styles.proofLabel}>Master evidence</span>
          <ReleaseEvidenceBadge status={video.releaseEvidenceStatus} wrap />
        </div>
      </div>
    </>
  );

  if (!onOpen) {
    return <article className={styles.card}>{cardContent}</article>;
  }

  return (
    <button
      type="button"
      className={styles.card}
      onClick={() => onOpen(video)}
      aria-label={`Open ${video.title}`}
    >
      {cardContent}
    </button>
  );
}
