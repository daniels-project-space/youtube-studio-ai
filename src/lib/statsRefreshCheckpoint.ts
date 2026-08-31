/**
 * Bounded planning primitives for `stats-refresh`.
 *
 * These values deliberately cap one channel's Data API work to one
 * `videos.list` batch plus one `channels.list` batch.  Durable cursor state is
 * owned by Convex; this module is pure so its ordering and budget guarantees
 * are directly regression-tested.
 */
export const STATS_REFRESH_CADENCE_MS = 6 * 60 * 60 * 1_000;
export const STATS_REFRESH_FRESHNESS_CADENCE_MS = 24 * 60 * 60 * 1_000;
export const STATS_REFRESH_MAX_CHANNELS_PER_RUN = 24;
export const STATS_REFRESH_RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
export const STATS_REFRESH_RECENT_PAGE_LIMIT = 16;
export const STATS_REFRESH_HISTORY_PAGE_LIMIT = 24;
export const STATS_REFRESH_MAX_VIDEO_IDS_PER_BATCH = 40;
export const STATS_REFRESH_MAX_CONSECUTIVE_FAILURES = 3;
// The scheduled task may run for thirty minutes. A live worker holds this
// lease for slightly longer so a concurrent manual/scheduled invocation can
// observe "busy" without turning the healthy owner into an ambiguity stop.
export const STATS_REFRESH_WORKER_LEASE_MS = 35 * 60 * 1_000;
export const STATS_REFRESH_MAX_COMMIT_FAILURES = 3;
export const STATS_REFRESH_COMMIT_DEADLINE_MS = 24 * 60 * 60 * 1_000;

export type UploadedRunLike = {
  youtubeVideoId?: string | null;
};

export type StatsRefreshScanPlan =
  | { mode: "freshness"; startedAfter: number; cursor: string | null }
  | { mode: "history"; startedAfter: 0; cursor: string | null }
  | { mode: "rollup" };

export type StatsRefreshProgressPlanInput = {
  historyCursor?: string;
  historyCompletedAt?: number;
  freshnessWindowStartedAfter?: number;
  freshnessCursor?: string;
  freshnessNextAt?: number;
};

function assertRefreshTime(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("stats refresh time must be a non-negative safe integer");
  }
}

export function statsRefreshCadenceKey(now: number): string {
  assertRefreshTime(now);
  return `stats-refresh/v1/${Math.floor(now / STATS_REFRESH_CADENCE_MS)}`;
}

/**
 * Freshness uses a frozen 30-day window and is scheduled less often than the
 * six-hour worker cadence. That keeps new uploads ahead of history while still
 * letting the history cursor make progress and, once complete, never restart.
 */
export function planStatsRefreshScan(
  progress: StatsRefreshProgressPlanInput | null | undefined,
  now: number,
): StatsRefreshScanPlan {
  assertRefreshTime(now);
  if (progress?.freshnessWindowStartedAfter !== undefined) {
    return {
      mode: "freshness",
      startedAfter: progress.freshnessWindowStartedAfter,
      cursor: progress.freshnessCursor ?? null,
    };
  }
  if (
    progress?.freshnessNextAt === undefined ||
    progress.freshnessNextAt <= now
  ) {
    return {
      mode: "freshness",
      startedAfter: Math.max(0, now - STATS_REFRESH_RECENT_WINDOW_MS),
      cursor: null,
    };
  }
  if (progress.historyCompletedAt === undefined) {
    return {
      mode: "history",
      startedAfter: 0,
      cursor: progress.historyCursor ?? null,
    };
  }
  return { mode: "rollup" };
}

/**
 * Deterministic owner-wide rotation keeps a large fleet bounded without
 * permanently starving channels beyond the first page.
 */
export function selectStatsRefreshChannels<T extends { _id: unknown }>(
  channels: readonly T[],
  now: number,
  maxChannels = STATS_REFRESH_MAX_CHANNELS_PER_RUN,
): T[] {
  assertRefreshTime(now);
  if (!Number.isSafeInteger(maxChannels) || maxChannels < 1) {
    throw new Error("stats refresh channel budget must be a positive safe integer");
  }
  const sorted = [...channels].sort((a, b) => String(a._id).localeCompare(String(b._id)));
  if (sorted.length <= maxChannels) return sorted;
  const pageCount = Math.ceil(sorted.length / maxChannels);
  const pageIndex = Math.floor(now / STATS_REFRESH_CADENCE_MS) % pageCount;
  const start = pageIndex * maxChannels;
  return sorted.slice(start, start + maxChannels);
}

/** Active interrupted batches always receive the next bounded slot first. */
export function selectStatsRefreshWorkChannels<T extends { _id: unknown }>(
  active: readonly T[],
  eligible: readonly T[],
  now: number,
  maxChannels = STATS_REFRESH_MAX_CHANNELS_PER_RUN,
): T[] {
  assertRefreshTime(now);
  if (!Number.isSafeInteger(maxChannels) || maxChannels < 1) {
    throw new Error("stats refresh channel budget must be a positive safe integer");
  }
  const byId = new Map<string, T>();
  for (const channel of active) byId.set(String(channel._id), channel);
  const prioritized = [...byId.values()]
    .sort((a, b) => String(a._id).localeCompare(String(b._id)))
    .slice(0, maxChannels);
  if (prioritized.length === maxChannels) return prioritized;
  const activeIds = new Set(prioritized.map((channel) => String(channel._id)));
  const remaining = selectStatsRefreshChannels(
    eligible.filter((channel) => !activeIds.has(String(channel._id))),
    now,
    maxChannels - prioritized.length,
  );
  return [...prioritized, ...remaining];
}

/**
 * Recent uploads are intentionally first, then one page of older history.
 * De-duplication means the first history page can overlap the fresh page
 * without growing provider calls or snapshot writes.
 */
export function selectStatsRefreshVideoIds(
  recent: readonly UploadedRunLike[],
  history: readonly UploadedRunLike[],
  maxVideoIds = STATS_REFRESH_MAX_VIDEO_IDS_PER_BATCH,
): string[] {
  if (
    !Number.isSafeInteger(maxVideoIds) ||
    maxVideoIds < 1 ||
    maxVideoIds > STATS_REFRESH_MAX_VIDEO_IDS_PER_BATCH
  ) {
    throw new Error(
      `stats refresh video budget must be between 1 and ${STATS_REFRESH_MAX_VIDEO_IDS_PER_BATCH}`,
    );
  }
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const row of [...recent, ...history]) {
    const videoId = row.youtubeVideoId?.trim();
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);
    selected.push(videoId);
    if (selected.length === maxVideoIds) return selected;
  }
  return selected;
}
