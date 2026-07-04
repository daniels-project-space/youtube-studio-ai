"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { PageHeader, SectionTitle } from "@/components/PageHeader";
import { StageBadge } from "@/components/StageBadge";
import { Elapsed } from "@/components/Elapsed";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
import {
  LivePipeline,
  type PipelineNode,
  type PipelineStage,
} from "@/components/LivePipeline";
import { LogConsole } from "@/components/LogConsole";
import { LOFI_BLOCK_IDS } from "@/lib/blocks";
import { fmtDateTime, fmtUsd } from "@/lib/format";
import { IconChevron, IconExternal } from "@/components/icons";

export default function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = use(params);

  const run = useQuery(api.runs.getRun, { runId: runId as Id<"runs"> });
  // slim:true → no `inputs`, long output strings truncated server-side (the
  // full blobs were shipping megabytes to the browser on every subscription).
  const stages = useQuery(api.runStages.listRunStages, {
    runId: runId as Id<"runs">,
    slim: true,
  }) as PipelineStage[] | undefined;

  // Fetch the run's channel to derive the expected (planned) block list. We
  // skip the query until we know the channelId.
  const channel = useQuery(
    api.channels.getChannel,
    run ? { channelId: run.channelId as Id<"channels"> } : "skip",
  );

  if (run === undefined) {
    return (
      <>
        <BackLink />
        <PageHeader title="Run" />
        <SkeletonList rows={4} />
      </>
    );
  }

  if (run === null) {
    return (
      <>
        <BackLink />
        <PageHeader title="Run" />
        <EmptyState
          title="Run not found"
          description={
            <Link href="/runs" style={{ color: "var(--color-accent)" }}>
              Back to runs
            </Link>
          }
        />
      </>
    );
  }

  const live = run.status === "running" || run.status === "queued";

  // DERIVE-AND-MERGE: expected blocks come from the channel pipeline (fallback
  // to the canonical lofi block ids), then each is matched to its live stage.
  const expectedBlocks: string[] =
    channel && channel.pipeline && channel.pipeline.length > 0
      ? channel.pipeline.map((p: { block: string }) => p.block)
      : [...LOFI_BLOCK_IDS];

  const stageByBlock = new Map<string, PipelineStage>();
  for (const s of stages ?? []) stageByBlock.set(s.block, s);

  const nodes: PipelineNode[] = expectedBlocks.map((block) => ({
    block,
    stage: stageByBlock.get(block),
  }));

  // Surface any executed stages not present in the expected list (e.g. an old
  // run whose channel pipeline has since changed) so nothing is hidden.
  for (const s of stages ?? []) {
    if (!expectedBlocks.includes(s.block)) {
      nodes.push({ block: s.block, stage: s });
    }
  }

  const channelName = channel?.name ?? "Channel";
  const channelSlug = channel?.slug;

  return (
    <>
      <BackLink />

      <PageHeader
        title="Run detail"
        subtitle={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.6rem" }}>
            {channelSlug ? (
              <Link
                href={`/channels/${channelSlug}`}
                style={{ color: "var(--color-accent)", fontWeight: 500 }}
              >
                {channelName}
              </Link>
            ) : (
              <span>{channelName}</span>
            )}
            <span style={{ color: "var(--color-faint)" }}>·</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem" }}>
              {run._id}
            </span>
          </span>
        }
        actions={<StageBadge status={run.status} />}
      />

      {/* Summary */}
      <section style={{ marginBottom: "1.5rem" }}>
        <div
          className="glass glass-shine"
          style={{
            padding: "1.25rem 1.4rem",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: "1.1rem",
          }}
        >
          <Field label="Started" value={fmtDateTime(run.startedAt)} />
          <Field
            label="Finished"
            value={run.finishedAt ? fmtDateTime(run.finishedAt) : "—"}
          />
          <Field
            label="Elapsed"
            value={
              <Elapsed from={run.startedAt} to={live ? undefined : run.finishedAt} />
            }
          />
          <Field label="Cost" value={fmtUsd(run.costTotal)} mono />
          <Field
            label="Video"
            value={
              run.youtubeVideoId ? (
                <a
                  href={`https://www.youtube.com/watch?v=${run.youtubeVideoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.3rem",
                    color: "var(--color-secondary)",
                  }}
                >
                  Watch <IconExternal width={13} height={13} />
                </a>
              ) : (
                "—"
              )
            }
          />
        </div>

        {run.error && (
          <div
            className="glass"
            style={{
              marginTop: "0.9rem",
              padding: "0.9rem 1.1rem",
              border:
                "1px solid color-mix(in srgb, var(--color-failed) 35%, transparent)",
              color: "var(--color-failed)",
              fontSize: "0.85rem",
              fontFamily: "var(--font-mono)",
              whiteSpace: "pre-wrap",
            }}
          >
            {run.error}
          </div>
        )}
      </section>

      {/* Published video embed */}
      {run.youtubeVideoId && (
        <section style={{ marginBottom: "1.75rem" }}>
          <SectionTitle>Published video</SectionTitle>
          <div
            className="glass"
            style={{
              padding: 6,
              borderRadius: "var(--radius-card)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "relative",
                width: "100%",
                aspectRatio: "16 / 9",
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              <iframe
                src={`https://www.youtube.com/embed/${run.youtubeVideoId}`}
                title="Published video"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  border: "none",
                }}
              />
            </div>
          </div>
        </section>
      )}

      {/* Live pipeline */}
      <section>
        <SectionTitle>Pipeline</SectionTitle>
        {stages === undefined || (run && channel === undefined) ? (
          <SkeletonList rows={5} />
        ) : nodes.length > 0 ? (
          <LivePipeline nodes={nodes} />
        ) : (
          <EmptyState
            title="No pipeline blocks"
            description="This run has no planned blocks and no stages recorded yet."
          />
        )}
      </section>

      {/* Live logs */}
      <section style={{ marginTop: "1.75rem" }}>
        <SectionTitle>Console</SectionTitle>
        <LogConsole runId={run._id} />
      </section>
    </>
  );
}

function BackLink() {
  return (
    <Link
      href="/runs"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
        marginBottom: "1rem",
        fontSize: "0.85rem",
        color: "var(--color-muted)",
      }}
    >
      <IconChevron
        width={15}
        height={15}
        style={{ transform: "rotate(90deg)" }}
      />
      Back to runs
    </Link>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
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
      <div
        style={{
          fontSize: "0.95rem",
          fontFamily: mono ? "var(--font-mono)" : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
}
