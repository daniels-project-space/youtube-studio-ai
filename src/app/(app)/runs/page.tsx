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

  return (
    <>
      <PageHeader
        title="Runs"
        subtitle="Every pipeline execution, newest first"
        actions={
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                style={{
                  padding: "0.35rem 0.7rem",
                  borderRadius: 999,
                  fontSize: "0.78rem",
                  font: "inherit",
                  cursor: "pointer",
                  color: filter === f ? "var(--color-fg)" : "var(--color-muted)",
                  background: filter === f ? "var(--color-accent-soft)" : "transparent",
                  border: `1px solid ${filter === f ? "color-mix(in srgb, var(--color-accent) 28%, transparent)" : "var(--color-border)"}`,
                }}
              >
                {FILTER_LABEL[f]}
              </button>
            ))}
          </div>
        }
      />

      {runs === undefined ? (
        <SkeletonList rows={5} />
      ) : visible && visible.length > 0 ? (
        <div style={{ display: "grid", gap: "0.6rem" }}>
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
    </>
  );
}
