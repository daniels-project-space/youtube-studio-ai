import { mutation, query } from "./studioFunctions";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  hasAnyScope,
  hasYouTubeAnalyticsReportScopes,
} from "../src/lib/publishingPolicy";
import {
  LEARNING_ANALYTICS_BATCH_LIMIT,
  LEARNING_ANALYTICS_BATCH_WORKER_LEASE_MS,
  LEARNING_ANALYTICS_FRESHNESS_CADENCE_MS,
  LEARNING_ANALYTICS_HTTP_DISPATCH_WINDOW_MS,
  LEARNING_ANALYTICS_METRIC_DEFINITION_V2,
  planLearningAnalyticsScan,
  resolveLearningAnalyticsMetricDefinitionVersion,
} from "../src/lib/learningRefreshCheckpoint";
import { sha256Hex } from "../src/lib/sha256";

const DATA_READ_SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.readonly",
] as const;

function assertInternalSecret(secret: string): void {
  const expected = process.env.INTERNAL_QUERY_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("analyticsIngestions: invalid internal secret");
  }
}

const learningItemValidator = v.object({
  runId: v.id("runs"),
  youtubeVideoId: v.string(),
  publishedAt: v.number(),
});

type LearningItem = {
  runId: Id<"runs">;
  youtubeVideoId: string;
  publishedAt: number;
  requestStatus: "pending" | "request_started" | "request_dispatch_started" | "fetched" | "ambiguous";
  requestStartedAt?: number;
  requestDispatchStartedAt?: number;
  // The request-start marker is intentionally not enough to call the remote
  // API. This short-lived, single-use capability is consumed immediately
  // before the HTTP helper crosses its outbound boundary.
  requestDispatchCapabilityToken?: string;
  requestDispatchCapabilityExpiresAt?: number;
  requestDispatchCapabilityConsumedAt?: number;
  requestDispatchHttpDeadlineAt?: number;
  fetchedAt?: number;
  ambiguousAt?: number;
  lastError?: string;
  views?: number;
  engagedViews?: number;
  avgViewPct?: number;
  ctr?: number;
  title?: string;
  topic?: string;
  thumbnailStrategy?: string;
};

type LearningBatch = {
  batchKey: string;
  mode: "history" | "freshness";
  scanStartedAfter: number;
  scanCursorBefore?: string;
  scanCursorAfter?: string;
  scanIsDone: boolean;
  ingestionId: Id<"analyticsIngestions">;
  // Missing means the legacy v1 query shape. New batches must freeze v2.
  metricDefinitionVersion?: string;
  // Immutable provenance for this frozen page. Optional only so a batch
  // written before this fence can be quarantined instead of being trusted.
  connectorId?: Id<"youtubeAuth">;
  connectorVersion?: number;
  status: "collecting" | "ledger_write_started" | "manual_reconciliation_required";
  items: LearningItem[];
  ledgerWriteStartedAt?: number;
  ledgerFingerprint?: string;
  workerLeaseToken?: string;
  workerLeaseGeneration?: number;
  workerLeaseExpiresAt?: number;
  workerHeartbeatAt?: number;
  createdAt: number;
  updatedAt: number;
};

type LearningBatchWorkerLease = {
  workerLeaseToken: string;
  workerLeaseGeneration: number;
};

type BoundLearningProgress = {
  _id: Id<"learningAnalyticsProgress">;
  connectorId: Id<"youtubeAuth">;
  connectorVersion: number;
};

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`learning analytics ${label} must be a finite non-negative number`);
  }
}

async function requireLearningBinding(
  ctx: Pick<QueryCtx, "db">,
  args: {
    ownerId: string;
    channelId: Id<"channels">;
    connectorId: Id<"youtubeAuth">;
    connectorVersion: number;
  },
) {
  const [channel, connector] = await Promise.all([
    ctx.db.get(args.channelId),
    ctx.db.get(args.connectorId),
  ]);
  if (!channel || channel.ownerId !== args.ownerId) {
    throw new Error("learning analytics channel owner mismatch");
  }
  if (
    !connector ||
    connector.ownerId !== args.ownerId ||
    connector.channelId !== args.channelId ||
    (connector.tokenVersion ?? 1) !== args.connectorVersion ||
    (connector.status ?? "active") !== "active" ||
    !hasYouTubeAnalyticsReportScopes(connector.grantedScopes ?? [])
  ) {
    throw new Error("learning analytics connector provenance/scope mismatch");
  }
  return { channel, connector };
}

async function exactLearningProgress(
  ctx: Pick<QueryCtx, "db">,
  ownerId: string,
  channelId: Id<"channels">,
) {
  return await ctx.db
    .query("learningAnalyticsProgress")
    .withIndex("by_owner_channel", (q) =>
      q.eq("ownerId", ownerId).eq("channelId", channelId),
    )
    .unique();
}

function sameLearningConnector(
  progress: {
    connectorId: Id<"youtubeAuth">;
    connectorVersion: number;
  },
  connectorId: Id<"youtubeAuth">,
  connectorVersion: number,
): boolean {
  return progress.connectorId === connectorId &&
    progress.connectorVersion === connectorVersion;
}

function assertBatchCursor(args: {
  scanIsDone: boolean;
  scanCursorAfter?: string;
}): void {
  if (!args.scanIsDone && !args.scanCursorAfter?.trim()) {
    throw new Error("learning analytics unfinished page is missing its durable continuation cursor");
  }
}

