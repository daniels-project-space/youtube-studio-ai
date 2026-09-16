"use client";

import type { VideoRow } from "@/lib/types";
import { VideoCard } from "./VideoCard";

/** Responsive compact grid of finished-video cards. */
export function VideoGrid({
  videos,
  onOpen,
  libraryAction,
  selection,
  density = "regular",
}: {
  videos: VideoRow[];
  onOpen?: (video: VideoRow) => void;
  /** Library uses a denser review surface; channel pages retain the fuller card. */
  density?: "regular" | "library";
  libraryAction?: {
    label: string;
    busyIds?: ReadonlySet<string>;
    onAction: (video: VideoRow) => void;
  };
  selection?: {
    selectedIds: ReadonlySet<string>;
    onToggle: (video: VideoRow) => void;
  };
}) {
  return (
    <div className="video-grid" data-density={density}>
      {videos.map((v, index) => (
        <VideoCard
          key={v._id}
          video={v}
          priority={index < 4}
          onOpen={onOpen}
          compact={density === "library"}
          libraryAction={libraryAction ? {
            label: libraryAction.label,
            busy: libraryAction.busyIds?.has(v._id) ?? false,
            onAction: () => libraryAction.onAction(v),
            } : undefined}
          selection={selection ? {
            selected: selection.selectedIds.has(v._id),
            onToggle: () => selection.onToggle(v),
          } : undefined}
        />
      ))}
    </div>
  );
}
