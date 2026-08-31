"use client";

import type { VideoRow } from "@/lib/types";
import { VideoCard } from "./VideoCard";

/** Responsive compact grid of finished-video cards. */
export function VideoGrid({
  videos,
  onOpen,
  libraryAction,
}: {
  videos: VideoRow[];
  onOpen?: (video: VideoRow) => void;
  libraryAction?: {
    label: string;
    busyIds?: ReadonlySet<string>;
    onAction: (video: VideoRow) => void;
  };
}) {
  return (
    <div className="video-grid">
      {videos.map((v) => (
        <VideoCard
          key={v._id}
          video={v}
          onOpen={onOpen}
          libraryAction={libraryAction ? {
            label: libraryAction.label,
            busy: libraryAction.busyIds?.has(v._id) ?? false,
            onAction: () => libraryAction.onAction(v),
          } : undefined}
        />
      ))}
    </div>
  );
}