function advanceLearningProgressPatch(
  existing: {
    freshnessWindowStartedAfter?: number;
  } | null,
  batch: Pick<LearningBatch, "mode" | "scanStartedAfter" | "scanCursorAfter" | "scanIsDone">,
  now: number,
) {
  if (batch.mode === "history") {
    return batch.scanIsDone
      ? {
          historyCursor: undefined,
          historyCompletedAt: now,
        }
      : {
          historyCursor: batch.scanCursorAfter,
        };
  }
  if (batch.scanIsDone) {
    return {
      freshnessWindowStartedAfter: undefined,
      freshnessCursor: undefined,
      freshnessNextAt: now + LEARNING_ANALYTICS_FRESHNESS_CADENCE_MS,
    };
  }
  return {
    freshnessWindowStartedAfter:
      existing?.freshnessWindowStartedAfter ?? batch.scanStartedAfter,
    freshnessCursor: batch.scanCursorAfter,
  };
}

function boundedProcessedVideoIds(
  existing: readonly string[],
  terminalItems: readonly LearningItem[],
): string[] {
  const seen = new Set(existing);
  const merged = [...existing];
  for (const item of terminalItems) {
    if (!seen.has(item.youtubeVideoId)) {
      seen.add(item.youtubeVideoId);
      merged.push(item.youtubeVideoId);
    }
  }
  // Keep in lockstep with performance.json's intentionally bounded retention.
  return merged.slice(-300);
}

function batchErrors(batch: LearningBatch): string | undefined {
  const errors = batch.items
    .filter((item) => item.requestStatus === "ambiguous")
    .map((item) => `${item.youtubeVideoId}: ${item.lastError ?? "analytics outcome unresolved"}`);
  return errors.length ? errors.join(" | ").slice(0, 1_000) : undefined;
}

function assertActiveBatchWorkerLease(
  batch: LearningBatch,
  args: LearningBatchWorkerLease & { now: number },
): void {
  if (!args.workerLeaseToken.trim()) {
    throw new Error("learning analytics batch worker lease token is required");
  }
  if (!Number.isSafeInteger(args.workerLeaseGeneration) || args.workerLeaseGeneration < 1) {
    throw new Error("learning analytics batch worker lease generation is invalid");
  }
  if (
    batch.workerLeaseToken !== args.workerLeaseToken ||
    batch.workerLeaseGeneration !== args.workerLeaseGeneration ||
    (batch.workerLeaseExpiresAt ?? 0) <= args.now
  ) {
    throw new Error("learning analytics active batch worker lease is no longer owned");
  }
}

function heartbeatBatchWorkerLease(
  batch: LearningBatch,
  now: number,
): LearningBatch {
  return {
    ...batch,
    workerHeartbeatAt: now,
    workerLeaseExpiresAt: now + LEARNING_ANALYTICS_BATCH_WORKER_LEASE_MS,
    updatedAt: now,
  };
}

function mintLearningItemDispatchCapability(): string {
  const token = globalThis.crypto?.randomUUID?.();
  if (!token) {
    throw new Error("learning analytics dispatch capability could not be minted");
  }
  return token;
}

/**
 * A frozen batch must stay attached to precisely the same connector as its
 * durable progress row and its caller.  The live connector check is performed
 * inside the mutation immediately before returning permission for an external
 * Analytics GET, closing the token-rotation/revocation TOCTOU window.
 */
async function learningBatchConnectorBindingFailure(
  ctx: Pick<QueryCtx, "db">,
  progress: BoundLearningProgress,
  batch: LearningBatch,
  args: {
    ownerId: string;
    channelId: Id<"channels">;
    connectorId: Id<"youtubeAuth">;
    connectorVersion: number;
  },
): Promise<string | undefined> {
  if (batch.connectorId === undefined || batch.connectorVersion === undefined) {
    return "active batch is missing immutable connector provenance";
  }
  if (!sameLearningConnector(progress, args.connectorId, args.connectorVersion)) {
    return "caller connector does not match durable learning progress";
  }
  if (
    batch.connectorId !== args.connectorId ||
    batch.connectorVersion !== args.connectorVersion
  ) {
    return "caller connector does not match the frozen active batch";
  }
  try {
    await requireLearningBinding(ctx, args);
  } catch {
    return "connector is no longer live, active, and Analytics-authorized for this channel";
  }
  return undefined;
}

async function quarantineLearningBatchForConnectorBinding(
  ctx: Pick<MutationCtx, "db">,
  progress: BoundLearningProgress,
  batch: LearningBatch,
  now: number,
  reason: string,
) {
  const recordsWritten = batch.items.filter((item) => item.requestStatus === "fetched").length;
  const manualBatch: LearningBatch = {
    ...heartbeatBatchWorkerLease(batch, now),
    status: "manual_reconciliation_required",
  };
  await ctx.db.patch(batch.ingestionId, {
    status: recordsWritten > 0 ? "partial" : "failed",
    recordsWritten,
    lastError: `analytics connector binding changed: ${reason}`.slice(0, 1_000),
    finishedAt: now,
  });
  await ctx.db.patch(progress._id, {
    activeBatch: manualBatch,
    updatedAt: now,
  });
  return {
    action: "manual_reconciliation_required" as const,
    reason,
    batch: manualBatch,
  };
}

