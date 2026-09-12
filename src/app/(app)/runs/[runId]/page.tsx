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
import { failureReason } from "@/lib/failureReason";
import { IconChevron, IconExternal } from "@/components/icons";
import styles from "./runDetail.module.css";

type ArtifactRetention = {
  status: "awaiting_release" | "pending" | "processing" | "completed" | "blocked";
  releaseAt?: number;
  retainUntil?: number;
  scheduledAt: number;
  completedAt?: number;
  removedObjects?: number;
  retainedObjectCount?: number;
};

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
  // One exact-run media subscription shares Library's current-thumbnail
  // resolver without fetching full narration/SEO or reading assets twice.
  const media = useQuery(
    api.videos.getRunMediaPresentation,
    run ? { runId: runId as Id<"runs"> } : "skip",
  );
  const assets = media?.assets as RunMediaAsset[] | undefined;
  const artifactRetention = useQuery(api.runArtifactRetentions.getForRun, {
    runId: runId as Id<"runs">,
  }) as ArtifactRetention | null | undefined;

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
  const failure = run.error ? failureReason(run.error) : null;
  // The title is only an accessible image label here. Reuse already-loaded
  // metadata/asset titles in the same order as the full Library detail view.
  const metadata = stages?.find((stage) => stage.block === "metadata")?.outputs as
    | { title?: unknown }
    | undefined;
  const videoAsset = assets?.find((asset) => asset.kind === "video" && asset.r2Key === media?.currentThumbnail.videoKey)
    ?? assets?.find((asset) => asset.kind === "video");
  const videoMeta = videoAsset?.meta as { title?: unknown } | undefined;
  const thumbnailMeta = assets?.find((asset) => asset.kind === "thumbnail")?.meta as
    | { thumbnailTitle?: unknown }
    | undefined;
  const thumbnailTitle = [metadata?.title, videoMeta?.title, thumbnailMeta?.thumbnailTitle]
    .find((title): title is string => typeof title === "string" && Boolean(title))
    ?? channel?.name ?? "this run";
  const currentThumbnail = media === undefined ? undefined : media === null ? null : {
    ...media.currentThumbnail,
    title: thumbnailTitle,
  };
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

        {failure && (
          <div className={`glass ${styles.errorPanel}`} role="alert">
            <div className={styles.errorSummary}>
              <strong>{failure.reason}{failure.block ? ` · ${failure.block}` : ""}</strong>
              {failure.hint && <span>{failure.hint}</span>}
            </div>
            <details className={styles.errorTechnical}>
              <summary>Technical detail</summary>
              <code>{run.error}</code>
            </details>
          </div>
        )}
      </section>

      <ArtifactRetentionStrip retention={artifactRetention} legacy={planSource === "legacy"} />

      <RunPackageShelf
        runId={run._id}
        runStatus={run.status}
        stages={stages}
        assets={assets}
        currentThumbnail={currentThumbnail}
      />

      {(run.status === "awaiting_factual_review" || run.status === "factual_review_blocked") && (
        <FactualReviewPanel runId={String(run._id)} />
      )}

      <div id="recorded-work" className={styles.anchorTarget}>
        <RunMediaWorkbench
          key={runId}
          assets={assets}
          stages={stages}
          runStatus={run.status}
          selectedVideoAssetId={run.videoAssetId ? String(run.videoAssetId) : undefined}
          currentThumbnail={currentThumbnail}
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

