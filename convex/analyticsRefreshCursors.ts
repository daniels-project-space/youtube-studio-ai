import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import { hasAnyScope } from "../src/lib/publishingPolicy";
import { observedVideoReleaseProvenanceFromRecord } from "../src/lib/videoReleaseProvenanceIntegrity";
import {
  STATS_REFRESH_COMMIT_DEADLINE_MS,
  planStatsRefreshScan,
  STATS_REFRESH_FRESHNESS_CADENCE_MS,
  STATS_REFRESH_HISTORY_PAGE_LIMIT,
  STATS_REFRESH_MAX_CHANNELS_PER_RUN,
  STATS_REFRESH_MAX_COMMIT_FAILURES,
  STATS_REFRESH_MAX_CONSECUTIVE_FAILURES,
  STATS_REFRESH_MAX_VIDEO_IDS_PER_BATCH,
  STATS_REFRESH_RECENT_PAGE_LIMIT,
  STATS_REFRESH_WORKER_LEASE_MS,
  type StatsRefreshScanPlan,
} from "../src/lib/statsRefreshCheckpoint";

const DATA_READ_SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.readonly",
] as const;

const METRIC_DEFINITION_VERSION = "youtube-data-statistics-v1";

const videoStatValidator = v.object({
  youtubeVideoId: v.string(),
  channelId: v.string(),
  views: v.number(),
  likes: v.number(),
  comments: v.number(),
});

const channelRollupValidator = v.object({
  found: v.boolean(),
  subscriberCount: v.number(),
  viewCount: v.number(),
  videoCount: v.number(),
});

type RefreshCtx = MutationCtx | QueryCtx;
type RefreshBinding = {
  ownerId: string;
  channelId: Id<"channels">;
  connectorId: Id<"youtubeAuth">;
  connectorVersion: number;
};
type ActiveBatch = NonNullable<Doc<"analyticsRefreshCursors">["activeBatch"]>;
type RefreshProgress = Doc<"analyticsRefreshCursors">;
type RequestStage = "video" | "channel";
type WorkerFence = {
  batchGeneration: number;
  workerToken: string;
};

function assertInternalSecret(secret: string): void {
  const expected = process.env.INTERNAL_QUERY_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("analyticsRefreshCursors: invalid internal secret");
  }
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`analytics refresh ${label} must be a non-negative safe integer`);
  }
}

function assertCadenceKey(cadenceKey: string): void {
  if (!/^stats-refresh\/v1\/\d+$/.test(cadenceKey)) {
    throw new Error("analytics refresh cadence key is invalid");
  }
}

function sameCursor(left?: string, right?: string): boolean {
  return (left ?? undefined) === (right ?? undefined);
}

function sameConnector(
  batch: Pick<ActiveBatch, "connectorId" | "connectorVersion">,
  binding: RefreshBinding,
): boolean {
  return batch.connectorId === binding.connectorId &&
    batch.connectorVersion === binding.connectorVersion;
}

function requestStatus(batch: ActiveBatch, stage: RequestStage) {
  return stage === "video" ? batch.videoRequestStatus : batch.channelRequestStatus;
}

function requestToken(batch: ActiveBatch, stage: RequestStage) {
  return stage === "video" ? batch.videoRequestToken : batch.channelRequestToken;
}

function withRequestState(
  batch: ActiveBatch,
  stage: RequestStage,
  patch: {
    status: "pending" | "request_started" | "fetched" | "manual_reconciliation_required";
    token?: string;
    startedAt?: number;
  },
  now: number,
): ActiveBatch {
  if (stage === "video") {
    return {
      ...batch,
      videoRequestStatus: patch.status,
      videoRequestToken: patch.token,
      videoRequestStartedAt: patch.startedAt,
      updatedAt: now,
    };
  }
  return {
    ...batch,
    channelRequestStatus: patch.status,
    channelRequestToken: patch.token,
    channelRequestStartedAt: patch.startedAt,
    updatedAt: now,
  };
}

function assertScanProgress(args: {
  mode: "freshness" | "history" | "rollup";
  scanStartedAfter: number;
  scanCursorBefore?: string;
  scanCursorAfter?: string;
  scanIsDone: boolean;
}): void {
  assertFiniteNonNegative(args.scanStartedAfter, "scan lower bound");
  if (args.mode === "rollup") {
    if (!args.scanIsDone || args.scanCursorBefore || args.scanCursorAfter) {
      throw new Error("analytics refresh rollup work cannot carry a history cursor");
    }
    return;
  }
  if (args.scanIsDone && args.scanCursorAfter) {
    throw new Error("analytics refresh completed page cannot retain a continuation cursor");
  }
  if (!args.scanIsDone) {
    if (!args.scanCursorAfter?.trim()) {
      throw new Error("analytics refresh unfinished page is missing its continuation cursor");
    }
    if (sameCursor(args.scanCursorAfter, args.scanCursorBefore)) {
      throw new Error("analytics refresh continuation cursor did not advance");
    }
  }
}

