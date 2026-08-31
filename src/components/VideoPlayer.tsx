"use client";

import type { VideoRow } from "@/lib/types";
import { youtubeEmbed, useAssetUrl } from "@/lib/asset-url";

/**
 * 16:9 player. YouTube embed iframe when the video is published; otherwise a
 * presigned R2 `<video controls>` element (key resolved server-side). Shows a
 * neutral panel when neither source is available.
 */
export function VideoPlayer({
  video,
  embedTabIndex,
}: {
  video: VideoRow;
  /** Cross-origin embeds inside a modal may opt out of its keyboard loop. */
  embedTabIndex?: number;
}) {
  // Presign the R2 video only when there's no YouTube id (hook no-ops on null).
  const r2Video = useAssetUrl(video.youtubeVideoId ? null : video.videoKey);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16 / 9",
        borderRadius: 12,
        overflow: "hidden",
        background: "#000",
      }}
    >
      {video.youtubeVideoId ? (
        <iframe
          src={youtubeEmbed(video.youtubeVideoId)}
          title={video.title}
          tabIndex={embedTabIndex}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            border: "none",
          }}
        />
      ) : r2Video ? (

        <video
          src={r2Video}
          controls
          playsInline
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            background: "#000",
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
            fontSize: "0.85rem",
          }}
        >
          No playable source
        </span>
      )}
    </div>
  );
}
