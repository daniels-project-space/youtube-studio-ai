"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useOwnerId } from "@/lib/owner-context";
import type { RunRow } from "@/lib/types";
import { PageHeader, SectionTitle } from "@/components/PageHeader";
import { RunCard } from "@/components/RunCard";
import { StageBadge } from "@/components/StageBadge";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
import { fmtUsd } from "@/lib/format";

type RawRun = {
  _id: string;
  status: string;
  startedAt?: number;
  finishedAt?: number;
  costTotal: number;
  youtubeVideoId?: string;
  error?: string;
};

export default function ChannelDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const ownerId = useOwnerId();

  const channel = useQuery(api.channels.getChannelBySlug, { ownerId, slug });
  const runs = useQuery(
    api.runs.listRunsByChannel,
    channel ? { channelId: channel._id as Id<"channels"> } : "skip",
  ) as RawRun[] | undefined;

  if (channel === undefined) {
    return (
      <>
        <PageHeader title="Channel" />
        <SkeletonList rows={3} />
      </>
    );
  }

  if (channel === null) {
    return (
      <>
        <PageHeader title="Channel" />
        <EmptyState
          title="Channel not found"
          description={
            <>
              No channel with slug <code>{slug}</code>.{" "}
              <Link href="/channels" style={{ color: "var(--color-accent)" }}>
                Back to channels
              </Link>
            </>
          }
        />
      </>
    );
  }

  const enriched: RunRow[] = (runs ?? [])
    .map((r) => ({
      ...r,
      channelName: channel.name,
      channelSlug: channel.slug,
    }))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));

  const pipeline = channel.pipeline ?? [];

  return (
    <>
      <PageHeader
        title={channel.name}
        subtitle={
          <>
            <span style={{ fontFamily: "var(--font-mono)" }}>{channel.slug}</span> · template{" "}
            {channel.template}
          </>
        }
        actions={<StageBadge status={channel.status === "active" ? "ok" : "queued"} />}
      />

      {/* Config summary */}
      <section style={{ marginBottom: "2rem" }}>
        <SectionTitle>Configuration</SectionTitle>
        <div
          className="glass glass-shine"
          style={{
            padding: "1.25rem 1.4rem",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "1.1rem",
          }}
        >
          <Field label="Status" value={channel.status} />
          <Field label="Template" value={channel.template} />
          <Field label="Per-run budget" value={fmtUsd(channel.budget)} mono />
          <Field label="Cadence" value={channel.identity?.cadence ?? "—"} />
          <Field
            label="Pipeline blocks"
            value={pipeline.length ? `${pipeline.length} blocks` : "—"}
          />
          <Field label="Persona" value={channel.identity?.persona ?? "—"} />
        </div>

        {pipeline.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.45rem",
              marginTop: "0.9rem",
            }}
          >
            {pipeline.map((p: { block: string }, i: number) => (
              <span
                key={`${p.block}-${i}`}
                style={{
                  fontSize: "0.74rem",
                  fontFamily: "var(--font-mono)",
                  padding: "0.25rem 0.55rem",
                  borderRadius: 8,
                  background: "var(--color-secondary-soft)",
                  border: "1px solid color-mix(in srgb, var(--color-secondary) 28%, transparent)",
                  color: "var(--color-secondary)",
                }}
              >
                {i + 1}. {p.block}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Runs */}
      <section>
        <SectionTitle>Runs</SectionTitle>
        {runs === undefined ? (
          <SkeletonList rows={3} />
        ) : enriched.length > 0 ? (
          <div style={{ display: "grid", gap: "0.6rem" }}>
            {enriched.map((r) => (
              <RunCard key={r._id} run={r} />
            ))}
          </div>
        ) : (
          <EmptyState title="No runs for this channel yet" />
        )}
      </section>
    </>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: "0.7rem",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--color-faint)",
          marginBottom: "0.3rem",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "0.95rem", fontFamily: mono ? "var(--font-mono)" : undefined }}>
        {value}
      </div>
    </div>
  );
}
