"use client";

import type { VideoRow } from "@/lib/types";
import { VideoCard } from "./VideoCard";

/** Responsive grid of VideoCards. Auto-fills 240px+ columns. */
export function VideoGrid({
  videos,
  onOpen,
}: {
  videos: VideoRow[];
  onOpen?: (video: VideoRow) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
        gap: "1rem",
      }}
    >
      {videos.map((v) => (
        <VideoCard key={v._id} video={v} onOpen={onOpen} />
      ))}
    </div>
  );
}
