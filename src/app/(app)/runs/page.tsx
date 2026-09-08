"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useOwnerId } from "@/lib/owner-context";
import { useSelectedChannel } from "@/lib/channel-context";
import type { RunRow } from "@/lib/types";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
import { StageBadge } from "@/components/StageBadge";
import { ReleaseEvidenceBadge } from "@/components/ReleaseEvidenceBadge";
import { Elapsed } from "@/components/Elapsed";
import { fmtDateTime, fmtUsd } from "@/lib/format";
import { blockLabel } from "@/lib/blocks";
import styles from "./runs.module.css";
import {
  INITIAL_VISIBLE_RUNS,
  diagnoseRunFailure,
  projectRunHistory,
  RUN_FILTER_LABEL,
  RUN_FILTERS,
  type RunFilter,
} from "./runsModel";

export default function RunsPage() {
  const ownerId = useOwnerId();
  const { selectedSlug } = useSelectedChannel();
  const [filter, setFilter] = useState<RunFilter>("all");
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_VISIBLE_RUNS);

  const runs = useQuery(api.runs.listRecent, { ownerId, limit: 200 }) as
    | RunRow[]
    | undefined;

  const projection = runs
    ? projectRunHistory(runs, selectedSlug, filter, visibleLimit)
    : undefined;
  const scopedRuns = runs?.filter((run) => selectedSlug ? run.channelSlug === selectedSlug : true) ?? [];
  const outputCount = scopedRuns.filter((run) => run.youtubeVideoId).length;
  const totalCost = scopedRuns.reduce((sum, run) => sum + (run.costTotal ?? 0), 0);
  const chooseFilter = (next: RunFilter) => {
    setFilter((current) => (current === next && next !== "all" ? "all" : next));
    setVisibleLimit(INITIAL_VISIBLE_RUNS);
  };

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <span>Production</span>
          <h1>Runs</h1>
          <p>Watch progress, inspect failures, and open saved output.</p>
        </div>
        <dl className={styles.heroFacts} aria-label="Production totals">
          <div><dt>On YouTube</dt><dd>{runs === undefined ? "—" : outputCount}</dd></div>
          <div><dt>Spend</dt><dd>{runs === undefined ? "—" : fmtUsd(totalCost)}</dd></div>
        </dl>
      </header>

      <section
        className={styles.summary}
        aria-label="Filter runs by status"
      >
        {RUN_FILTERS.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => chooseFilter(status)}
            aria-pressed={filter === status}
            className={styles.metric}
            data-status={status}
            data-active={filter === status}
          >
            <span className={styles.metricLabel}>{RUN_FILTER_LABEL[status]}</span>
            <strong className={styles.metricValue}>
              {runs === undefined ? "—" : projection?.statusCounts[status]}
            </strong>
          </button>
        ))}
      </section>

      {runs === undefined ? (
        <SkeletonList rows={5} />
      ) : projection && projection.visible.length > 0 ? (
        <>
          <div className={styles.listHeader}>
            <h2>{RUN_FILTER_LABEL[filter]}</h2>
            <p aria-live="polite">{projection.visible.length} of {projection.matching.length}</p>
          </div>
          <div className={styles.list}>
            {projection.visible.map((run, index) => (
              <ProductionRunRow key={run._id} run={run} index={index} />
            ))}
          </div>
          {projection.remaining > 0 ? (
            <div className={styles.loadMoreRow}>
              <button
                type="button"
                className="studio-action studio-action-secondary"
                onClick={() =>
                  setVisibleLimit((current) => current + INITIAL_VISIBLE_RUNS)
                }
              >
                Load {Math.min(INITIAL_VISIBLE_RUNS, projection.remaining)} more
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState
          title="No runs match"
          description={
            filter === "all"
              ? "No runs yet."
              : `No runs in ${RUN_FILTER_LABEL[filter].toLowerCase()}.`
          }
        />
      )}
    </div>
  );
}

function ProductionRunRow({ run, index }: { run: RunRow; index: number }) {
  const live = run.status === "running" || run.status === "queued";
  const failure = run.status === "failed" && run.error
    ? diagnoseRunFailure(run.error)
    : null;
  const destination = failure
    ? "Inspect"
    : run.youtubeVideoId
      ? "Output + record"
      : "Open record";
  const progress = live ? run.stageProgress : undefined;
  const progressRatio = progress?.totalKnown && progress.total > 0
    ? Math.min(1, progress.completed / progress.total)
    : null;
  const progressText = progress
    ? progress.totalKnown
      ? `${progress.completed}/${progress.total}`
      : `${progress.completed} done · total unknown`
    : null;
  const progressStage = progress?.currentBlock
    ? blockLabel(progress.currentBlock)
    : progress?.totalKnown && progress.total > 0 && progress.completed === progress.total
      ? "Finalizing"
      : run.status === "queued"
        ? "Waiting for runner"
        : "Starting pipeline";
  return (
    <Link href={`/runs/${run._id}`} className={styles.runRow} data-status={run.status}>
      <span className={styles.runIndex}>{String(index + 1).padStart(2, "0")}</span>
      <span className={styles.runSignal} aria-hidden="true"><i /></span>
      <span className={styles.runIdentity}>
        <strong>{run.channelName}</strong>
        <small>{fmtDateTime(run.startedAt)} · {run._id.slice(0, 8)}</small>
        {progress ? (
          <span
            className={styles.runProgress}
            data-known={progress.totalKnown ? "true" : "false"}
            aria-label={`${progressStage}, ${progressText}`}
          >
            <span aria-hidden="true"><i style={progressRatio === null ? undefined : { transform: `scaleX(${progressRatio})` }} /></span>
            <small>{progressStage} · {progressText}</small>
          </span>
        ) : null}
        {failure && (
          <span
            className={styles.runDiagnosis}
            title={`${failure.cause} ${failure.nextAction}`}
            aria-label={`Failure domain: ${failure.faultDomain}. Open this run for the retained diagnosis and repair direction.`}
          >
            {failure.faultDomain}
          </span>
        )}
      </span>
      <span className={styles.runStatus}><StageBadge status={run.status} /></span>
      <span className={styles.runDatum}><small>Elapsed</small><strong className={live ? styles.liveValue : undefined}><Elapsed from={run.startedAt} to={live ? undefined : run.finishedAt} /></strong></span>
      <span className={styles.runDatum}><small>Cost</small><strong>{fmtUsd(run.costTotal)}</strong></span>
      <span className={styles.runEvidence}><ReleaseEvidenceBadge status={run.releaseEvidenceStatus} compact /></span>
      <span className={styles.runOpen}>{destination}<b aria-hidden="true">→</b></span>
    </Link>
  );
}