export const start = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    source: v.union(
      v.literal("youtube_data_api"),
      v.literal("youtube_analytics_api"),
    ),
    metricDefinitionVersion: v.string(),
    windowStart: v.string(),
    windowEnd: v.string(),
    startedAt: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    const [channel, connector] = await Promise.all([
      ctx.db.get(args.channelId),
      ctx.db.get(args.connectorId),
    ]);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("analyticsIngestions.start: channel owner mismatch");
    }
    if (
      !connector ||
      connector.ownerId !== args.ownerId ||
      connector.channelId !== args.channelId ||
      (connector.tokenVersion ?? 1) !== args.connectorVersion ||
      (connector.status ?? "active") !== "active"
    ) {
      throw new Error("analyticsIngestions.start: connector binding invalid");
    }
    const scopes = connector.grantedScopes ?? [];
    const scopeOk =
      args.source === "youtube_analytics_api"
        ? hasYouTubeAnalyticsReportScopes(scopes)
        : hasAnyScope(scopes, DATA_READ_SCOPES);
    if (!scopeOk) {
      throw new Error("analyticsIngestions.start: required OAuth scope missing");
    }
    return await ctx.db.insert("analyticsIngestions", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      connectorId: args.connectorId,
      connectorVersion: args.connectorVersion,
      source: args.source,
      metricDefinitionVersion: args.metricDefinitionVersion,
      windowStart: args.windowStart,
      windowEnd: args.windowEnd,
      status: "running",
      recordsWritten: 0,
      startedAt: args.startedAt,
    });
  },
});

export const finish = mutation({
  args: {
    secret: v.string(),
    ingestionId: v.id("analyticsIngestions"),
    status: v.union(
      v.literal("completed"),
      v.literal("partial"),
      v.literal("failed"),
    ),
    recordsWritten: v.number(),
    lastError: v.optional(v.string()),
    finishedAt: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    const row = await ctx.db.get(args.ingestionId);
    if (!row) throw new Error("analyticsIngestions.finish: ingestion not found");
    if (row.status !== "running" && row.status !== args.status) {
      throw new Error("analyticsIngestions.finish: terminal state conflict");
    }
    await ctx.db.patch(row._id, {
      status: args.status,
      recordsWritten: args.recordsWritten,
      lastError: args.lastError?.slice(0, 1_000),
      finishedAt: args.finishedAt,
    });
    return await ctx.db.get(row._id);
  },
});

/**
 * Read the one permitted next unit of work for a channel.  The caller must
 * fetch one page only; it cannot use this endpoint to restart a completed
 * history scan or to bypass an unresolved write boundary.
 */
export const nextLearningBatch = query({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    assertFiniteNonNegative(args.now, "scan time");
    await requireLearningBinding(ctx, args);
    const progress = await exactLearningProgress(ctx, args.ownerId, args.channelId);
    if (progress && !sameLearningConnector(progress, args.connectorId, args.connectorVersion)) {
      return {
        kind: "manual_reconciliation_required" as const,
        reason: "analytics connector changed while durable learning progress exists",
      };
    }
    if (progress?.activeBatch) {
      return { kind: "resume" as const, batch: progress.activeBatch as LearningBatch };
    }
    const plan = planLearningAnalyticsScan(progress, args.now);
    if (plan.kind === "idle") return plan;
    return {
      kind: "scan" as const,
      mode: plan.kind,
      startedAfter: plan.startedAfter,
      cursor: plan.cursor ?? null,
    };
  },
});

/**
 * Atomically bind a bounded run-history page to a durable batch and its
 * ingestion receipt.  A concurrent manual/scheduled execution receives the
 * existing batch and cannot create a second set of Analytics calls.
 */
