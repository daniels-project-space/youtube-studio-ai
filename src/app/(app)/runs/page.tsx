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

const FILTERS = ["all", "running", "queued", "ok", "failed", "canceled"] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  running: "Running",
  queued: "Queued",
  ok: "Done",
  failed: "Failed",
  canceled: "Canceled",
};

export default function RunsPage() {
  const ownerId = useOwnerId();
  const { selectedSlug } = useSelectedChannel();
  const [filter, setFilter] = useState<Filter>("all");

  const runs = useQuery(api.runs.listRecent, { ownerId, limit: 200 }) as
    | RunRow[]
    | undefined;

  const visible = runs
    ?.filter((r) => (selectedSlug ? r.channelSlug === selectedSlug : true))
    .filter((r) => (filter === "all" ? true : r.status === filter));
  const scope = runs?.filter((r) => (selectedSlug ? r.channelSlug === selectedSlug : true));
  const statusCounts = {
    running: scope?.filter((run) => run.status === "running").length ?? 0,
    queued: scope?.filter((run) => run.status === "queued").length ?? 0,
    failed: scope?.filter((run) => run.status === "failed").length ?? 0,
    ok: scope?.filter((run) => run.status === "ok").length ?? 0,
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="Runs"
        subtitle="Live work first, then the release history behind it."
        actions={
          <div className={styles.filters} aria-label="Filter runs by status">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={styles.filter}
                data-active={filter === f}
                aria-pressed={filter === f}
              >
                {FILTER_LABEL[f]}
              </button>
            ))}
          </div>
        }
      />

      <section
        className={`glass ${styles.summary}`}
        aria-label="Run status overview"
      >
        {([
          ["running", "Live now"],
          ["queued", "In queue"],
          ["failed", "Needs attention"],
          ["ok", "Completed"],
        ] as const).map(([status, label]) => (
          <button
            key={status}
            type="button"
            onClick={() => setFilter((current) => current === status ? "all" : status)}
            aria-pressed={filter === status}
            className={styles.metric}
            data-status={status}
            data-active={filter === status}
          >
            <span className={styles.metricLabel}>{label}</span>
            <strong className={styles.metricValue}>
              {runs === undefined ? "—" : statusCounts[status]}
            </strong>
          </button>
        ))}
      </section>

      {runs === undefined ? (
        <SkeletonList rows={5} />
      ) : visible && visible.length > 0 ? (
        <div className={styles.list}>
          {visible.map((r) => (
            <RunCard key={r._id} run={r} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No runs match"
          description={filter === "all" ? "No runs yet." : `No ${FILTER_LABEL[filter].toLowerCase()} runs.`}
        />
      )}
    </div>
  );
}
