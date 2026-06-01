"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useOwnerId } from "@/lib/owner-context";
import { useSelectedChannel } from "@/lib/channel-context";
import type { ChannelRow, RunRow } from "@/lib/types";
import { PageHeader, SectionTitle } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { RunCard } from "@/components/RunCard";
import { StageBadge } from "@/components/StageBadge";
import { Elapsed } from "@/components/Elapsed";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
import {
  IconChannels,
  IconRuns,
  IconExternal,
} from "@/components/icons";

export default function OverviewPage() {
  const ownerId = useOwnerId();
  const { selectedSlug } = useSelectedChannel();

  const channels = useQuery(api.channels.listChannels, { ownerId }) as
    | ChannelRow[]
    | undefined;
  const recent = useQuery(api.runs.listRecent, { ownerId, limit: 50 }) as
    | RunRow[]
    | undefined;
  const active = useQuery(api.runs.listActive, { ownerId }) as
    | RunRow[]
    | undefined;

  // Filter by the channel selected in the top-bar switcher.
  const filterByChannel = <T extends { channelSlug: string }>(rows?: T[]) =>
    selectedSlug ? rows?.filter((r) => r.channelSlug === selectedSlug) : rows;

  const recentFiltered = filterByChannel(recent);
  const activeFiltered = filterByChannel(active);
  const channelsFiltered = selectedSlug
    ? channels?.filter((c) => c.slug === selectedSlug)
    : channels;

  const totalRuns = recentFiltered?.length ?? 0;
  const okRuns = recentFiltered?.filter((r) => r.status === "ok").length ?? 0;
  const failedRuns =
    recentFiltered?.filter((r) => r.status === "failed").length ?? 0;
  const latestVideo = recentFiltered?.find((r) => r.youtubeVideoId);

  const loading = channels === undefined || recent === undefined;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={
          selectedSlug
            ? `Filtered to the selected channel`
            : `Live pipeline state across all channels`
        }
      />

      {/* Stat row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: "0.9rem",
          marginBottom: "2.25rem",
        }}
      >
        <StatCard
          label="Channels"
          value={channelsFiltered?.length ?? "—"}
          accent="var(--color-accent)"
          icon={<IconChannels width={16} height={16} />}
        />
        <StatCard
          label="Runs"
          value={loading ? "—" : totalRuns}
          icon={<IconRuns width={16} height={16} />}
        />
        <StatCard
          label="Completed"
          value={loading ? "—" : okRuns}
          accent="var(--color-ok)"
        />
        <StatCard
          label="Failed"
          value={loading ? "—" : failedRuns}
          accent={failedRuns > 0 ? "var(--color-failed)" : "var(--color-fg)"}
        />
        <StatCard
          label="Latest video"
          value={
            latestVideo?.youtubeVideoId ? (
              <a
                href={`https://www.youtube.com/watch?v=${latestVideo.youtubeVideoId}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  fontSize: "1rem",
                  color: "var(--color-secondary)",
                }}
              >
                Watch <IconExternal width={15} height={15} />
              </a>
            ) : (
              "—"
            )
          }
          hint={latestVideo ? latestVideo.channelName : "No published video yet"}
        />
      </div>

      {/* Active runs board */}
      <section style={{ marginBottom: "2.25rem" }}>
        <SectionTitle>Active runs</SectionTitle>
        {active === undefined ? (
          <SkeletonList rows={2} />
        ) : activeFiltered && activeFiltered.length > 0 ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: "0.9rem",
            }}
          >
            {activeFiltered.map((r) => (
              <Link
                key={r._id}
                href={`/runs/${r._id}`}
                className="glass glass-shine lift"
                style={{ padding: "1.1rem 1.2rem", display: "grid", gap: "0.7rem" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <StageBadge status={r.status} />
                  <span style={{ fontSize: "0.8rem", color: "var(--color-secondary)" }}>
                    <Elapsed from={r.startedAt} />
                  </span>
                </div>
                <div style={{ fontWeight: 500 }}>{r.channelName}</div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No active runs"
            description="Queued and running pipelines will appear here in real time."
          />
        )}
      </section>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)",
          gap: "1.75rem",
          alignItems: "start",
        }}
      >
        {/* Recent runs */}
        <section>
          <SectionTitle>Recent runs</SectionTitle>
          {recent === undefined ? (
            <SkeletonList rows={4} />
          ) : recentFiltered && recentFiltered.length > 0 ? (
            <div style={{ display: "grid", gap: "0.6rem" }}>
              {recentFiltered.slice(0, 8).map((r) => (
                <RunCard key={r._id} run={r} />
              ))}
            </div>
          ) : (
            <EmptyState title="No runs yet" description="Runs will show up here once a pipeline executes." />
          )}
        </section>

        {/* Per-channel rollup */}
        <section>
          <SectionTitle>Channels</SectionTitle>
          {channels === undefined ? (
            <SkeletonList rows={3} />
          ) : channelsFiltered && channelsFiltered.length > 0 ? (
            <div style={{ display: "grid", gap: "0.6rem" }}>
              {channelsFiltered.map((c) => {
                const count =
                  recent?.filter((r) => r.channelSlug === c.slug).length ?? 0;
                return (
                  <Link
                    key={c._id}
                    href={`/channels/${c.slug}`}
                    className="glass glass-shine lift"
                    style={{
                      padding: "0.85rem 1rem",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "0.75rem",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.name}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--color-faint)" }}>
                        {c.template} · {count} run{count === 1 ? "" : "s"}
                      </div>
                    </div>
                    <StageBadge status={c.status === "active" ? "ok" : "queued"} size="sm" />
                  </Link>
                );
              })}
            </div>
          ) : (
            <EmptyState title="No channels" description="Seed a channel to get started." />
          )}
        </section>
      </div>
    </>
  );
}
