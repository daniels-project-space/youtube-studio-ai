"use client";

import type { VideoRow } from "@/lib/types";
import { VideoCard } from "./VideoCard";

/** Responsive compact grid of finished-video cards. */
export function VideoGrid({
  videos,
  onOpen,
}: {
  videos: VideoRow[];
  onOpen?: (video: VideoRow) => void;
}) {
  return (
    <div className="video-grid">
      {videos.map((v) => (
        <VideoCard key={v._id} video={v} onOpen={onOpen} />
      ))}
    </div>
  );
}
