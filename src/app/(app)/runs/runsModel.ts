export const RUN_FILTERS = [
  "all",
  "running",
  "queued",
  "ok",
  "failed",
  "canceled",
] as const;

export type RunFilter = (typeof RUN_FILTERS)[number];

export const RUN_FILTER_LABEL: Record<RunFilter, string> = {
  all: "All runs",
  running: "Live now",
  queued: "In queue",
  ok: "Completed",
  failed: "Needs attention",
  canceled: "Canceled",
};

export const INITIAL_VISIBLE_RUNS = 12;

type RunHistoryItem = {
  channelSlug: string;
  status: string;
};

/** One truthful projection powers counts, filtering, and progressive history. */
export function projectRunHistory<T extends RunHistoryItem>(
  runs: readonly T[],
  selectedSlug: string | null,
  filter: RunFilter,
  visibleLimit: number,
) {
  const scope = runs.filter((run) =>
    selectedSlug ? run.channelSlug === selectedSlug : true,
  );
  const matching = scope.filter((run) =>
    filter === "all" ? true : run.status === filter,
  );
  const statusCounts = Object.fromEntries(
    RUN_FILTERS.map((status) => [
      status,
      status === "all"
        ? scope.length
        : scope.filter((run) => run.status === status).length,
    ]),
  ) as Record<RunFilter, number>;
  const safeLimit = Math.max(0, Math.trunc(visibleLimit));
  const visible = matching.slice(0, safeLimit);

  return {
    matching,
    visible,
    statusCounts,
    remaining: Math.max(0, matching.length - visible.length),
  };
}