export const admitLearningBatch = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    mode: v.union(v.literal("history"), v.literal("freshness")),
    scanStartedAfter: v.number(),
    scanCursorBefore: v.optional(v.string()),
    scanCursorAfter: v.optional(v.string()),
    scanIsDone: v.boolean(),
    settledBefore: v.number(),
    candidates: v.array(learningItemValidator),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    assertFiniteNonNegative(args.now, "admission time");
    assertFiniteNonNegative(args.scanStartedAfter, "scan lower bound");
    assertFiniteNonNegative(args.settledBefore, "settlement cutoff");
    if (args.candidates.length > LEARNING_ANALYTICS_BATCH_LIMIT) {
      throw new Error(`learning analytics batch exceeds ${LEARNING_ANALYTICS_BATCH_LIMIT} items`);
    }
    assertBatchCursor(args);
    await requireLearningBinding(ctx, args);
    const progress = await exactLearningProgress(ctx, args.ownerId, args.channelId);
    if (progress && !sameLearningConnector(progress, args.connectorId, args.connectorVersion)) {
      return {
        action: "manual_reconciliation_required" as const,
        reason: "analytics connector changed while durable learning progress exists",
      };
    }
    if (progress?.activeBatch) {
      return { action: "resume" as const, batch: progress.activeBatch as LearningBatch };
    }

    const plan = planLearningAnalyticsScan(progress, args.now);
    if (plan.kind === "idle") return { action: "idle" as const, notBefore: plan.notBefore };
    if (
      plan.kind !== args.mode ||
      plan.startedAfter !== args.scanStartedAfter ||
      (plan.cursor ?? undefined) !== (args.scanCursorBefore ?? undefined)
    ) {
      throw new Error("learning analytics admission does not match the durable scan plan");
    }

    const seenRunIds = new Set<string>();
    const seenVideoIds = new Set<string>();
    const candidates: Array<{ runId: Id<"runs">; youtubeVideoId: string; publishedAt: number }> = [];
    for (const candidate of args.candidates) {
      if (!candidate.youtubeVideoId.trim()) {
        throw new Error("learning analytics candidate video id is required");
      }
      assertFiniteNonNegative(candidate.publishedAt, "candidate publish time");
      if (candidate.publishedAt > args.settledBefore) {
        throw new Error("learning analytics candidate has not reached its settlement cutoff");
      }
      if (seenRunIds.has(String(candidate.runId)) || seenVideoIds.has(candidate.youtubeVideoId)) {
        throw new Error("learning analytics page contains duplicate run/video candidates");
      }
      seenRunIds.add(String(candidate.runId));
      seenVideoIds.add(candidate.youtubeVideoId);
      const run = await ctx.db.get(candidate.runId);
      if (
        !run ||
        run.ownerId !== args.ownerId ||
        run.channelId !== args.channelId ||
        run.youtubeVideoId !== candidate.youtubeVideoId ||
        run.finishedAt !== candidate.publishedAt
      ) {
        throw new Error("learning analytics candidate no longer matches its bound run");
      }
      candidates.push(candidate);
    }

    const processed = new Set(progress?.processedVideoIds ?? []);
    const items: LearningItem[] = candidates
      .filter((candidate) => !processed.has(candidate.youtubeVideoId))
      .map((candidate) => ({ ...candidate, requestStatus: "pending" as const }));
    const advance = advanceLearningProgressPatch(progress, {
      mode: args.mode,
      scanStartedAfter: args.scanStartedAfter,
      scanCursorAfter: args.scanCursorAfter,
      scanIsDone: args.scanIsDone,
    }, args.now);

    if (items.length === 0) {
      if (progress) {
        await ctx.db.patch(progress._id, { ...advance, updatedAt: args.now });
      } else {
        await ctx.db.insert("learningAnalyticsProgress", {
          ownerId: args.ownerId,
          channelId: args.channelId,
          connectorId: args.connectorId,
          connectorVersion: args.connectorVersion,
          processedVideoIds: [],
          ...advance,
          createdAt: args.now,
          updatedAt: args.now,
        });
      }
      return { action: "advanced" as const, mode: args.mode, scanIsDone: args.scanIsDone };
    }

    const ingestionId = await ctx.db.insert("analyticsIngestions", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      connectorId: args.connectorId,
      connectorVersion: args.connectorVersion,
      source: "youtube_analytics_api" as const,
      metricDefinitionVersion: LEARNING_ANALYTICS_METRIC_DEFINITION_V2,
      windowStart: new Date(Math.min(...items.map((item) => item.publishedAt))).toISOString().slice(0, 10),
      windowEnd: new Date(args.now).toISOString().slice(0, 10),
      status: "running" as const,
      recordsWritten: 0,
      startedAt: args.now,
    });
    const batch: LearningBatch = {
      batchKey: `learning:${args.mode}:${sha256Hex(JSON.stringify({
        channelId: String(args.channelId),
        startedAfter: args.scanStartedAfter,
        cursor: args.scanCursorBefore ?? null,
        runs: items.map((item) => String(item.runId)),
      }))}`,
      mode: args.mode,
      scanStartedAfter: args.scanStartedAfter,
      ...(args.scanCursorBefore ? { scanCursorBefore: args.scanCursorBefore } : {}),
      ...(args.scanCursorAfter ? { scanCursorAfter: args.scanCursorAfter } : {}),
      scanIsDone: args.scanIsDone,
      ingestionId,
      metricDefinitionVersion: LEARNING_ANALYTICS_METRIC_DEFINITION_V2,
      connectorId: args.connectorId,
      connectorVersion: args.connectorVersion,
      status: "collecting",
      items,
      createdAt: args.now,
      updatedAt: args.now,
    };
    if (progress) {
      await ctx.db.patch(progress._id, { activeBatch: batch, updatedAt: args.now });
    } else {
      await ctx.db.insert("learningAnalyticsProgress", {
        ownerId: args.ownerId,
        channelId: args.channelId,
        connectorId: args.connectorId,
        connectorVersion: args.connectorVersion,
        processedVideoIds: [],
        activeBatch: batch,
        createdAt: args.now,
        updatedAt: args.now,
      });
    }
    return { action: "admitted" as const, batch };
  },
});

/**
 * Single-flight the external Analytics/ledger boundaries for an active batch.
 * A second schedule/manual invocation receives `busy` while the live worker's
 * lease exists; only a bounded expired lease can be recovered.
 */
export const claimLearningBatchWorker = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    batchKey: v.string(),
    workerLeaseToken: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    assertFiniteNonNegative(args.now, "worker claim time");
    if (!args.workerLeaseToken.trim() || args.workerLeaseToken.length > 300) {
      throw new Error("learning analytics batch worker lease token is invalid");
    }
    const progress = await exactLearningProgress(ctx, args.ownerId, args.channelId);
    const batch = progress?.activeBatch as LearningBatch | undefined;
    if (!progress || !batch || batch.batchKey !== args.batchKey) {
      throw new Error("learning analytics active batch is missing");
    }
    if (batch.status === "manual_reconciliation_required") {
      return { action: "manual_reconciliation_required" as const, batch };
    }
    const hasLiveOtherWorker =
      (batch.workerLeaseExpiresAt ?? 0) > args.now &&
      batch.workerLeaseToken !== args.workerLeaseToken;
    if (hasLiveOtherWorker) {
      return {
        action: "busy" as const,
        leaseExpiresAt: batch.workerLeaseExpiresAt,
      };
    }
    const generation = batch.workerLeaseToken === args.workerLeaseToken &&
      (batch.workerLeaseExpiresAt ?? 0) > args.now
      ? batch.workerLeaseGeneration ?? 1
      : (batch.workerLeaseGeneration ?? 0) + 1;
    const nextBatch: LearningBatch = {
      ...batch,
      workerLeaseToken: args.workerLeaseToken,
      workerLeaseGeneration: generation,
      workerHeartbeatAt: args.now,
      workerLeaseExpiresAt: args.now + LEARNING_ANALYTICS_BATCH_WORKER_LEASE_MS,
      updatedAt: args.now,
    };
    await ctx.db.patch(progress._id, { activeBatch: nextBatch, updatedAt: args.now });
    return {
      action: "claimed" as const,
      batch: nextBatch,
      workerLeaseGeneration: generation,
      workerLeaseExpiresAt: nextBatch.workerLeaseExpiresAt,
    };
  },
});