function normalizeVideoIds(videoIds: readonly string[]): string[] {
  if (videoIds.length > STATS_REFRESH_MAX_VIDEO_IDS_PER_BATCH) {
    throw new Error(
      `analytics refresh batch exceeds ${STATS_REFRESH_MAX_VIDEO_IDS_PER_BATCH} video ids`,
    );
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of videoIds) {
    const videoId = raw.trim();
    if (!videoId) throw new Error("analytics refresh batch contains an empty video id");
    if (seen.has(videoId)) throw new Error("analytics refresh batch contains a duplicate video id");
    seen.add(videoId);
    normalized.push(videoId);
  }
  return normalized;
}

function assertVideoStats(
  batch: ActiveBatch,
  stats: ReadonlyArray<{
    youtubeVideoId: string;
    channelId: string;
    views: number;
    likes: number;
    comments: number;
  }>,
): void {
  if (stats.length > batch.videoIds.length) {
    throw new Error("analytics refresh returned more video stats than its frozen batch");
  }
  const expected = new Set(batch.videoIds);
  const seen = new Set<string>();
  for (const stat of stats) {
    if (!expected.has(stat.youtubeVideoId) || seen.has(stat.youtubeVideoId)) {
      throw new Error("analytics refresh fetched stats do not match the frozen batch");
    }
    if (
      !stat.channelId ||
      !Number.isFinite(stat.views) || stat.views < 0 ||
      !Number.isFinite(stat.likes) || stat.likes < 0 ||
      !Number.isFinite(stat.comments) || stat.comments < 0
    ) {
      throw new Error("analytics refresh fetched invalid video statistics");
    }
    seen.add(stat.youtubeVideoId);
  }
}

function assertChannelRollup(rollup: {
  found: boolean;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
}): void {
  for (const [name, value] of Object.entries({
    subscriberCount: rollup.subscriberCount,
    viewCount: rollup.viewCount,
    videoCount: rollup.videoCount,
  })) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`analytics refresh ${name} must be finite and non-negative`);
    }
  }
}

async function requireRefreshBinding(ctx: RefreshCtx, binding: RefreshBinding): Promise<void> {
  await requireStudioServiceIdentity(ctx, binding.ownerId, "Analytics refresh cursor operation");
  const [channel, connector] = await Promise.all([
    ctx.db.get(binding.channelId),
    ctx.db.get(binding.connectorId),
  ]);
  if (!channel || channel.ownerId !== binding.ownerId) {
    throw new Error("analytics refresh channel owner mismatch");
  }
  if (
    !connector ||
    connector.ownerId !== binding.ownerId ||
    connector.channelId !== binding.channelId ||
    (connector.tokenVersion ?? 1) !== binding.connectorVersion ||
    (connector.status ?? "active") !== "active" ||
    !hasAnyScope(connector.grantedScopes ?? [], DATA_READ_SCOPES)
  ) {
    throw new Error("analytics refresh connector provenance/scope mismatch");
  }
}

async function exactProgress(
  ctx: RefreshCtx,
  ownerId: string,
  channelId: Id<"channels">,
): Promise<RefreshProgress | null> {
  return await ctx.db
    .query("analyticsRefreshCursors")
    .withIndex("by_owner_channel", (q) => q.eq("ownerId", ownerId).eq("channelId", channelId))
    .unique();
}

function activeBatchOrThrow(
  progress: RefreshProgress | null,
  binding: RefreshBinding,
  batchKey: string,
): ActiveBatch {
  const batch = progress?.activeBatch;
  if (!batch || !sameConnector(batch, binding) || batch.batchKey !== batchKey) {
    throw new Error("analytics refresh active batch is missing or stale");
  }
  return batch;
}

function activeWorkerOrThrow(
  progress: RefreshProgress | null,
  binding: RefreshBinding,
  batchKey: string,
  worker: WorkerFence,
  now: number,
): ActiveBatch {
  const batch = activeBatchOrThrow(progress, binding, batchKey);
  if (
    progress?.activeState !== "active" ||
    batch.generation !== worker.batchGeneration ||
    batch.workerLeaseToken !== worker.workerToken ||
    batch.workerLeaseExpiresAt === undefined ||
    batch.workerLeaseExpiresAt <= now
  ) {
    throw new Error("analytics refresh worker lease is stale, missing, or expired");
  }
  return batch;
}

function clearWorkerLease(batch: ActiveBatch, now: number): ActiveBatch {
  return {
    ...batch,
    workerLeaseToken: undefined,
    workerLeaseExpiresAt: undefined,
    updatedAt: now,
  };
}

function hasDurablyFetchedProviderResponses(batch: ActiveBatch): boolean {
  return batch.videoRequestStatus === "fetched" &&
    batch.channelRequestStatus === "fetched" &&
    batch.videoStats !== undefined &&
    batch.channelRollup !== undefined &&
    batch.videoStatsFetchedAt !== undefined &&
    batch.channelRollupFetchedAt !== undefined;
}

