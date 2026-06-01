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
import { IconChannels } from "@/components/icons";

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
      <PageHeader title="Channels" subtitle="Every channel and its pipeline status" />

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
            const count =
              recent?.filter((r) => r.channelSlug === c.slug).length ?? 0;
            return (
              <Link
                key={c._id}
                href={`/channels/${c.slug}`}
                className="glass glass-shine lift"
                style={{ padding: "1.25rem", display: "grid", gap: "0.85rem" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.6rem" }}>
                  <h3 style={{ fontSize: "1.1rem" }}>{c.name}</h3>
                  <StageBadge status={c.status === "active" ? "ok" : "queued"} size="sm" />
                </div>
                <div style={{ fontSize: "0.8rem", color: "var(--color-muted)" }}>
                  Template <span style={{ color: "var(--color-fg)" }}>{c.template}</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "0.78rem",
                    color: "var(--color-faint)",
                    borderTop: "1px solid var(--color-border)",
                    paddingTop: "0.7rem",
                  }}
                >
                  <span>{count} run{count === 1 ? "" : "s"}</span>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{c.slug}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