export const startLearningItemRequest = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    batchKey: v.string(),
    runId: v.id("runs"),
    workerLeaseToken: v.string(),
    workerLeaseGeneration: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    assertFiniteNonNegative(args.now, "request start time");
    const progress = await exactLearningProgress(ctx, args.ownerId, args.channelId);
    const batch = progress?.activeBatch as LearningBatch | undefined;
    if (!progress || !batch || batch.batchKey !== args.batchKey) {
      throw new Error("learning analytics active batch is missing");
    }
    assertActiveBatchWorkerLease(batch, args);
    if (batch.status === "manual_reconciliation_required") {
      return { action: "manual_reconciliation_required" as const, batch };
    }
    const connectorFailure = await learningBatchConnectorBindingFailure(ctx, progress, batch, args);
    if (connectorFailure) {
      return await quarantineLearningBatchForConnectorBinding(
        ctx,
        progress,
        batch,
        args.now,
        connectorFailure,
      );
    }
    if (batch.status !== "collecting") return { action: "skip" as const };
    const index = batch.items.findIndex((item) => item.runId === args.runId);
    if (index < 0) throw new Error("learning analytics item is not in the active batch");
    const item = batch.items[index]!;
    if (item.requestStatus === "pending") {
      const items = [...batch.items];
      items[index] = { ...item, requestStatus: "request_started", requestStartedAt: args.now };
      const nextBatch = heartbeatBatchWorkerLease({ ...batch, items }, args.now);
      await ctx.db.patch(progress._id, {
        activeBatch: nextBatch,
        updatedAt: args.now,
      });
      return {
        // This is deliberately not permission to call the external API yet.
        // The worker must obtain the second, immediately-pre-GET dispatch
        // marker after any token/setup work has completed.
        action: "dispatch" as const,
        item: items[index],
        ingestionId: batch.ingestionId,
      };
    }
    // A prior worker may have crossed the external GET boundary and died before
    // saving its response.  Do not make the same quota request again.
    if (
      item.requestStatus === "request_started" ||
      item.requestStatus === "request_dispatch_started"
    ) return { action: "ambiguous" as const, item };
    return { action: "skip" as const, item };
  },
});

/**
 * The final fenced boundary before an Analytics GET.  A worker that lost its
 * batch lease after the earlier request-start marker gets no `fetch` result,
 * so it cannot make an orphan quota request after recovery took ownership.
 */
export const markLearningItemRequestDispatchStarted = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    batchKey: v.string(),
    runId: v.id("runs"),
    workerLeaseToken: v.string(),
    workerLeaseGeneration: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    assertFiniteNonNegative(args.now, "request dispatch time");
    const progress = await exactLearningProgress(ctx, args.ownerId, args.channelId);
    const batch = progress?.activeBatch as LearningBatch | undefined;
    if (!progress || !batch || batch.batchKey !== args.batchKey) {
      throw new Error("learning analytics active batch is missing");
    }
    assertActiveBatchWorkerLease(batch, args);
    if (batch.status === "manual_reconciliation_required") {
      return { action: "manual_reconciliation_required" as const, batch };
    }
    // This is the exact quota boundary: validate the caller's immutable batch
    // provenance against the current channel/connector state before the worker
    // receives the only result that permits an Analytics GET.
    const connectorFailure = await learningBatchConnectorBindingFailure(ctx, progress, batch, args);
    if (connectorFailure) {
      return await quarantineLearningBatchForConnectorBinding(
        ctx,
        progress,
        batch,
        args.now,
        connectorFailure,
      );
    }
    if (batch.status !== "collecting") return { action: "skip" as const };
    const index = batch.items.findIndex((item) => item.runId === args.runId);
    if (index < 0) throw new Error("learning analytics item is not in the active batch");
    const item = batch.items[index]!;
    if (item.requestStatus === "request_started") {
      const dispatchCapabilityToken = mintLearningItemDispatchCapability();
      const dispatchCapabilityExpiresAt = Math.min(
        batch.workerLeaseExpiresAt ?? args.now,
        args.now + LEARNING_ANALYTICS_HTTP_DISPATCH_WINDOW_MS,
      );
      if (dispatchCapabilityExpiresAt <= args.now) {
        throw new Error("learning analytics dispatch capability expired before it was issued");
      }
      const items = [...batch.items];
      items[index] = {
        ...item,
        requestStatus: "request_dispatch_started",
        requestDispatchStartedAt: args.now,
        requestDispatchCapabilityToken: dispatchCapabilityToken,
        requestDispatchCapabilityExpiresAt: dispatchCapabilityExpiresAt,
      };
      const nextBatch = heartbeatBatchWorkerLease({ ...batch, items }, args.now);
      await ctx.db.patch(progress._id, { activeBatch: nextBatch, updatedAt: args.now });
      return {
        // This marker reserves the request and hands the worker one short
        // capability. The worker must still consume it in a second exact
        // lease/connector check immediately before its HTTP helper runs.
        action: "fetch" as const,
        item: items[index],
        ingestionId: batch.ingestionId,
        dispatchCapabilityToken,
      };
    }
    // Either a prior worker crossed the exact outbound boundary, or a caller
    // lost this marker acknowledgement.  Never grant another quota request.
    if (item.requestStatus === "request_dispatch_started") {
      return { action: "ambiguous" as const, item };
    }
    return { action: "skip" as const, item };
  },
});

