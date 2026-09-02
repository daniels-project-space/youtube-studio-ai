"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { MediaPreview } from "./MediaPreview";
import { SectionTitle } from "./PageHeader";
import { IconExternal } from "./icons";
import type { Id } from "../../convex/_generated/dataModel";

type VideoRow = {
  _id: string;
  title: string;
  channelName: string;
  channelSlug: string;
  status: string;
  youtubeVideoId?: string;
  thumbnailKey?: string | null;
  /** Retained final master. Used as a truthful still when a legacy row has no thumbnail asset. */
  videoKey?: string | null;
  durationSec?: number;
  createdAt?: number;
};

function fmtDur(s?: number): string {
  if (!s) return "";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * "Latest video" hero widget — the most recently finished video for the owner
 * (or a single channel), with the retained R2 thumbnail or a paused frame from
 * its saved master. Public YouTube artwork is deliberately never used here:
 * legacy uploads must remain visibly tied to the actual retained artifact.
 */
export function LatestVideoWidget({
  ownerId,
  channelId,
}: {
  ownerId: string;
  channelId?: Id<"channels">;
}) {
  const videos = useQuery(api.videos.listVideos, {
    ownerId,
    ...(channelId ? { channelId } : {}),
    limit: 1,
  }) as VideoRow[] | undefined;

  const v = videos?.[0];
  if (videos !== undefined && !v) return null; // nothing finished yet → hide

  return (
    <section style={{ marginBottom: "1.6rem" }}>
      <SectionTitle>Latest video</SectionTitle>
      <div
        className="glass latest-video-card"
      >
        <div className="latest-video-thumb" style={{ position: "relative", aspectRatio: "16 / 9", borderRadius: 10, overflow: "hidden" }}>
          <MediaPreview
            assetKey={v?.thumbnailKey ?? undefined}
            videoStillKey={v?.videoKey ?? undefined}
            alt={v?.title ?? "latest video"}
            style={{ width: "100%", height: "100%" }}
            unavailableLabel="Retained preview unavailable"
          />
          {v?.durationSec ? (
            <span
              style={{
                position: "absolute", right: 6, bottom: 6,
                background: "rgba(0,0,0,0.78)", color: "#fff",
                fontSize: "0.72rem", padding: "1px 6px", borderRadius: 5,
              }}
            >
              {fmtDur(v.durationSec)}
            </span>
          ) : null}
        </div>
        <div style={{ minWidth: 0, display: "grid", gap: "0.5rem" }}>
          <div style={{ fontSize: "1.05rem", fontWeight: 600, lineHeight: 1.25 }}>
            {v ? v.title : "—"}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--color-muted)" }}>
            {v?.channelName}
            {v?.status ? ` · ${v.status === "ok" ? "published" : v.status}` : ""}
          </div>
          {v?.youtubeVideoId && (
            <a
              href={`https://www.youtube.com/watch?v=${v.youtubeVideoId}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.4rem",
                width: "fit-content", fontSize: "0.85rem", fontWeight: 600,
                color: "#0a0a0b", background: "var(--color-accent)",
                padding: "0.45rem 0.85rem", borderRadius: 8,
              }}
            >
              Watch on YouTube <IconExternal width={14} height={14} />
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