function claimBatchWorker(batch: ActiveBatch, generation: number, now: number) {
  const workerLeaseAttempt = (batch.workerLeaseAttempt ?? 0) + 1;
  const workerToken = `${batch.batchKey}:g${generation}:w${workerLeaseAttempt}:${now}`;
  return {
    workerToken,
    batch: {
      ...batch,
      generation,
      workerLeaseToken: workerToken,
      workerLeaseExpiresAt: now + STATS_REFRESH_WORKER_LEASE_MS,
      workerLeaseAttempt,
      updatedAt: now,
    } satisfies ActiveBatch,
  };
}

async function failIngestionIfRunning(
  ctx: MutationCtx,
  ingestionId: Id<"analyticsIngestions">,
  error: string,
  now: number,
): Promise<void> {
  const ingestion = await ctx.db.get(ingestionId);
  if (ingestion?.status === "running") {
    await ctx.db.patch(ingestion._id, {
      status: "failed",
      lastError: error.slice(0, 1_000),
      finishedAt: now,
    });
  }
}

async function markManual(
  ctx: MutationCtx,
  progress: RefreshProgress,
  batch: ActiveBatch,
  error: string,
  now: number,
  stage?: RequestStage,
): Promise<void> {
  const manualBatch = stage
    ? withRequestState(batch, stage, { status: "manual_reconciliation_required" }, now)
    : { ...batch, updatedAt: now };
  await failIngestionIfRunning(ctx, batch.ingestionId, error, now);
  await ctx.db.patch(progress._id, {
    activeState: "manual_reconciliation_required",
    activeBatch: {
      ...manualBatch,
      lastError: error.slice(0, 1_000),
      updatedAt: now,
    },
    updatedAt: now,
  });
}

function activePlan(progress: RefreshProgress | null, now: number): StatsRefreshScanPlan {
  return planStatsRefreshScan(
    progress
      ? {
          historyCursor: progress.historyCursor,
          historyCompletedAt: progress.historyCompletedAt,
          freshnessWindowStartedAfter: progress.freshnessWindowStartedAfter,
          freshnessCursor: progress.freshnessCursor,
          freshnessNextAt: progress.freshnessNextAt,
        }
      : undefined,
    now,
  );
}

function matchesPlan(
  plan: StatsRefreshScanPlan,
  args: {
    mode: "freshness" | "history" | "rollup";
    scanStartedAfter: number;
    scanCursorBefore?: string;
  },
): boolean {
  if (plan.mode !== args.mode) return false;
  if (plan.mode === "rollup") return args.scanStartedAfter === 0 && !args.scanCursorBefore;
  return plan.startedAfter === args.scanStartedAfter && sameCursor(plan.cursor ?? undefined, args.scanCursorBefore);
}

function cursorAdvancePatch(progress: RefreshProgress, batch: ActiveBatch, now: number) {
  if (batch.mode === "history") {
    return batch.scanIsDone
      ? { historyCursor: undefined, historyCompletedAt: now }
      : { historyCursor: batch.scanCursorAfter };
  }
  if (batch.mode === "freshness") {
    return batch.scanIsDone
      ? {
          freshnessWindowStartedAfter: undefined,
          freshnessCursor: undefined,
          freshnessNextAt: now + STATS_REFRESH_FRESHNESS_CADENCE_MS,
        }
      : {
          freshnessWindowStartedAfter: batch.scanStartedAfter,
          freshnessCursor: batch.scanCursorAfter,
        };
  }
  return {};
}

/** List active work separately so fleet rotation cannot hide an interrupted batch. */
export const listActive = query({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    await requireStudioServiceIdentity(ctx, args.ownerId, "Analytics refresh active-work read");
    const limit = args.limit ?? STATS_REFRESH_MAX_CHANNELS_PER_RUN;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > STATS_REFRESH_MAX_CHANNELS_PER_RUN) {
      throw new Error(`analytics refresh active limit must be 1..${STATS_REFRESH_MAX_CHANNELS_PER_RUN}`);
    }
    const [active, manual] = await Promise.all([
      ctx.db
        .query("analyticsRefreshCursors")
        .withIndex("by_owner_active_updated", (q) =>
          q.eq("ownerId", args.ownerId).eq("activeState", "active"),
        )
        .order("asc")
        .take(limit),
      ctx.db
        .query("analyticsRefreshCursors")
        .withIndex("by_owner_active_updated", (q) =>
          q.eq("ownerId", args.ownerId).eq("activeState", "manual_reconciliation_required"),
        )
        .order("asc")
        .take(limit),
    ]);
    return {
      active: active.map((row) => ({ channelId: row.channelId, updatedAt: row.updatedAt })),
      manual: manual.map((row) => ({
        channelId: row.channelId,
        updatedAt: row.updatedAt,
        lastError: row.activeBatch?.lastError ?? "manual reconciliation required",
      })),
    };
  },
});

