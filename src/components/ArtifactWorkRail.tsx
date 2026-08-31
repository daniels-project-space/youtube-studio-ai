"use client";

import { useId, type ReactNode } from "react";
import type { VideoRow } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";
import { fmtViews, youtubeThumb } from "@/lib/asset-url";
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
          {visible.map((video) => (
            <ArtifactCard key={video._id} video={video} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}

function ArtifactCard({
  video,
  onOpen,
}: {
  video: VideoRow;
  onOpen?: (video: VideoRow) => void;
}) {
  const views = fmtViews(video.estimatedViews);
  const cardContent = (
    <>
      <MediaPreview
        className={styles.media}
        emptyClassName={styles.mediaFallback}
        assetKey={video.thumbnailKey}
        fallbackSrc={video.youtubeVideoId ? youtubeThumb(video.youtubeVideoId) : undefined}
        fallbackSource="youtube"
        alt={video.title}
        overlay={({ source, state }) => (
          <div className={styles.mediaBadges}>
            <StageBadge status={video.status} size="sm" />
            {state === "ready" && source !== "unavailable" && (
              <span className={styles.sourceBadge}>
                {source === "r2" ? "R2 preview" : source === "youtube" ? "YouTube preview" : "Public preview"}
              </span>
            )}
          </div>
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
          <ReleaseEvidenceBadge status={video.releaseEvidenceStatus} />
        </div>
        {views && <span className={styles.views}>~{views} est. views</span>}
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
