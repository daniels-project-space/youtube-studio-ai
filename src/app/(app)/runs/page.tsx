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
import styles from "./runs.module.css";
import {
  INITIAL_VISIBLE_RUNS,
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
  const completedCount = scopedRuns.filter((run) => run.status === "ok").length;
  const failedCount = scopedRuns.filter((run) => run.status === "failed").length;
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
          <span>Production ledger / newest first</span>
          <h1>Every run, with its receipts intact</h1>
          <p>Follow active work, isolate failures, and open the exact pipeline, media, evidence, and console record behind any output.</p>
        </div>
        <div className={styles.heroMark} aria-hidden="true"><i /><span>RUN</span><i /></div>
      </header>

      <section className={styles.operatingSignals} aria-label="Production operating signals">
        <div data-tone={failedCount ? "attention" : "quiet"}><small>Attention</small><strong>{failedCount}</strong><span>Failed retained records</span></div>
        <div data-tone="ready"><small>Completed</small><strong>{completedCount}</strong><span>Terminal successful runs</span></div>
        <div><small>YouTube outputs</small><strong>{outputCount}</strong><span>Destination-linked videos</span></div>
        <div><small>Recorded spend</small><strong>{fmtUsd(totalCost)}</strong><span>Latest 200 records</span></div>
      </section>

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
            <div>
              <span>Production records</span>
              <h2>{RUN_FILTER_LABEL[filter]}</h2>
              <p aria-live="polite">
                Showing {projection.visible.length} of {projection.matching.length} matching records
              </p>
            </div>
            <span>Exact stage detail opens on each row</span>
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
  return (
    <Link href={`/runs/${run._id}`} className={styles.runRow} data-status={run.status}>
      <span className={styles.runIndex}>{String(index + 1).padStart(2, "0")}</span>
      <span className={styles.runSignal} aria-hidden="true"><i /></span>
      <span className={styles.runIdentity}>
        <strong>{run.channelName}</strong>
        <small>{fmtDateTime(run.startedAt)} · {run._id.slice(0, 8)}</small>
        {run.status === "failed" && run.error && <span>{run.error}</span>}
      </span>
      <span className={styles.runStatus}><StageBadge status={run.status} /></span>
      <span className={styles.runDatum}><small>Elapsed</small><strong className={live ? styles.liveValue : undefined}><Elapsed from={run.startedAt} to={live ? undefined : run.finishedAt} /></strong></span>
      <span className={styles.runDatum}><small>Cost</small><strong>{fmtUsd(run.costTotal)}</strong></span>
      <span className={styles.runEvidence}><ReleaseEvidenceBadge status={run.releaseEvidenceStatus} /></span>
      <span className={styles.runOpen}>{run.youtubeVideoId ? "Output + record" : "Open record"}<b aria-hidden="true">→</b></span>
    </Link>
  );
}