/**
 * Claim the single worker lease for an active batch. A concurrent core sees
 * `busy` and performs no provider work. If the owner vanished beyond its
 * lease while any external stage remains unresolved, the batch stops visibly.
 * When both provider replies are already durable, a new generation may claim
 * only the local atomic commit without reissuing either provider request.
 */
export const claimWorker = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    batchKey: v.string(),
    batchGeneration: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    assertFiniteNonNegative(args.now, "worker claim time");
    assertFiniteNonNegative(args.batchGeneration, "worker batch generation");
    const binding: RefreshBinding = args;
    await requireRefreshBinding(ctx, binding);
    const progress = await exactProgress(ctx, args.ownerId, args.channelId);
    const batch = activeBatchOrThrow(progress, binding, args.batchKey);
    if (progress!.activeState === "manual_reconciliation_required") {
      return {
        action: "manual_reconciliation_required" as const,
        reason: batch.lastError ?? "manual reconciliation required",
      };
    }
    if (
      batch.generation === undefined ||
      batch.commitDeadlineAt === undefined ||
      batch.commitFailureCount === undefined
    ) {
      const error = "active stats-refresh batch lacks durable worker fencing; manual reconciliation required";
      await markManual(ctx, progress!, batch, error, args.now);
      return { action: "manual_reconciliation_required" as const, reason: error };
    }
    if (batch.generation !== args.batchGeneration) {
      return { action: "stale" as const };
    }
    if (batch.commitFailureCount > 0 && batch.commitDeadlineAt <= args.now) {
      const error = "stats-refresh commit deadline expired before successful local finalization";
      await markManual(ctx, progress!, batch, error, args.now);
      return { action: "manual_reconciliation_required" as const, reason: error };
    }
    if (batch.workerLeaseToken || batch.workerLeaseExpiresAt !== undefined) {
      const leaseIsLive = Boolean(
        batch.workerLeaseToken &&
        batch.workerLeaseExpiresAt !== undefined &&
        batch.workerLeaseExpiresAt > args.now,
      );
      if (leaseIsLive) return { action: "busy" as const };
      if (!hasDurablyFetchedProviderResponses(batch)) {
        const error = "stats-refresh worker lease expired before an external stage was durably resolved; manual reconciliation required";
        await markManual(ctx, progress!, batch, error, args.now);
        return { action: "manual_reconciliation_required" as const, reason: error };
      }
      // No provider work remains. A new generation fences the late owner while
      // allowing a fresh worker to atomically commit only the cached facts.
      const recoveredGeneration = Math.max(
        progress!.nextBatchGeneration ?? batch.generation,
        batch.generation,
      ) + 1;
      const recovered = claimBatchWorker(batch, recoveredGeneration, args.now);
      await ctx.db.patch(progress!._id, {
        nextBatchGeneration: recoveredGeneration,
        activeBatch: recovered.batch,
        updatedAt: args.now,
      });
      return { action: "claimed" as const, batch: recovered.batch, workerToken: recovered.workerToken };
    }
    const claimed = claimBatchWorker(batch, batch.generation, args.now);
    await ctx.db.patch(progress!._id, {
      activeBatch: claimed.batch,
      updatedAt: args.now,
    });
    return { action: "claimed" as const, batch: claimed.batch, workerToken: claimed.workerToken };
  },
});

/**
 * Terminal stop used when the active connector can no longer be trusted or
 * even loaded. This deliberately verifies service ownership but never reads
 * or validates the connector, so revoked/deleted credentials cannot retain an
 * active-slot lease forever. Transient evidence is always a no-op/busy result,
 * never a terminal mutation of another live worker.
 */
export const quarantineActiveBatch = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    reason: v.string(),
    evidence: v.union(v.literal("deterministic_invalid"), v.literal("transient")),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    assertFiniteNonNegative(args.now, "quarantine time");
    await requireStudioServiceIdentity(ctx, args.ownerId, "Analytics refresh connector quarantine");
    const progress = await exactProgress(ctx, args.ownerId, args.channelId);
    if (!progress?.activeBatch) return { action: "no_active_batch" as const };
    if (progress.activeState === "manual_reconciliation_required") {
      return {
        action: "manual_reconciliation_required" as const,
        reason: progress.activeBatch.lastError ?? "manual reconciliation required",
      };
    }
    if (args.evidence === "transient") {
      const leaseIsLive = Boolean(
        progress.activeBatch.workerLeaseToken &&
        progress.activeBatch.workerLeaseExpiresAt !== undefined &&
        progress.activeBatch.workerLeaseExpiresAt > args.now,
      );
      return { action: leaseIsLive ? "busy" as const : "retry_later" as const };
    }
    const error = `connector unavailable while stats-refresh batch was active: ${args.reason}`.slice(0, 1_000);
    await markManual(ctx, progress, progress.activeBatch, error, args.now);
    return { action: "manual_reconciliation_required" as const, reason: error };
  },
});

