"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { AssetImg } from "./AssetImg";
import { SectionTitle } from "./PageHeader";
import type { Id } from "../../convex/_generated/dataModel";

type V = {
  _id: string;
  title: string;
  channelName: string;
  youtubeVideoId?: string;
  thumbnailKey?: string | null;
  durationSec?: number;
};

function fmtDur(s?: number) {
  if (!s) return "";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}

/** A strip of the N most recently finished videos (R2 thumbnails, watch links). */
export function RecentVideos({
  ownerId,
  channelId,
  limit = 5,
}: {
  ownerId: string;
  channelId?: Id<"channels">;
  limit?: number;
}) {
  const videos = useQuery(api.videos.listVideos, {
    ownerId,
    ...(channelId ? { channelId } : {}),
    limit,
  }) as V[] | undefined;

  if (videos !== undefined && videos.length === 0) return null;

  const cells: (V | null)[] = videos ?? Array.from({ length: limit }, () => null);

  return (
    <section style={{ marginBottom: "1.8rem" }}>
      <SectionTitle>Recent videos</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "0.85rem" }}>
        {cells.map((v, i) => {
          const card = (
            <>
              <div style={{ position: "relative", aspectRatio: "16 / 9", borderRadius: 10, overflow: "hidden" }}>
                <AssetImg
                  k={v?.thumbnailKey ?? undefined}
                  alt={v?.title ?? "video"}
                  fallbackSrc={v?.youtubeVideoId ? `https://i.ytimg.com/vi/${v.youtubeVideoId}/hqdefault.jpg` : undefined}
                  style={{ width: "100%", height: "100%" }}
                />
                {v?.durationSec ? (
                  <span style={{ position: "absolute", right: 6, bottom: 6, background: "rgba(0,0,0,0.78)", color: "#fff", fontSize: "0.7rem", padding: "1px 6px", borderRadius: 5 }}>
                    {fmtDur(v.durationSec)}
                  </span>
                ) : null}
              </div>
              <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", fontWeight: 500, lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {v ? v.title : "—"}
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--color-muted)", marginTop: 2 }}>{v?.channelName ?? ""}</div>
            </>
          );
          return v?.youtubeVideoId ? (
            <a key={v._id} href={`https://www.youtube.com/watch?v=${v.youtubeVideoId}`} target="_blank" rel="noopener noreferrer" className="glass glass-shine lift" style={{ padding: "0.5rem", display: "block" }}>
              {card}
            </a>
          ) : (
            <div key={v?._id ?? i} className="glass" style={{ padding: "0.5rem" }}>{card}</div>
          );
        })}
      </div>
    </section>
  );
}