/**
 * Consume the short-lived capability from the durable request marker. This is
 * the final server-side lease and connector validation before the worker calls
 * the local HTTP helper. A capability cannot authorize a later re-entry or a
 * second request after the first worker has crossed this boundary.
 */
export const consumeLearningItemRequestDispatchCapability = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    batchKey: v.string(),
    runId: v.id("runs"),
    workerLeaseToken: v.string(),
    workerLeaseGeneration: v.number(),
    dispatchCapabilityToken: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    assertFiniteNonNegative(args.now, "dispatch capability consumption time");
    if (!args.dispatchCapabilityToken.trim()) {
      throw new Error("learning analytics dispatch capability token is required");
    }
    const progress = await exactLearningProgress(ctx, args.ownerId, args.channelId);
    const batch = progress?.activeBatch as LearningBatch | undefined;
    if (!progress || !batch || batch.batchKey !== args.batchKey) {
      throw new Error("learning analytics active batch is missing");
    }
    assertActiveBatchWorkerLease(batch, args);
    if (batch.status === "manual_reconciliation_required") {
      return { action: "manual_reconciliation_required" as const, batch };
    }
    const connectorFailure = await learningBatchConnectorBindingFailure(ctx, progress, batch, args);
    if (connectorFailure) {
      return await quarantineLearningBatchForConnectorBinding(
        ctx,
        progress,
        batch,
        args.now,
        connectorFailure,
      );
    }
    if (batch.status !== "collecting") return { action: "skip" as const };
    const index = batch.items.findIndex((item) => item.runId === args.runId);
    if (index < 0) throw new Error("learning analytics item is not in the active batch");
    const item = batch.items[index]!;
    if (
      item.requestStatus !== "request_dispatch_started" ||
      item.requestDispatchCapabilityToken !== args.dispatchCapabilityToken ||
      item.requestDispatchCapabilityConsumedAt !== undefined ||
      item.requestDispatchCapabilityExpiresAt === undefined ||
      item.requestDispatchCapabilityExpiresAt <= args.now
    ) {
      // Never mint another capability from an old marker. The caller will
      // retain this as an ambiguous outcome rather than replaying the GET.
      return { action: "ambiguous" as const, item };
    }
    const httpDispatchDeadlineAt = Math.min(
      args.now + LEARNING_ANALYTICS_HTTP_DISPATCH_WINDOW_MS,
      args.now + LEARNING_ANALYTICS_BATCH_WORKER_LEASE_MS,
    );
    const items = [...batch.items];
    items[index] = {
      ...item,
      requestDispatchCapabilityConsumedAt: args.now,
      requestDispatchHttpDeadlineAt: httpDispatchDeadlineAt,
    };
    const nextBatch = heartbeatBatchWorkerLease({ ...batch, items }, args.now);
    await ctx.db.patch(progress._id, { activeBatch: nextBatch, updatedAt: args.now });
    return {
      action: "fetch" as const,
      item: items[index],
      ingestionId: batch.ingestionId,
      httpDispatchDeadlineAt,
    };
  },
});

export const recordLearningItemFetched = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    batchKey: v.string(),
    runId: v.id("runs"),
    workerLeaseToken: v.string(),
    workerLeaseGeneration: v.number(),
    views: v.number(),
    engagedViews: v.optional(v.number()),
    avgViewPct: v.number(),
    ctr: v.optional(v.number()),
    title: v.string(),
    topic: v.string(),
    thumbnailStrategy: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    for (const [value, label] of [
      [args.views, "views"],
      [args.avgViewPct, "retention"],
      [args.now, "fetch time"],
    ] as const) assertFiniteNonNegative(value, label);
    if (args.engagedViews !== undefined) {
      assertFiniteNonNegative(args.engagedViews, "engaged views");
    }
    if (args.ctr !== undefined) assertFiniteNonNegative(args.ctr, "ctr");
    const progress = await exactLearningProgress(ctx, args.ownerId, args.channelId);
    const batch = progress?.activeBatch as LearningBatch | undefined;
    if (!progress || !batch || batch.batchKey !== args.batchKey) {
      throw new Error("learning analytics active batch is missing");
    }
    assertActiveBatchWorkerLease(batch, args);
    if (batch.status === "manual_reconciliation_required") {
      return { action: "manual_reconciliation_required" as const, batch };
    }
    const connectorFailure = await learningBatchConnectorBindingFailure(ctx, progress, batch, args);
    if (connectorFailure) {
      return await quarantineLearningBatchForConnectorBinding(
        ctx,
        progress,
        batch,
        args.now,
        connectorFailure,
      );
    }
    const metricDefinitionVersion = resolveLearningAnalyticsMetricDefinitionVersion(
      batch.metricDefinitionVersion,
    );
    if (
      metricDefinitionVersion === LEARNING_ANALYTICS_METRIC_DEFINITION_V2 &&
      args.engagedViews === undefined
    ) {
      throw new Error("learning analytics v2 response is missing engaged views");
    }
    if (
      metricDefinitionVersion !== LEARNING_ANALYTICS_METRIC_DEFINITION_V2 &&
      args.engagedViews !== undefined
    ) {
      throw new Error("learning analytics v1 response cannot attach engaged views");
    }
    const index = batch.items.findIndex((item) => item.runId === args.runId);
    if (index < 0) throw new Error("learning analytics item is not in the active batch");
    const item = batch.items[index]!;
    if (item.requestStatus === "fetched") return { item };
    if (item.requestStatus !== "request_dispatch_started") {
      throw new Error("learning analytics response cannot be attached after a terminal request state");
    }
    if (
      item.requestDispatchCapabilityConsumedAt === undefined ||
      item.requestDispatchHttpDeadlineAt === undefined
    ) {
      throw new Error("learning analytics response lacks its exact consumed dispatch capability");
    }
    const items = [...batch.items];
    items[index] = {
      ...item,
      requestStatus: "fetched",
      fetchedAt: args.now,
      views: args.views,
      ...(args.engagedViews === undefined ? {} : { engagedViews: args.engagedViews }),
      avgViewPct: args.avgViewPct,
      ...(args.ctr === undefined ? {} : { ctr: args.ctr }),
      title: args.title.slice(0, 1_000),
      topic: args.topic.slice(0, 1_000),
      ...(args.thumbnailStrategy ? { thumbnailStrategy: args.thumbnailStrategy.slice(0, 1_000) } : {}),
    };
    await ctx.db.patch(progress._id, {
      activeBatch: heartbeatBatchWorkerLease({ ...batch, items }, args.now),
      updatedAt: args.now,
    });
    return { item: items[index] };
  },
});