/** Return the next durable plan, a frozen batch, or a visible manual stop. */
export const acquire = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    cadenceKey: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    assertFiniteNonNegative(args.now, "acquisition time");
    assertCadenceKey(args.cadenceKey);
    const binding: RefreshBinding = args;
    await requireRefreshBinding(ctx, binding);
    const progress = await exactProgress(ctx, args.ownerId, args.channelId);
    if (progress?.activeBatch) {
      if (progress.activeState === "manual_reconciliation_required") {
        return {
          action: "manual_reconciliation_required" as const,
          reason: progress.activeBatch.lastError ?? "manual reconciliation required",
        };
      }
      if (!sameConnector(progress.activeBatch, binding)) {
        const error = "connector changed while stats-refresh batch was active";
        await markManual(ctx, progress, progress.activeBatch, error, args.now);
        return { action: "manual_reconciliation_required" as const, reason: error };
      }
      return { action: "resume" as const, batch: progress.activeBatch };
    }
    if (progress?.lastCompletedCadenceKey === args.cadenceKey) {
      return { action: "cadence_completed" as const };
    }
    return { action: "plan" as const, plan: activePlan(progress, args.now) };
  },
});

/**
 * Atomically bind one bounded run-history page (or rollup-only unit) to the
 * ingestion receipt. A concurrent task gets the same batch, never a second
 * Google request or an independent ingestion.
 */
export const admit = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    cadenceKey: v.string(),
    windowDate: v.string(),
    mode: v.union(v.literal("freshness"), v.literal("history"), v.literal("rollup")),
    scanStartedAfter: v.number(),
    scanCursorBefore: v.optional(v.string()),
    scanCursorAfter: v.optional(v.string()),
    scanIsDone: v.boolean(),
    videoIds: v.array(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    assertFiniteNonNegative(args.now, "admission time");
    assertCadenceKey(args.cadenceKey);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.windowDate)) {
      throw new Error("analytics refresh window date is invalid");
    }
    assertScanProgress(args);
    const videoIds = normalizeVideoIds(args.videoIds);
    const perPageLimit = args.mode === "freshness"
      ? STATS_REFRESH_RECENT_PAGE_LIMIT
      : args.mode === "history"
        ? STATS_REFRESH_HISTORY_PAGE_LIMIT
        : 0;
    if (videoIds.length > perPageLimit) {
      throw new Error(`analytics refresh ${args.mode} page exceeds its durable work budget`);
    }
    const binding: RefreshBinding = args;
    await requireRefreshBinding(ctx, binding);
    const progress = await exactProgress(ctx, args.ownerId, args.channelId);
    if (progress?.activeBatch) {
      if (progress.activeState === "manual_reconciliation_required") {
        return {
          action: "manual_reconciliation_required" as const,
          reason: progress.activeBatch.lastError ?? "manual reconciliation required",
        };
      }
      if (!sameConnector(progress.activeBatch, binding)) {
        const error = "connector changed while stats-refresh batch was active";
        await markManual(ctx, progress, progress.activeBatch, error, args.now);
        return { action: "manual_reconciliation_required" as const, reason: error };
      }
      return { action: "resume" as const, batch: progress.activeBatch };
    }
    if (progress?.lastCompletedCadenceKey === args.cadenceKey) {
      return { action: "cadence_completed" as const };
    }
    const plan = activePlan(progress, args.now);
    if (!matchesPlan(plan, args)) return { action: "stale_plan" as const };

    const generation = (progress?.nextBatchGeneration ?? 0) + 1;
    const ingestionId = await ctx.db.insert("analyticsIngestions", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      connectorId: args.connectorId,
      connectorVersion: args.connectorVersion,
      source: "youtube_data_api",
      metricDefinitionVersion: METRIC_DEFINITION_VERSION,
      windowStart: args.windowDate,
      windowEnd: args.windowDate,
      status: "running",
      recordsWritten: 0,
      startedAt: args.now,
    });
    const batch: ActiveBatch = {
      batchKey: `${args.cadenceKey}:${args.mode}:${args.scanCursorBefore ?? "start"}`,
      cadenceKey: args.cadenceKey,
      mode: args.mode,
      scanStartedAfter: args.scanStartedAfter,
      scanCursorBefore: args.scanCursorBefore,
      scanCursorAfter: args.scanCursorAfter,
      scanIsDone: args.scanIsDone,
      ingestionId,
      connectorId: args.connectorId,
      connectorVersion: args.connectorVersion,
      generation,
      workerLeaseAttempt: 0,
      videoIds,
      ...(videoIds.length === 0
        ? {
            videoStats: [],
            videoRequestStatus: "fetched" as const,
            videoStatsFetchedAt: args.now,
          }
        : { videoRequestStatus: "pending" as const }),
      channelRequestStatus: "pending",
      preDispatchFailureCount: 0,
      commitFailureCount: 0,
      commitDeadlineAt: args.now + STATS_REFRESH_COMMIT_DEADLINE_MS,
      createdAt: args.now,
      updatedAt: args.now,
    };
    if (progress) {
      await ctx.db.patch(progress._id, {
        connectorId: args.connectorId,
        connectorVersion: args.connectorVersion,
        nextBatchGeneration: generation,
        activeState: "active",
        activeBatch: batch,
        updatedAt: args.now,
      });
    } else {
      await ctx.db.insert("analyticsRefreshCursors", {
        ownerId: args.ownerId,
        channelId: args.channelId,
        connectorId: args.connectorId,
        connectorVersion: args.connectorVersion,
        nextBatchGeneration: generation,
        activeState: "active",
        activeBatch: batch,
        createdAt: args.now,
        updatedAt: args.now,
      });
    }
    return { action: "started" as const, batch };
  },
});

