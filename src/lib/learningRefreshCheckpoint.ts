/**
 * Small, pure policy helpers for the daily learning refresh.  Keeping the
 * cursor/claim policy here makes the expensive boundaries testable without a
 * Trigger or Convex runtime.
 */

/** One channel invocation may make at most this many Analytics API requests. */
export const LEARNING_ANALYTICS_BATCH_LIMIT = 12;

/**
 * The frozen metric contract for a durable learning batch.  Missing is the
 * legacy v1 shape so old in-flight batches keep their original provider query.
 */
export const LEARNING_ANALYTICS_METRIC_DEFINITION_V1 =
  "youtube-analytics-outcomes-v1";
export const LEARNING_ANALYTICS_METRIC_DEFINITION_V2 =
  "youtube-analytics-outcomes-v2-engaged-views";

export type LearningAnalyticsMetricDefinitionVersion =
  | typeof LEARNING_ANALYTICS_METRIC_DEFINITION_V1
  | typeof LEARNING_ANALYTICS_METRIC_DEFINITION_V2;

/** Fail closed for an unknown frozen batch instead of changing its query. */
export function resolveLearningAnalyticsMetricDefinitionVersion(
  version?: string,
): LearningAnalyticsMetricDefinitionVersion {
  if (
    version === undefined ||
    version === LEARNING_ANALYTICS_METRIC_DEFINITION_V1
  ) {
    return LEARNING_ANALYTICS_METRIC_DEFINITION_V1;
  }
  if (version === LEARNING_ANALYTICS_METRIC_DEFINITION_V2) {
    return LEARNING_ANALYTICS_METRIC_DEFINITION_V2;
  }
  throw new Error(`unsupported learning analytics metric definition version: ${version}`);
}

/** A rolling sweep catches newly-settled uploads without revisiting all history. */
export const LEARNING_ANALYTICS_FRESHNESS_WINDOW_MS = 28 * 24 * 3_600_000;
export const LEARNING_ANALYTICS_FRESHNESS_CADENCE_MS = 24 * 3_600_000;

/** A claim that has not crossed the model boundary may be recovered briefly. */
export const SHOW_BIBLE_PRE_PROVIDER_CLAIM_LEASE_MS = 5 * 60_000;
export const SHOW_BIBLE_MAX_PRE_PROVIDER_ATTEMPTS = 2;

/**
 * A single owner can reserve only a small daily Show Bible envelope.  This is
 * an admission limit, not a quality downgrade: admitted calls retain the
 * existing 600-token showrunner prompt and quality thresholds.
 */
export const SHOW_BIBLE_OWNER_DAILY_MODEL_CALL_CAP = 2;
export const SHOW_BIBLE_OWNER_DAILY_MAX_TOKENS = 1_200;

/** A healthy learning worker owns its durable batch for a short bounded span. */
export const LEARNING_ANALYTICS_BATCH_WORKER_LEASE_MS = 15 * 60_000;

/** Each Analytics HTTP request must finish well before its batch lease can expire. */
export const LEARNING_ANALYTICS_REQUEST_TIMEOUT_MS = 60_000;

/**
 * A dispatch capability is intentionally much shorter than the worker lease.
 * It is not the request timeout: it only bounds the synchronous handoff from
 * the final durable fence to the first outbound Analytics HTTP byte.
 */
export const LEARNING_ANALYTICS_HTTP_DISPATCH_WINDOW_MS = 5_000;

export interface LearningAnalyticsHttpDispatchWindow {
  deadlineAt: number;
}

/**
 * Keep this check local and synchronous so it can run immediately inside the
 * HTTP helper, directly before each outbound request (including the optional
 * CTR request). A paused worker therefore cannot reuse an old durable marker.
 */
export function assertLearningAnalyticsHttpDispatchWindow(
  window: LearningAnalyticsHttpDispatchWindow,
  now = Date.now(),
): void {
  if (!Number.isSafeInteger(window.deadlineAt) || window.deadlineAt <= 0) {
    throw new Error("learning analytics HTTP dispatch capability deadline is invalid");
  }
  if (!Number.isFinite(now) || now >= window.deadlineAt) {
    throw new Error("learning analytics HTTP dispatch capability expired before provider request");
  }
}

export interface LearningAnalyticsProgressSnapshot {
  historyCursor?: string;
  historyCompletedAt?: number;
  freshnessWindowStartedAfter?: number;
  freshnessCursor?: string;
  freshnessNextAt?: number;
}

export type LearningAnalyticsScanPlan =
  | {
      kind: "history";
      startedAfter: 0;
      cursor?: string;
    }
  | {
      kind: "freshness";
      startedAfter: number;
      cursor?: string;
    }
  | {
      kind: "idle";
      notBefore: number;
    };

/**
 * Return exactly one bounded page plan.  The initial indexed backfill is
 * cursor-resumable; after it completes, a frozen 28-day sweep advances across
 * daily invocations before a later sweep is allowed to begin.
 */
export function planLearningAnalyticsScan(
  progress: LearningAnalyticsProgressSnapshot | null | undefined,
  now: number,
): LearningAnalyticsScanPlan {
  if (!Number.isFinite(now) || now < 0) {
    throw new Error("learning analytics scan time is invalid");
  }
  if (!progress?.historyCompletedAt) {
    return {
      kind: "history",
      startedAfter: 0,
      ...(progress?.historyCursor ? { cursor: progress.historyCursor } : {}),
    };
  }
  if (progress.freshnessWindowStartedAfter !== undefined) {
    return {
      kind: "freshness",
      startedAfter: progress.freshnessWindowStartedAfter,
      ...(progress.freshnessCursor ? { cursor: progress.freshnessCursor } : {}),
    };
  }
  if (
    progress.freshnessNextAt !== undefined &&
    progress.freshnessNextAt > now
  ) {
    return { kind: "idle", notBefore: progress.freshnessNextAt };
  }
  return {
    kind: "freshness",
    startedAfter: Math.max(0, now - LEARNING_ANALYTICS_FRESHNESS_WINDOW_MS),
  };
}

export function settledVideoAt(run: {
  youtubeVideoId?: string;
  finishedAt?: number;
}, now: number, settleMs: number): run is {
  youtubeVideoId: string;
  finishedAt: number;
} {
  return Boolean(
    run.youtubeVideoId &&
      Number.isFinite(run.finishedAt) &&
      (run.finishedAt as number) <= now - settleMs,
  );
}
