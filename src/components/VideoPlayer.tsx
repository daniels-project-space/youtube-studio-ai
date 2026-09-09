"use client";

import { useRef, useState } from "react";
import type { VideoRow } from "@/lib/types";
import { youtubeEmbed, useAssetUrlState } from "@/lib/asset-url";
import { SignedVideoPlayer } from "./SignedVideoPlayer";
import styles from "./VideoPlayer.module.css";

/**
 * Preview the saved master, including private uploads. YouTube is a fallback
 * only for legacy records without a saved key, never for a failed signing request.
 */
export function VideoPlayer({
  video,
  embedTabIndex,
}: {
  video: VideoRow;
  /** Cross-origin embeds inside a modal may opt out of its keyboard loop. */
  embedTabIndex?: number;
}) {
  return (
    <div className={styles.frame}>
      {video.videoKey ? (
        <SavedMaster key={video.videoKey} assetKey={video.videoKey} title={video.title} />
      ) : video.youtubeVideoId ? (
        <iframe
          src={youtubeEmbed(video.youtubeVideoId)}
          title={video.title}
          tabIndex={embedTabIndex}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className={styles.embed}
        />
      ) : (
        <div className={styles.message}>No playable source</div>
      )}
    </div>
  );
}

function SavedMaster({ assetKey, title }: { assetKey: string; title: string }) {
  const [attempt, setAttempt] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);
  return (
    <div className={styles.saved} ref={frameRef} tabIndex={-1} aria-label={title}>
      <SavedMasterSource key={attempt} assetKey={assetKey} title={title} onRetry={() => {
        // Keep focus inside the dialog while its temporary Retry button unmounts.
        // Only the source loader resets; siblings and the shared cache stay intact.
        frameRef.current?.focus({ preventScroll: true });
        setAttempt(value => value + 1);
      }} />
    </div>
  );
}

function SavedMasterSource({ assetKey, title, onRetry }: {
  assetKey: string; title: string; onRetry: () => void;
}) {
  const source = useAssetUrlState(assetKey);
  if (source.url) return <SignedVideoPlayer assetKey={assetKey} src={source.url}
    aria-label={title} controls playsInline preload="metadata" />;
  return (
    <div className={styles.message}>
      <span role="status">{source.status === "error" ? "Video couldn't load." : "Loading video…"}</span>
      {source.status === "error" && <button type="button" onClick={onRetry}>Retry video</button>}
    </div>
  );
}
