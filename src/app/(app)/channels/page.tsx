"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useOwnerId } from "@/lib/owner-context";
import type { ChannelRow, RunRow } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { StageBadge } from "@/components/StageBadge";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
import { ChannelAvatar } from "@/components/ChannelArt";
import { IconChannels } from "@/components/icons";
import { fmtUsd } from "@/lib/format";

export default function ChannelsPage() {
  const ownerId = useOwnerId();
  const channels = useQuery(api.channels.listChannels, { ownerId }) as
    | ChannelRow[]
    | undefined;
  const recent = useQuery(api.runs.listRecent, { ownerId, limit: 200 }) as
    | RunRow[]
    | undefined;

  return (
    <>
      <PageHeader
        title="Channels"
        subtitle="Every channel and its pipeline status"
        actions={
          <Link
            href="/channels/new"
            className="lift"
            style={{
              padding: "0.55rem 1rem",
              borderRadius: 9,
              background: "var(--color-accent)",
              color: "#0a0a0b",
              fontWeight: 600,
              fontSize: "0.85rem",
            }}
          >
            + New channel
          </Link>
        }
      />

      {channels === undefined ? (
        <SkeletonList rows={4} />
      ) : channels.length === 0 ? (
        <EmptyState
          title="No channels yet"
          description="Channels created by the pipeline (or the seed script) will appear here."
          icon={<IconChannels width={24} height={24} />}
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: "1rem",
          }}
        >
          {channels.map((c) => {
            const chRuns = recent?.filter((r) => r.channelSlug === c.slug) ?? [];
            const count = chRuns.length;
            const videos = chRuns.filter((r) => r.youtubeVideoId).length;
            const cost = chRuns.reduce((s, r) => s + (r.costTotal ?? 0), 0);
            return (
              <Link
                key={c._id}
                href={`/channels/${c.slug}`}
                className="glass glass-shine lift"
                style={{ padding: "1.25rem", display: "grid", gap: "0.85rem" }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: "0.8rem" }}>
                  <ChannelAvatar
                    imageKey={c.identity?.imageKey}
                    name={c.name}
                    palette={c.identity?.palette}
                    size={48}
                    radius={12}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                      <h3 style={{ fontSize: "1.05rem", lineHeight: 1.2 }}>{c.name}</h3>
                      <StageBadge status={c.status === "active" ? "ok" : "queued"} size="sm" />
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "var(--color-muted)", marginTop: "0.2rem" }}>
                      {c.identity?.niche ?? `Template ${c.template}`}
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: "0.5rem",
                    borderTop: "1px solid var(--color-border)",
                    paddingTop: "0.7rem",
                  }}
                >
                  <CardStat label="Runs" value={String(count)} />
                  <CardStat label="Videos" value={String(videos)} />
                  <CardStat label="Spend" value={fmtUsd(cost)} />
                </div>
                <div style={{ fontSize: "0.72rem", fontFamily: "var(--font-mono)", color: "var(--color-faint)" }}>
                  {c.slug}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

function CardStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: "0.62rem",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "var(--color-faint)",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "0.92rem", fontWeight: 600, marginTop: "0.15rem" }}>
        {value}
      </div>
    </div>
  );
}
