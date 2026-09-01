"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
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
import { blockLabel, LOFI_BLOCK_IDS } from "@/lib/blocks";
import { fmtDateTime, fmtUsd } from "@/lib/format";
import { IconChevron, IconExternal } from "@/components/icons";
import styles from "./runDetail.module.css";

export default function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = use(params);
  const [publishedOpen, setPublishedOpen] = useState(false);

  const run = useQuery(api.runs.getRunPresentation, { runId: runId as Id<"runs"> });
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
        <SkeletonList rows={4} />
      </>
    );
  }

  if (run === null) {
    return (
      <>
        <BackLink />
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

  // The immutable invocation is the source of truth for an active run. Legacy
  // rows predate that record, so only they fall back to today's channel plan.
  // Executed rows are always merged below to keep historical drift visible.
  const expectedBlocks: string[] =
    run.pipeline?.entries.length
      ? run.pipeline.entries.map((entry) => entry.block)
      : channel && channel.pipeline && channel.pipeline.length > 0
      ? channel.pipeline.map((p: { block: string }) => p.block)
      : [...LOFI_BLOCK_IDS];
  const planSource = run.pipeline ? "frozen" : "legacy";

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
  const reportedStages = nodes.filter((node) => ["ok", "skipped"].includes(node.stage?.status ?? "queued")).length;
  const activeStage = nodes.find((node) => node.stage?.status === "running");
  const receiptProgress = nodes.length ? Math.round((reportedStages / nodes.length) * 100) : 0;

  return (
    <div className={styles.page}>
      <header className={styles.runHero} data-status={run.status}>
        <div className={styles.heroTopline}>
          <BackLink />
          <StageBadge status={run.status} />
        </div>
        <div className={styles.heroMain}>
          <div className={styles.heroCopy}>
            <span>Production record / persisted receipts</span>
            <h1>{channelSlug ? <Link href={`/channels/${channelSlug}`}>{channelName}</Link> : channelName}</h1>
            <p>
              <span className={styles.runId}>{run._id}</span>
              <i aria-hidden="true" />
              <span>{planSource === "frozen" ? "Frozen invocation" : "Legacy inferred plan"}</span>
              {run.finishedAt && <><i aria-hidden="true" /><span>Finished {fmtDateTime(run.finishedAt)}</span></>}
            </p>
          </div>
          <div className={styles.heroProgress} data-live={live ? "true" : undefined}>
            <div><small>Receipt coverage</small><strong>{receiptProgress}%</strong></div>
            <div className={styles.progressTrack} style={{ "--receipt-progress": `${receiptProgress}%` } as React.CSSProperties}><i /></div>
            <span>{activeStage ? `Working now · ${blockLabel(activeStage.block)}` : `${reportedStages} of ${nodes.length} planned stages reported`}</span>
          </div>
        </div>
      </header>

      <nav className={styles.runMap} aria-label="Run record areas">
        <a href="#recorded-work"><span>01</span><strong>Recorded work</strong><small>Saved media bytes</small></a>
        <a href="#pipeline-route"><span>02</span><strong>Pipeline route</strong><small>Stage receipts</small></a>
        <a href="#run-console"><span>03</span><strong>Console</strong><small>Reactive log tail</small></a>
      </nav>

      <section className={styles.summarySection} aria-label="Run summary">
        <div className={styles.summaryGrid} data-run-status={run.status}>
          <Field label="Started" value={fmtDateTime(run.startedAt)} />
          <Field
            label="Elapsed"
            value={
              <Elapsed from={run.startedAt} to={live ? undefined : run.finishedAt} />
            }
          />
          <Field label="Cost" value={fmtUsd(run.costTotal)} mono />
          <Field label="Stage ledger" value={`${reportedStages}/${nodes.length} reported`} mono />
          <Field
            label="Release evidence"
            value={<ReleaseEvidenceBadge status={run.releaseEvidenceStatus} compact />}
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

      <div id="recorded-work" className={styles.anchorTarget}>
        <RunMediaWorkbench
          assets={assets}
          stages={stages}
          runStatus={run.status}
          selectedVideoAssetId={run.videoAssetId ? String(run.videoAssetId) : undefined}
        />
      </div>

      {run.youtubeVideoId && (
        <section className={styles.publishedSection}>
          <details
            className={styles.publishedDisclosure}
            open={publishedOpen}
            onToggle={(event) => setPublishedOpen(event.currentTarget.open)}
          >
            <summary>
              <span><small>YouTube delivery</small><strong>Destination output is recorded</strong><em>Open the embedded delivery only when it is needed.</em></span>
              <span>{publishedOpen ? "Close player" : "Open player"}</span>
            </summary>
            {publishedOpen && <div className={styles.publishedFrame}>
              <iframe
                src={`https://www.youtube.com/embed/${run.youtubeVideoId}`}
                title="Published video"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className={styles.publishedPlayer}
              />
            </div>}
          </details>
          <a href={`https://www.youtube.com/watch?v=${run.youtubeVideoId}`} target="_blank" rel="noopener noreferrer" className={styles.youtubeReceiptLink}>Open on YouTube <IconExternal width={13} height={13} /></a>
        </section>
      )}

      <section id="pipeline-route" className={`${styles.pipelineSection} ${styles.anchorTarget}`}>
        <header className={styles.sectionHeader}><span>02 / pipeline route</span><h2>What reported, in production order</h2><p>The map advances only from persisted stage rows. Queued means no stage receipt exists yet.</p></header>
        {stages === undefined || (run && channel === undefined) ? (
          <SkeletonList rows={5} />
        ) : nodes.length > 0 ? (
          <LivePipeline nodes={nodes} planSource={planSource} />
        ) : (
          <EmptyState
            title="No pipeline blocks"
            description="This run has no planned blocks and no stages recorded yet."
          />
        )}
      </section>

      <section id="run-console" className={`${styles.consoleSection} ${styles.anchorTarget}`}>
        <LogConsole runId={run._id} runStatus={run.status} />
      </section>
    </div>
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