function ArtifactRetentionStrip({
  retention,
  legacy,
}: {
  retention: ArtifactRetention | null | undefined;
  legacy: boolean;
}) {
  const [observedAt] = useState(() => Date.now());
  if (retention === undefined) {
    return <div className={styles.retentionStrip} data-status="loading" aria-label="Loading artifact retention" />;
  }
  if (!retention) {
    return (
      <div className={styles.retentionStrip} data-status="untracked">
        <span className={styles.retentionGlyph} aria-hidden="true">◇</span>
        <div><small>Artifact lifecycle</small><strong>{legacy ? "Legacy record" : "Not scheduled yet"}</strong></div>
        <p>{legacy ? "No destructive cleanup is inferred for this older run." : "Artifacts remain untouched until the upload stage records a release-aware schedule."}</p>
      </div>
    );
  }

  const presentation = retention.status === "awaiting_release"
    ? { title: "Held until release", detail: "Private draft · no deletion date", tone: "waiting" }
    : retention.status === "pending"
      ? { title: "Working files retained", detail: retention.retainUntil ? `Until ${fmtDateTime(retention.retainUntil)}` : "Release + 14 days", tone: "active" }
      : retention.status === "processing"
        ? { title: "Verifying before cleanup", detail: "Certificates and retained bytes are being checked", tone: "processing" }
        : retention.status === "completed"
          ? { title: "Intermediates cleared", detail: `${retention.removedObjects ?? 0} removed · final master kept`, tone: "complete" }
          : { title: "Cleanup blocked safely", detail: "All recoverable files remain in storage", tone: "blocked" };
  const progress = retention.retainUntil && retention.retainUntil > retention.scheduledAt
    ? Math.max(0, Math.min(100, ((observedAt - retention.scheduledAt) / (retention.retainUntil - retention.scheduledAt)) * 100))
    : retention.status === "completed" ? 100 : 0;

  return (
    <div className={styles.retentionStrip} data-status={presentation.tone}>
      <span className={styles.retentionGlyph} aria-hidden="true">◌</span>
      <div><small>Artifact lifecycle</small><strong>{presentation.title}</strong></div>
      <div className={styles.retentionTrack} aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>
      <p>{presentation.detail}</p>
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

type PackageStage = {
  block: string;
  status: string;
  outputs?: unknown;
};

type PackageAsset = {
  kind: string;
};

type PackageState = "ready" | "working" | "blocked" | "waiting";

/**
 * A compact, lazy package index for the schedule → run handoff. It makes the
 * promised episode deliverables visible before an operator opens the much
 * heavier media and stage workbenches, while keeping the full script/SEO read
 * on demand. Every state is derived from persisted stage receipts or assets.
 */
function RunPackageShelf({
  runId,
  runStatus,
  stages,
  assets,
  currentThumbnail,
}: {
  runId: Id<"runs">;
  runStatus: string;
  stages: readonly PackageStage[] | undefined;
  assets: readonly PackageAsset[] | undefined;
  currentThumbnail: { thumbnailKey?: string | null; videoKey?: string | null } | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const detail = useQuery(api.videos.getVideoDetail, open ? { runId } : "skip") as {
    title?: string;
    description?: string | null;
    tags?: string[];
    script?: string | null;
    titleAlternate?: string | null;
  } | null | undefined;

  // Deliberately use exact block ids here. A QA receipt such as `qa_visual`
  // must not masquerade as a visual producer, and a generic substring match
  // would make unavailable package parts look ready on legacy runs.
  const stage = (...blocks: string[]) => stages?.find((item) => blocks.includes(item.block));
  const state = (candidate: PackageStage | undefined, fallback = false): PackageState => {
    if (candidate?.status === "failed") return "blocked";
    if (fallback) return "ready";
    if (!candidate) return "waiting";
    if (["ok", "skipped", "complete"].includes(candidate.status)) return "ready";
    return "working";
  };
  const label = (value: PackageState) =>
    value === "ready" ? "Ready" : value === "working" ? "Working" : value === "blocked" ? "Blocked" : "Waiting";

  const scriptStage = stage("script_gen", "whiteboard_scribe", "motion_comic");
  const shotStage = stage("scene_planner", "shot_list", "storyboard");
  const visualStage = stage("keyframes", "loop_clips", "stock_footage", "visual_gen", "image_gen");
  const seoStage = stage("metadata", "quiz_metadata");
  const narrationStage = stage("narration_tts", "tts", "voice");
  const subtitleStage = stage("subtitles", "captions", "caption");
  const exportStage = stage("assemble", "timeline_assemble", "upload_draft");
  const hasVideo = Boolean(assets?.some((asset) => asset.kind === "video") || currentThumbnail?.videoKey);
  const hasThumbnail = Boolean(assets?.some((asset) => asset.kind === "thumbnail") || currentThumbnail?.thumbnailKey);

  const items: Array<{ key: string; title: string; detail: string; state: PackageState }> = [
    { key: "script", title: "Script", detail: scriptStage ? blockLabel(scriptStage.block) : "Not attached", state: state(scriptStage) },
    { key: "shots", title: "Shot list", detail: shotStage ? blockLabel(shotStage.block) : "No shot receipt", state: state(shotStage) },
    { key: "visuals", title: "Visuals", detail: visualStage ? blockLabel(visualStage.block) : "No visual receipt", state: state(visualStage) },
    { key: "seo", title: "SEO", detail: seoStage ? "Title + metadata" : "Metadata pending", state: state(seoStage) },
    { key: "narration", title: "Narration", detail: narrationStage ? blockLabel(narrationStage.block) : "Not configured", state: state(narrationStage) },
    { key: "subtitles", title: "Subtitles", detail: subtitleStage ? blockLabel(subtitleStage.block) : "Not configured", state: state(subtitleStage) },
    { key: "thumbnail", title: "Thumbnail", detail: hasThumbnail ? "Current package" : "Not saved", state: hasThumbnail ? "ready" : "waiting" },
    { key: "export", title: "Export", detail: hasVideo ? "Master media" : exportStage ? blockLabel(exportStage.block) : runStatus === "failed" ? "No master" : "Awaiting render", state: state(exportStage, hasVideo) },
  ];

  return (
    <section className={styles.packageShelf} aria-labelledby="episode-package-title">
      <button
        type="button"
        className={styles.packageHeader}
        aria-expanded={open}
        aria-controls="episode-package-body"
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.packageHeading}>
          <span className={styles.packageEyebrow}>Episode package</span>
          <strong id="episode-package-title">Plan outputs at a glance</strong>
          <small>Open the exact script and SEO only when needed.</small>
        </span>
        <span className={styles.packageToggle}>{open ? "Close" : "Inspect"}</span>
      </button>
      <div className={styles.packageGrid} aria-label="Episode output availability">
        {items.map((item) => (
          <div className={styles.packageItem} data-state={item.state} key={item.key}>
            <span className={styles.packageDot} aria-hidden="true" />
            <span className={styles.packageItemCopy}><strong>{item.title}</strong><small>{item.detail}</small></span>
            <em>{label(item.state)}</em>
          </div>
        ))}
      </div>
      {open && (
        <div className={styles.packageBody} id="episode-package-body">
          {detail === undefined ? (
            <span className={styles.packageLoading} role="status">Loading saved package…</span>
          ) : detail === null ? (
            <span className={styles.packageLoading}>No metadata receipt is saved for this run yet.</span>
          ) : (
            <div className={styles.packageDetailGrid}>
              <div><small>Title</small><strong>{detail.title || "Untitled"}</strong>{detail.titleAlternate && <span>Alt: {detail.titleAlternate}</span>}</div>
              <div><small>SEO</small><span>{detail.tags?.length ? `${detail.tags.length} tags · description saved` : detail.description ? "Description saved" : "No SEO body yet"}</span></div>
              <div className={styles.packageScript}><small>Script / narration text</small><p>{detail.script || "No narration text saved yet; inspect the stage receipts for the live failure or pending state."}</p></div>
            </div>
          )}
          <a className={styles.packageMediaLink} href="#recorded-work">Open retained visuals and exports ↓</a>
        </div>
      )}
    </section>
  );
}
