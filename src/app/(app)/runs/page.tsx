"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useOwnerId } from "@/lib/owner-context";
import { useSelectedChannel } from "@/lib/channel-context";
import type { RunRow } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { RunCard } from "@/components/RunCard";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
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
  const chooseFilter = (next: RunFilter) => {
    setFilter((current) => (current === next && next !== "all" ? "all" : next));
    setVisibleLimit(INITIAL_VISIBLE_RUNS);
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="Production"
        subtitle="Current work and recent release history, ordered newest first."
      />

      <section
        className={`glass ${styles.summary}`}
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
              <h2>Run history</h2>
              <p aria-live="polite">
                Showing {projection.visible.length} of {projection.matching.length}{" "}
                {RUN_FILTER_LABEL[filter].toLowerCase()}
              </p>
            </div>
            <span>Latest 200 retained records</span>
          </div>
          <div className={styles.list}>
            {projection.visible.map((r) => (
              <RunCard key={r._id} run={r} />
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