/** Persist the irreversible request marker before either Google Data API read. */
export const beginRequest = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    batchKey: v.string(),
    batchGeneration: v.number(),
    workerToken: v.string(),
    stage: v.union(v.literal("video"), v.literal("channel")),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    assertFiniteNonNegative(args.now, "request start time");
    const binding: RefreshBinding = args;
    await requireRefreshBinding(ctx, binding);
    const progress = await exactProgress(ctx, args.ownerId, args.channelId);
    const unfencedBatch = activeBatchOrThrow(progress, binding, args.batchKey);
    if (progress!.activeState === "manual_reconciliation_required") {
      return {
        action: "manual_reconciliation_required" as const,
        reason: unfencedBatch.lastError ?? "manual reconciliation required",
      };
    }
    const batch = activeWorkerOrThrow(progress, binding, args.batchKey, args, args.now);
    const status = requestStatus(batch, args.stage);
    if (status === "fetched") return { action: "reused" as const, batch };
    if (status === "manual_reconciliation_required") {
      return {
        action: "manual_reconciliation_required" as const,
        reason: batch.lastError ?? "manual reconciliation required",
      };
    }
    if (status === "request_started") {
      const error = `${args.stage} request was started without a durable response; manual reconciliation required`;
      await markManual(ctx, progress!, batch, error, args.now, args.stage);
      return { action: "manual_reconciliation_required" as const, reason: error };
    }
    const token = `${batch.batchKey}:${args.stage}:${args.now}`;
    const nextBatch = withRequestState(
      batch,
      args.stage,
      { status: "request_started", token, startedAt: args.now },
      args.now,
    );
    await ctx.db.patch(progress!._id, { activeBatch: nextBatch, updatedAt: args.now });
    return { action: "dispatch" as const, token };
  },
});

/** Save a known videos.list response against the exact durable request token. */
export const saveVideoStats = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    batchKey: v.string(),
    batchGeneration: v.number(),
    workerToken: v.string(),
    requestToken: v.string(),
    stats: v.array(videoStatValidator),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    assertFiniteNonNegative(args.now, "video response time");
    const binding: RefreshBinding = args;
    await requireRefreshBinding(ctx, binding);
    const progress = await exactProgress(ctx, args.ownerId, args.channelId);
    const batch = activeWorkerOrThrow(progress, binding, args.batchKey, args, args.now);
    if (batch.videoRequestStatus === "fetched") return { action: "reused" as const, batch };
    if (batch.videoRequestStatus !== "request_started" || batch.videoRequestToken !== args.requestToken) {
      throw new Error("analytics refresh video response does not match its durable request token");
    }
    assertVideoStats(batch, args.stats);
    await ctx.db.patch(progress!._id, {
      activeBatch: {
        ...withRequestState(batch, "video", { status: "fetched" }, args.now),
        videoStats: args.stats,
        videoStatsFetchedAt: args.now,
        updatedAt: args.now,
      },
      updatedAt: args.now,
    });
    return { action: "saved" as const };
  },
});

/** Save a known channels.list response against the exact durable request token. */
export const saveChannelRollup = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    batchKey: v.string(),
    batchGeneration: v.number(),
    workerToken: v.string(),
    requestToken: v.string(),
    rollup: channelRollupValidator,
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    assertFiniteNonNegative(args.now, "channel response time");
    const binding: RefreshBinding = args;
    await requireRefreshBinding(ctx, binding);
    const progress = await exactProgress(ctx, args.ownerId, args.channelId);
    const batch = activeWorkerOrThrow(progress, binding, args.batchKey, args, args.now);
    if (batch.channelRequestStatus === "fetched") return { action: "reused" as const, batch };
    if (batch.channelRequestStatus !== "request_started" || batch.channelRequestToken !== args.requestToken) {
      throw new Error("analytics refresh channel response does not match its durable request token");
    }
    assertChannelRollup(args.rollup);
    await ctx.db.patch(progress!._id, {
      activeBatch: {
        ...withRequestState(batch, "channel", { status: "fetched" }, args.now),
        channelRollup: args.rollup,
        channelRollupFetchedAt: args.now,
        updatedAt: args.now,
      },
      updatedAt: args.now,
    });
    return { action: "saved" as const };
  },
});