export const markLearningItemAmbiguous = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    batchKey: v.string(),
    runId: v.id("runs"),
    workerLeaseToken: v.string(),
    workerLeaseGeneration: v.number(),
    error: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    assertFiniteNonNegative(args.now, "ambiguity time");
    const progress = await exactLearningProgress(ctx, args.ownerId, args.channelId);
    const batch = progress?.activeBatch as LearningBatch | undefined;
    if (!progress || !batch || batch.batchKey !== args.batchKey) {
      throw new Error("learning analytics active batch is missing");
    }
    assertActiveBatchWorkerLease(batch, args);
    if (batch.status === "manual_reconciliation_required") {
      return { action: "manual_reconciliation_required" as const, batch };
    }
    const connectorFailure = await learningBatchConnectorBindingFailure(ctx, progress, batch, args);
    if (connectorFailure) {
      return await quarantineLearningBatchForConnectorBinding(
        ctx,
        progress,
        batch,
        args.now,
        connectorFailure,
      );
    }
    const index = batch.items.findIndex((item) => item.runId === args.runId);
    if (index < 0) throw new Error("learning analytics item is not in the active batch");
    const item = batch.items[index]!;
    if (
      item.requestStatus !== "request_started" &&
      item.requestStatus !== "request_dispatch_started"
    ) return { item };
    const items = [...batch.items];
    items[index] = {
      ...item,
      requestStatus: "ambiguous",
      ambiguousAt: args.now,
      lastError: args.error.slice(0, 500),
    };
    await ctx.db.patch(progress._id, {
      activeBatch: heartbeatBatchWorkerLease({ ...batch, items }, args.now),
      updatedAt: args.now,
    });
    return { item: items[index] };
  },
});

function fetchedLearningItems(batch: LearningBatch): Array<LearningItem & {
  views: number;
  avgViewPct: number;
  title: string;
  topic: string;
}> {
  const metricDefinitionVersion = resolveLearningAnalyticsMetricDefinitionVersion(
    batch.metricDefinitionVersion,
  );
  return batch.items.flatMap((item) => {
    if (item.requestStatus !== "fetched") return [];
    if (
      item.views === undefined ||
      item.avgViewPct === undefined ||
      item.title === undefined ||
      item.topic === undefined
    ) {
      throw new Error("learning analytics fetched item is missing its durable result");
    }
    if (
      metricDefinitionVersion === LEARNING_ANALYTICS_METRIC_DEFINITION_V2 &&
      item.engagedViews === undefined
    ) {
      throw new Error("learning analytics v2 fetched item is missing engaged views");
    }
    return [item as LearningItem & {
      views: number;
      avgViewPct: number;
      title: string;
      topic: string;
    }];
  });
}

async function finishLearningBatch(
  ctx: Pick<MutationCtx, "db">,
  progress: {
    _id: Id<"learningAnalyticsProgress">;
    processedVideoIds: string[];
    freshnessWindowStartedAfter?: number;
  },
  batch: LearningBatch,
  now: number,
): Promise<void> {
  const fetched = fetchedLearningItems(batch);
  const terminalItems = batch.items.filter(
    (item) => item.requestStatus === "fetched" || item.requestStatus === "ambiguous",
  );
  if (terminalItems.length !== batch.items.length) {
    throw new Error("learning analytics batch cannot advance while an item is unresolved");
  }
  const status = batch.items.some((item) => item.requestStatus === "ambiguous")
    ? fetched.length > 0 ? "partial" : "failed"
    : "completed";
  await ctx.db.patch(batch.ingestionId, {
    status,
    recordsWritten: fetched.length,
    lastError: batchErrors(batch),
    finishedAt: now,
  });
  await ctx.db.patch(progress._id, {
    ...advanceLearningProgressPatch(progress, batch, now),
    processedVideoIds: boundedProcessedVideoIds(progress.processedVideoIds, terminalItems),
    activeBatch: undefined,
    updatedAt: now,
  });
}

/**
 * Convert saved Analytics responses into one R2 ledger write.  This marker is
 * persisted before that write; a crash after it is deliberately reconciled by
 * reading the exact ledger entries, never by issuing another write blindly.
 */
