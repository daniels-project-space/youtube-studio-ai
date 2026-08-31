"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { PageHeader, SectionTitle } from "@/components/PageHeader";
import { StageBadge } from "@/components/StageBadge";
import { ReleaseEvidenceBadge } from "@/components/ReleaseEvidenceBadge";
import { Elapsed } from "@/components/Elapsed";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
import {
  LivePipeline,
  type PipelineNode,
  type PipelineStage,
} from "@/components/LivePipeline";
import { LogConsole } from "@/components/LogConsole";
import { FactualReviewPanel } from "@/components/FactualReviewPanel";
import {
  RunMediaWorkbench,
  type RunMediaAsset,
} from "@/components/RunMediaWorkbench";
import { LOFI_BLOCK_IDS } from "@/lib/blocks";
import { fmtDateTime, fmtUsd } from "@/lib/format";
import { IconChevron, IconExternal } from "@/components/icons";
import styles from "./runDetail.module.css";

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
  const assets = useQuery(
    api.assets.listForRun,
    run ? { runId: runId as Id<"runs"> } : "skip",
  ) as RunMediaAsset[] | undefined;

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
            <Link href="/runs" className={styles.inlineLink}>
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
          <span className={styles.runContext}>
            {channelSlug ? (
              <Link
                href={`/channels/${channelSlug}`}
                className={styles.channelLink}
              >
                {channelName}
              </Link>
            ) : (
              <span>{channelName}</span>
            )}
            <span className={styles.contextDivider}>·</span>
            <span className={styles.runId}>
              {run._id}
            </span>
          </span>
        }
        actions={<StageBadge status={run.status} />}
      />

      <section className={styles.summarySection} aria-label="Run summary">
        <div
          className={`glass glass-shine ${styles.summaryGrid}`}
          data-run-status={run.status}
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
            label="Release evidence"
            value={<ReleaseEvidenceBadge status={run.releaseEvidenceStatus} size="md" />}
          />
          <Field
            label="Video"
            value={
              run.youtubeVideoId ? (
                <a
                  href={`https://www.youtube.com/watch?v=${run.youtubeVideoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.videoLink}
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
          <div className={`glass ${styles.errorPanel}`} role="alert">
            {run.error}
          </div>
        )}
      </section>

      {(run.status === "awaiting_factual_review" || run.status === "factual_review_blocked") && (
        <FactualReviewPanel runId={String(run._id)} />
      )}

      <RunMediaWorkbench
        assets={assets}
        stages={stages}
        runStatus={run.status}
        selectedVideoAssetId={run.videoAssetId ? String(run.videoAssetId) : undefined}
      />

      {run.youtubeVideoId && (
        <section className={styles.publishedSection}>
          <SectionTitle>Published video</SectionTitle>
          <div className={`glass ${styles.publishedShell}`}>
            <div className={styles.publishedFrame}>
              <iframe
                src={`https://www.youtube.com/embed/${run.youtubeVideoId}`}
                title="Published video"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className={styles.publishedPlayer}
              />
            </div>
          </div>
        </section>
      )}

      <section className={styles.pipelineSection}>
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

      <section className={styles.consoleSection}>
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
      className={styles.backLink}
    >
      <IconChevron
        width={15}
        height={15}
        className={styles.backIcon}
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
    <div className={styles.field}>
      <div className={styles.fieldLabel}>
        {label}
      </div>
      <div className={`${styles.fieldValue}${mono ? ` ${styles.fieldMono}` : ""}`}>
        {value}
      </div>
    </div>
  );
}