/** A post-marker error is ambiguous and therefore blocks automatic re-dispatch. */
export const markRequestAmbiguous = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    batchKey: v.string(),
    batchGeneration: v.number(),
    workerToken: v.string(),
    stage: v.union(v.literal("video"), v.literal("channel")),
    requestToken: v.string(),
    error: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    assertFiniteNonNegative(args.now, "ambiguity time");
    const binding: RefreshBinding = args;
    await requireRefreshBinding(ctx, binding);
    const progress = await exactProgress(ctx, args.ownerId, args.channelId);
    const batch = activeWorkerOrThrow(progress, binding, args.batchKey, args, args.now);
    if (requestStatus(batch, args.stage) === "fetched") {
      return { action: "already_fetched" as const };
    }
    if (
      requestStatus(batch, args.stage) !== "request_started" ||
      requestToken(batch, args.stage) !== args.requestToken
    ) {
      throw new Error("analytics refresh ambiguous request does not match its durable request token");
    }
    const error = `${args.stage} response is ambiguous after dispatch: ${args.error}`.slice(0, 1_000);
    await markManual(ctx, progress!, batch, error, args.now, args.stage);
    return { action: "manual_reconciliation_required" as const, reason: error };
  },
});

/** Local failures before a request marker are bounded; they never move the cursor. */
export const recordPreDispatchFailure = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    batchKey: v.string(),
    batchGeneration: v.number(),
    workerToken: v.string(),
    stage: v.union(v.literal("video"), v.literal("channel")),
    error: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    assertFiniteNonNegative(args.now, "pre-dispatch failure time");
    const binding: RefreshBinding = args;
    await requireRefreshBinding(ctx, binding);
    const progress = await exactProgress(ctx, args.ownerId, args.channelId);
    const batch = activeWorkerOrThrow(progress, binding, args.batchKey, args, args.now);
    if (requestStatus(batch, args.stage) !== "pending") {
      const error = `pre-dispatch request marker became uncertain: ${args.error}`.slice(0, 1_000);
      await markManual(ctx, progress!, batch, error, args.now, args.stage);
      return { action: "manual_reconciliation_required" as const, failureCount: batch.preDispatchFailureCount };
    }
    const failureCount = batch.preDispatchFailureCount + 1;
    const error = `pre-dispatch failure ${failureCount}: ${args.error}`.slice(0, 1_000);
    if (failureCount >= STATS_REFRESH_MAX_CONSECUTIVE_FAILURES) {
      await markManual(ctx, progress!, batch, error, args.now);
      return { action: "manual_reconciliation_required" as const, failureCount };
    }
    await ctx.db.patch(progress!._id, {
      activeBatch: {
        ...clearWorkerLease(batch, args.now),
        preDispatchFailureCount: failureCount,
        lastError: error,
        updatedAt: args.now,
      },
      updatedAt: args.now,
    });
    return { action: "retry_later" as const, failureCount };
  },
});

/**
 * Commit all local writes, ingestion finalization, and cursor movement in one
 * transaction. Replays either commit the same facts or leave no partial sink.
 */