export const prepareLearningLedgerWrite = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    batchKey: v.string(),
    workerLeaseToken: v.string(),
    workerLeaseGeneration: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    assertFiniteNonNegative(args.now, "ledger preparation time");
    const progress = await exactLearningProgress(ctx, args.ownerId, args.channelId);
    const batch = progress?.activeBatch as LearningBatch | undefined;
    if (!progress || !batch || batch.batchKey !== args.batchKey) {
      throw new Error("learning analytics active batch is missing");
    }
    assertActiveBatchWorkerLease(batch, args);
    if (batch.status === "manual_reconciliation_required") {
      return { action: "manual_reconciliation_required" as const, batch };
    }
    const connectorFailure = await learningBatchConnectorBindingFailure(ctx, progress, batch, args);
    if (connectorFailure) {
      return await quarantineLearningBatchForConnectorBinding(
        ctx,
        progress,
        batch,
        args.now,
        connectorFailure,
      );
    }
    if (batch.status === "ledger_write_started") {
      const activeBatch = heartbeatBatchWorkerLease(batch, args.now);
      await ctx.db.patch(progress._id, { activeBatch, updatedAt: args.now });
      return {
        action: "reconcile" as const,
        batch: activeBatch,
        ledgerFingerprint: activeBatch.ledgerFingerprint,
      };
    }
    const unresolved = batch.items.find(
      (item) =>
        item.requestStatus === "pending" ||
        item.requestStatus === "request_started" ||
        item.requestStatus === "request_dispatch_started",
    );
    if (unresolved) {
      return { action: "resolve_items" as const, runId: unresolved.runId };
    }
    const fetched = fetchedLearningItems(batch);
    if (fetched.length === 0) {
      await finishLearningBatch(ctx, progress, batch, args.now);
      return { action: "completed_without_ledger_write" as const };
    }
    const metricDefinitionVersion = resolveLearningAnalyticsMetricDefinitionVersion(
      batch.metricDefinitionVersion,
    );
    const ledgerFingerprint = sha256Hex(JSON.stringify(fetched.map((item) => ({
      videoId: item.youtubeVideoId,
      publishedAt: item.publishedAt,
      views: item.views,
      engagedViews: item.engagedViews,
      avgViewPct: item.avgViewPct,
      ctr: item.ctr,
      title: item.title,
      topic: item.topic,
      thumbnailStrategy: item.thumbnailStrategy,
      metricDefinitionVersion,
      ingestionId: String(batch.ingestionId),
    }))));
    const nextBatch: LearningBatch = {
      ...heartbeatBatchWorkerLease(batch, args.now),
      status: "ledger_write_started",
      ledgerWriteStartedAt: args.now,
      ledgerFingerprint,
    };
    await ctx.db.patch(progress._id, { activeBatch: nextBatch, updatedAt: args.now });
    return {
      action: "write" as const,
      batch: nextBatch,
      ingestionId: batch.ingestionId,
      ledgerFingerprint,
      items: fetched,
    };
  },
});

export const completeLearningLedgerWrite = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    batchKey: v.string(),
    ledgerFingerprint: v.string(),
    workerLeaseToken: v.string(),
    workerLeaseGeneration: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    assertFiniteNonNegative(args.now, "ledger completion time");
    const progress = await exactLearningProgress(ctx, args.ownerId, args.channelId);
    const batch = progress?.activeBatch as LearningBatch | undefined;
    if (!progress || !batch || batch.batchKey !== args.batchKey) {
      throw new Error("learning analytics active batch is missing");
    }
    assertActiveBatchWorkerLease(batch, args);
    if (batch.status === "manual_reconciliation_required") {
      return { completed: false as const, action: "manual_reconciliation_required" as const, batch };
    }
    const connectorFailure = await learningBatchConnectorBindingFailure(ctx, progress, batch, args);
    if (connectorFailure) {
      return await quarantineLearningBatchForConnectorBinding(
        ctx,
        progress,
        batch,
        args.now,
        connectorFailure,
      );
    }
    if (
      batch.status !== "ledger_write_started" ||
      !batch.ledgerFingerprint ||
      batch.ledgerFingerprint !== args.ledgerFingerprint
    ) {
      throw new Error("learning analytics ledger completion does not match its durable write marker");
    }
    await finishLearningBatch(ctx, progress, batch, args.now);
    return { completed: true as const };
  },
});

/** A post-marker R2 failure is deliberately terminal until an operator checks it. */
export const markLearningLedgerWriteAmbiguous = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    batchKey: v.string(),
    workerLeaseToken: v.string(),
    workerLeaseGeneration: v.number(),
    error: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    assertFiniteNonNegative(args.now, "ledger ambiguity time");
    const progress = await exactLearningProgress(ctx, args.ownerId, args.channelId);
    const batch = progress?.activeBatch as LearningBatch | undefined;
    if (!progress || !batch || batch.batchKey !== args.batchKey) {
      throw new Error("learning analytics active batch is missing");
    }
    assertActiveBatchWorkerLease(batch, args);
    if (batch.status === "manual_reconciliation_required") return { batch };
    const connectorFailure = await learningBatchConnectorBindingFailure(ctx, progress, batch, args);
    if (connectorFailure) {
      return await quarantineLearningBatchForConnectorBinding(
        ctx,
        progress,
        batch,
        args.now,
        connectorFailure,
      );
    }
    if (batch.status !== "ledger_write_started") {
      throw new Error("learning analytics ledger ambiguity requires a persisted write marker");
    }
    const fetched = fetchedLearningItems(batch);
    await ctx.db.patch(batch.ingestionId, {
      status: fetched.length > 0 ? "partial" : "failed",
      recordsWritten: 0,
      lastError: `ledger write outcome unresolved: ${args.error}`.slice(0, 1_000),
      finishedAt: args.now,
    });
    const manualBatch: LearningBatch = {
      ...heartbeatBatchWorkerLease(batch, args.now),
      status: "manual_reconciliation_required",
    };
    await ctx.db.patch(progress._id, { activeBatch: manualBatch, updatedAt: args.now });
    return { batch: manualBatch };
  },
});