export const commit = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    batchKey: v.string(),
    batchGeneration: v.number(),
    workerToken: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    assertFiniteNonNegative(args.now, "commit time");
    const binding: RefreshBinding = args;
    await requireRefreshBinding(ctx, binding);
    const progress = await exactProgress(ctx, args.ownerId, args.channelId);
    const unfencedBatch = activeBatchOrThrow(progress, binding, args.batchKey);
    if (progress!.activeState === "manual_reconciliation_required") {
      throw new Error(unfencedBatch.lastError ?? "analytics refresh requires manual reconciliation");
    }
    const batch = activeWorkerOrThrow(progress, binding, args.batchKey, args, args.now);
    if (
      batch.videoRequestStatus !== "fetched" ||
      batch.channelRequestStatus !== "fetched" ||
      !batch.videoStats ||
      !batch.channelRollup ||
      batch.videoStatsFetchedAt === undefined ||
      batch.channelRollupFetchedAt === undefined
    ) {
      throw new Error("analytics refresh cannot commit before both durable provider responses exist");
    }
    const ingestion = await ctx.db.get(batch.ingestionId);
    if (!ingestion || ingestion.status !== "running") {
      throw new Error("analytics refresh ingestion is not in a committable state");
    }

    for (const stat of batch.videoStats) {
      const existing = await ctx.db
        .query("videoAnalytics")
        .withIndex("by_ingestion_video", (q) =>
          q.eq("ingestionId", batch.ingestionId).eq("youtubeVideoId", stat.youtubeVideoId),
        )
        .unique();
      const releaseProvenance = await ctx.db
        .query("videoReleaseProvenance")
        .withIndex("by_owner_youtube_video", (q) =>
          q.eq("ownerId", args.ownerId).eq("youtubeVideoId", stat.youtubeVideoId),
        )
        .unique();
      if (releaseProvenance && releaseProvenance.channelId !== args.channelId) {
        throw new Error("analytics refresh release provenance channel mismatch");
      }
      const snapshot = {
        ownerId: args.ownerId,
        channelId: args.channelId,
        connectorId: args.connectorId,
        connectorVersion: args.connectorVersion,
        ingestionId: batch.ingestionId,
        source: "youtube_data_api" as const,
        metricDefinitionVersion: METRIC_DEFINITION_VERSION,
        windowStart: ingestion.windowStart,
        windowEnd: ingestion.windowEnd,
        confidence: "high" as const,
        youtubeVideoId: stat.youtubeVideoId,
        views: stat.views,
        likes: stat.likes,
        comments: stat.comments,
        ...(existing?.observedReleaseProvenance
          ? { observedReleaseProvenance: existing.observedReleaseProvenance }
          : !releaseProvenance
            ? {}
            : {
                observedReleaseProvenance: observedVideoReleaseProvenanceFromRecord(releaseProvenance),
              }),
        snapshotAt: batch.videoStatsFetchedAt,
      };
      if (existing) await ctx.db.patch(existing._id, snapshot);
      else await ctx.db.insert("videoAnalytics", snapshot);
    }

    const totalViews = batch.videoStats.reduce((sum, stat) => sum + stat.views, 0);
    const rollup = batch.channelRollup;
    const sameDay = await ctx.db
      .query("channelAnalytics")
      .withIndex("by_channel_date", (q) =>
        q.eq("channelId", args.channelId).eq("date", ingestion.windowEnd),
      )
      .unique();
    const prior = await ctx.db
      .query("channelAnalytics")
      .withIndex("by_channel_date", (q) =>
        q.eq("channelId", args.channelId).lt("date", ingestion.windowEnd),
      )
      .order("desc")
      .first();
    const subscriberDelta = prior ? rollup.subscriberCount - prior.subscriberCount : 0;
    const channelDay = {
      ownerId: args.ownerId,
      channelId: args.channelId,
      connectorId: args.connectorId,
      connectorVersion: args.connectorVersion,
      ingestionId: batch.ingestionId,
      source: "youtube_data_api" as const,
      metricDefinitionVersion: METRIC_DEFINITION_VERSION,
      confidence: rollup.found ? "high" as const : "medium" as const,
      date: ingestion.windowEnd,
      totalViews: rollup.found && rollup.viewCount ? rollup.viewCount : totalViews,
      subscriberCount: rollup.subscriberCount,
      subscriberDelta,
      videoCount: rollup.found && rollup.videoCount ? rollup.videoCount : batch.videoStats.length,
    };
    if (sameDay) await ctx.db.patch(sameDay._id, channelDay);
    else await ctx.db.insert("channelAnalytics", channelDay);

    await ctx.db.patch(ingestion._id, {
      status: "completed",
      recordsWritten: batch.videoStats.length + 1,
      finishedAt: args.now,
      lastError: undefined,
    });
    await ctx.db.patch(progress!._id, {
      ...cursorAdvancePatch(progress!, batch, args.now),
      lastCompletedCadenceKey: batch.cadenceKey,
      lastCompletedAt: args.now,
      activeState: undefined,
      activeBatch: undefined,
      updatedAt: args.now,
    });
    return { action: "committed" as const, recordsWritten: batch.videoStats.length + 1 };
  },
});

/**
 * A local commit failure never repeats provider work. It is retried only with
 * the cached responses, at most a small number of times and only before the
 * frozen batch deadline. The lease is released for a safe later local retry.
 */
export const recordCommitFailure = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    batchKey: v.string(),
    batchGeneration: v.number(),
    workerToken: v.string(),
    error: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    assertFiniteNonNegative(args.now, "commit failure time");
    const binding: RefreshBinding = args;
    await requireRefreshBinding(ctx, binding);
    const progress = await exactProgress(ctx, args.ownerId, args.channelId);
    const batch = activeWorkerOrThrow(progress, binding, args.batchKey, args, args.now);
    const commitFailureCount = (batch.commitFailureCount ?? 0) + 1;
    const error = `local commit failure ${commitFailureCount}: ${args.error}`.slice(0, 1_000);
    if (
      batch.commitDeadlineAt === undefined ||
      commitFailureCount >= STATS_REFRESH_MAX_COMMIT_FAILURES ||
      args.now >= batch.commitDeadlineAt
    ) {
      await markManual(ctx, progress!, batch, error, args.now);
      return { action: "manual_reconciliation_required" as const, commitFailureCount };
    }
    await ctx.db.patch(progress!._id, {
      activeBatch: {
        ...clearWorkerLease(batch, args.now),
        commitFailureCount,
        lastError: error,
        updatedAt: args.now,
      },
      updatedAt: args.now,
    });
    return { action: "retry_later" as const, commitFailureCount };
  },
});
