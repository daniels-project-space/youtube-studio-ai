import { v } from "convex/values";
import { mutation, query } from "./studioFunctions";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { isChannelLocked } from "./channelLock";
import { canonicalJson } from "../src/lib/canonicalJson";
import {
  planWeekProviderReceiptImageUsage,
  type PlanWeekProviderRenderReceipt,
  verifyFinalizedPlanWeekRenderReceipt,
} from "../src/lib/planWeekRenderReceipt";
import {
  PLAN_WEEK_CONTRACT_VERSION,
  planWeekContractReservation,
} from "../src/lib/planWeekContract";
import {
  PLAN_WEEK_RECOVERY_GUARD_VERSION,
  assertExactFailedPlanWeekRecoveryState,
  assertExactPlanWeekRecoveryIdentity,
  assertSameClaimedPlanWeekRecovery,
  type PlanWeekRecoveryExpectation,
  type PlanWeekRecoveryState,
} from "../src/lib/planWeekRecoveryContract";
import {
  assertScheduledPlanPayloadMatches,
  assertScheduledPublishIsFuture,
  MIN_PLAN_RENDER_LEAD_MS,
  normalizeScheduledPlanPayload,
  selectDueScheduledPlanItem,
  selectUnpinnedPlanItem,
  type ScheduledPlanRunPayload,
} from "../src/lib/scheduledPlanRuntime";
import {
  CASEFILE_AUTO_RESEARCH_MAX_PLAN_AGE_MS,
  CASEFILE_AUTO_RESEARCH_MAX_PLAN_FAILURES,
  decideCasefileAutoResearchPlanDisposition,
  type CasefileAutoResearchDeferralOutcome,
} from "../src/lib/casefileAutoResearchSafety";
import { isGenerationDue } from "../src/lib/publishingPolicy";
import { parseNarrativeSeriesRunSelector } from "../src/lib/narrativeSeriesRunAdmission";
import {
  materializeCalendarScheduleDefaults,
  orphanReadyCancellationPatch,
  orphanReadyRowsForMaintenance,
} from "../src/lib/calendarMaintenance";
import { completedPublishContinuationPatch } from "./publishContinuationState";
import {
  RUN_QUEUE_LEASE_MS,
  assertRunExecutionWriteFence,
  requiresRunExecutionWriteFence,
  type RunExecutionLeaseSnapshot,
} from "../src/lib/runLease";
import { paginationOptsValidator } from "convex/server";
import {
  CHANNEL_PLAN_LIMIT,
  OWNER_PLAN_LIMIT,
  PLAN_HISTORY_PAGE_LIMIT,
  validatedReadLimit,
} from "../src/lib/boundedConvexReads";

const PLAN_BATCH_LEASE_MS = 2 * 60 * 60 * 1_000;
const PROVEN_READY_PLAN_LIMIT = {
  defaultLimit: 24,
  maxLimit: 96,
  label: "proven ready plan limit",
} as const;
const PROVEN_READY_BATCH_SCAN_LIMIT = 96;
const PROVEN_READY_BATCH_PAGE_LIMIT = {
  defaultLimit: 8,
  maxLimit: 12,
  label: "proven ready batch page limit",
} as const;

function cleanError(value: string): string {
  return value.trim().slice(0, 1_000) || "unknown planner failure";
}

function assertClaimedPlanExecutionFence(
  run: RunExecutionLeaseSnapshot,
  leaseOwner: string | undefined,
  executionLeaseToken: number | undefined,
): void {
  if ((leaseOwner === undefined) !== (executionLeaseToken === undefined)) {
    throw new Error("scheduled plan terminal write must provide both execution lease fence fields or neither");
  }
  if (leaseOwner !== undefined && executionLeaseToken !== undefined) {
    assertRunExecutionWriteFence(run, { leaseOwner, executionLeaseToken }, Date.now());
  } else if (requiresRunExecutionWriteFence(run)) {
    throw new Error("scheduled plan terminal write requires an execution lease fence");
  }
}

function validUsd(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a finite non-negative USD amount`);
  return Number(value.toFixed(6));
}

function usageEvidence(modelUsage: unknown, imageUsage: unknown) {
  const model = typeof modelUsage === "object" && modelUsage !== null
    ? modelUsage as Record<string, unknown>
    : {};
  const image = typeof imageUsage === "object" && imageUsage !== null
    ? imageUsage as Record<string, unknown>
    : {};
  const modelCost = model.costUsd;
  const imageCost = image.costUsd;
  const imageRecords = Array.isArray(image.records) ? image.records : null;
  const accountingComplete = model.unpricedCalls === 0 && imageRecords !== null &&
    imageRecords.every((record) => {
      const cost = typeof record === "object" && record !== null
        ? (record as Record<string, unknown>).costUsd
        : undefined;
      return typeof cost === "number" && Number.isFinite(cost) && cost >= 0;
    });
  return { modelCost, imageCost, accountingComplete };
}

function imageUsageMatchesProviderReceipt(
  imageUsage: unknown,
  receipt: PlanWeekProviderRenderReceipt,
): boolean {
  if (typeof imageUsage !== "object" || imageUsage === null) return false;
  const summary = imageUsage as { records?: unknown; costUsd?: unknown; images?: unknown };
  if (!Array.isArray(summary.records) || summary.records.length !== 1 ||
      summary.images !== 1 || typeof summary.costUsd !== "number" ||
      Math.abs(summary.costUsd - receipt.costUsd) > 0.000001) return false;
  const expected = planWeekProviderReceiptImageUsage(receipt);
  return summary.records.every((record) => {
    if (typeof record !== "object" || record === null) return false;
    const values = record as {
      images?: unknown;
      costUsd?: unknown;
      provider?: unknown;
      route?: unknown;
      model?: unknown;
      width?: unknown;
      height?: unknown;
    };
    return values.images === expected.images && values.costUsd === expected.costUsd &&
      values.provider === expected.provider && values.route === expected.route &&
      values.model === expected.model && values.width === expected.width &&
      values.height === expected.height;
  });
}

function validUsageFingerprint(value: string): string {
  const fingerprint = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error("invalid plan usage fingerprint");
  return fingerprint;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requirePlannerService(ctx: {
  auth: { getUserIdentity: () => Promise<unknown> };
}): Promise<void> {
  const identity = await ctx.auth.getUserIdentity() as { role?: unknown } | null;
  if (identity?.role !== "service") throw new Error("plan generation requires a studio service identity");
}

function requirePlanRecoverySecret(secret: string): void {
  const expected = process.env.INTERNAL_QUERY_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("contentPlan recovery: invalid internal secret");
  }
}

async function loadPlanWeekRecoveryState(
  ctx: Pick<QueryCtx, "db">,
  args: { batchId: Id<"planBatches">; itemIds: Id<"contentPlan">[] },
): Promise<PlanWeekRecoveryState> {
  const batch = await ctx.db.get(args.batchId);
  const [items, usageRows, renderRows] = await Promise.all([
    Promise.all(args.itemIds.map((itemId) => ctx.db.get(itemId))),
    ctx.db.query("planBatchUsage").withIndex("by_batch", (q) => q.eq("batchId", args.batchId)).take(65),
    ctx.db.query("planWeekRenderReceipts").withIndex("by_batch", (q) => q.eq("batchId", args.batchId)).take(13),
  ]);
  const loadedUsageRows = usageRows.slice(0, 64);
  const itemUsageRows = loadedUsageRows.filter((row) => row.itemId !== undefined);
  const roundUsd = (value: number) => Number(value.toFixed(6));
  return {
    batch: batch
      ? {
          id: String(batch._id),
          ownerId: batch.ownerId,
          channelId: String(batch.channelId),
          requestKey: batch.requestKey,
          contractVersion: batch.contractVersion,
          requestedCount: batch.requestedCount,
          actualCostUsd: batch.actualCostUsd,
          status: batch.status,
          topicState: batch.topicState,
          accountingComplete: batch.accountingComplete,
          budgetExceeded: batch.budgetExceeded,
          retryable: batch.retryable,
          itemIds: (batch.itemIds ?? []).map(String),
          recoveryGuardVersion: batch.recoveryGuardVersion ?? null,
          recoveryTaskRunId: batch.recoveryTaskRunId ?? null,
          recoveryExpectedItemIds: (batch.recoveryExpectedItemIds ?? []).map(String),
          recoveryExpectedActualCostUsd: batch.recoveryExpectedActualCostUsd ?? null,
          recoveryExpectedProviderRoute: batch.recoveryExpectedProviderRoute ?? null,
          recoveryExpectedTaskVersion: batch.recoveryExpectedTaskVersion ?? null,
        }
      : null,
    items: items.map((item) => item
      ? {
          id: String(item._id),
          ownerId: item.ownerId,
          channelId: String(item.channelId),
          batchId: item.batchId ? String(item.batchId) : null,
          status: item.status,
          generationState: item.generationState ?? null,
          generationAttempt: item.generationAttempt ?? 0,
          generationRetryable: item.generationRetryable ?? false,
          generationProviderStartedAt: item.generationProviderStartedAt ?? null,
          thumbnailKey: item.thumbnailKey ?? null,
        }
      : null),
    renderReceiptCount: renderRows.slice(0, 12).length,
    renderReceiptOverflow: renderRows.length > 12,
    usageOverflow: usageRows.length > 64,
    usageTotalUsd: roundUsd(loadedUsageRows.reduce((sum, row) => sum + row.costUsd, 0)),
    usageAccountingComplete: loadedUsageRows.every((row) => row.accountingComplete),
    itemUsageCostUsd: roundUsd(itemUsageRows.reduce((sum, row) => sum + row.costUsd, 0)),
    itemUsageAccountingComplete: itemUsageRows.every((row) => row.accountingComplete),
  };
}

/** Read-only operator/Trigger preflight. The atomic mutation repeats this proof. */
export const getPlanBatchRecoveryState = query({
  args: {
    ownerId: v.string(),
    secret: v.string(),
    batchId: v.id("planBatches"),
    itemIds: v.array(v.id("contentPlan")),
  },
  handler: async (ctx, args) => {
    requirePlanRecoverySecret(args.secret);
    const state = await loadPlanWeekRecoveryState(ctx, args);
    if (state.batch && state.batch.ownerId !== args.ownerId) {
      throw new Error("plan-week recovery guard: batch owner mismatch");
    }
    return state;
  },
});

function scheduledItemPayload(item: {
  _id: unknown;
  topic: string;
  title?: string;
  thumbnailKey?: string;
  scheduledAt?: number;
}): ScheduledPlanRunPayload {
  return normalizeScheduledPlanPayload({
    planItemId: String(item._id),
    topic: item.topic,
    title: item.title ?? "",
    thumbnailKey: item.thumbnailKey ?? "",
    ...(item.scheduledAt !== undefined ? { scheduledAt: item.scheduledAt } : {}),
  });
}

function scheduledRunPayload(run: {
  planItemId?: unknown;
  plannedTopic?: string;
  plannedTitle?: string;
  plannedThumbnailKey?: string;
  plannedPublishAt?: number;
}): ScheduledPlanRunPayload {
  return normalizeScheduledPlanPayload({
    planItemId: String(run.planItemId ?? ""),
    topic: run.plannedTopic ?? "",
    title: run.plannedTitle ?? "",
    thumbnailKey: run.plannedThumbnailKey ?? "",
    ...(run.plannedPublishAt !== undefined ? { scheduledAt: run.plannedPublishAt } : {}),
  });
}

async function proveReadyPlanBatches(
  ctx: Pick<QueryCtx, "db">,
  args: { ownerId: string; channelId: Doc<"channels">["_id"] },
  batches: Doc<"planBatches">[],
) {
  const provenBatches = await Promise.all(batches.map(async (batch) => {
    if (batch.ownerId !== args.ownerId || batch.channelId !== args.channelId ||
        batch.contractVersion !== PLAN_WEEK_CONTRACT_VERSION ||
        batch.status !== "ready" || batch.topicState !== "complete" ||
        !batch.accountingComplete || batch.budgetExceeded) {
      return [];
    }
    const expectedIds = batch.itemIds ?? [];
    if (!expectedIds.length || expectedIds.length > 12 ||
        new Set(expectedIds.map(String)).size !== expectedIds.length) return [];
    const [loadedItems, usageRows, renderRows] = await Promise.all([
      Promise.all(expectedIds.map((itemId) => ctx.db.get(itemId))),
      ctx.db.query("planBatchUsage").withIndex("by_batch", (q) => q.eq("batchId", batch._id)).take(65),
      ctx.db.query("planWeekRenderReceipts").withIndex("by_batch", (q) => q.eq("batchId", batch._id)).take(13),
    ]);
    if (loadedItems.some((item) => !item) || usageRows.length > 64 ||
        renderRows.length !== expectedIds.length) return [];
    const items = loadedItems.filter((item): item is NonNullable<typeof item> => Boolean(item));
    const allUsageBound = usageRows.every((usage) =>
      usage.ownerId === args.ownerId && usage.channelId === args.channelId &&
      usage.batchId === batch._id && usage.accountingComplete &&
      Number.isFinite(usage.costUsd) && usage.costUsd >= 0,
    );
    const usageTotal = Number(usageRows.reduce((sum, usage) => sum + usage.costUsd, 0).toFixed(6));
    const topicUsage = usageRows.find((usage) =>
      !usage.itemId && usage.checkpointKey === batch.topicUsageCheckpointKey,
    );
    if (!allUsageBound || !topicUsage || Math.abs(usageTotal - batch.actualCostUsd) > 0.000001 ||
        batch.actualCostUsd > batch.reservedCostUsd + 0.000001) {
      return [];
    }
    const artifacts = new Map<string, NonNullable<(typeof renderRows)[number]["artifactReceipt"]>>();
    const providers = new Map<string, (typeof renderRows)[number]["providerReceipt"]>();
    for (const item of items) {
      const itemUsage = usageRows.filter((usage) => usage.itemId === item._id);
      const checkpoint = itemUsage.find((usage) => usage.checkpointKey === item.usageCheckpointKey);
      const matchingReceipts = renderRows.filter((row) =>
        row.itemId === item._id && row.checkpointKey === item.usageCheckpointKey,
      );
      const renderReceipt = matchingReceipts[0];
      const expectedThumbnailKey =
        `owner/${args.ownerId.replace(/^\/+|\/+$/g, "")}/channel/${batch.channelSlug.replace(/^\/+|\/+$/g, "")}/plan/${item._id}.jpg`;
      const itemCost = Number(itemUsage.reduce((sum, usage) => sum + usage.costUsd, 0).toFixed(6));
      const receiptVerified = renderReceipt
        ? await verifyFinalizedPlanWeekRenderReceipt(renderReceipt, {
            ownerId: args.ownerId,
            channelId: String(args.channelId),
            batchId: String(batch._id),
            itemId: String(item._id),
            attempt: item.generationAttempt,
            requestKey: batch.requestKey,
            checkpointKey: item.usageCheckpointKey,
            destinationKey: expectedThumbnailKey,
          })
        : false;
      if (item.ownerId !== args.ownerId || item.channelId !== args.channelId ||
          item.batchId !== batch._id ||
          item.status !== "ready" || item.generationState !== "complete" ||
          item.thumbnailKey !== expectedThumbnailKey || !checkpoint ||
          matchingReceipts.length !== 1 || !renderReceipt || !receiptVerified ||
          renderReceipt.ownerId !== args.ownerId || renderReceipt.channelId !== args.channelId ||
          renderReceipt.batchId !== batch._id || renderReceipt.attempt !== item.generationAttempt ||
          renderReceipt.requestKey !== batch.requestKey ||
          renderReceipt.destinationKey !== expectedThumbnailKey ||
          !imageUsageMatchesProviderReceipt(checkpoint.imageUsage, renderReceipt.providerReceipt) ||
          typeof item.generationCostUsd !== "number" ||
          Math.abs(item.generationCostUsd - itemCost) > 0.000001) {
        return [];
      }
      artifacts.set(String(item._id), renderReceipt.artifactReceipt!);
      providers.set(String(item._id), renderReceipt.providerReceipt);
    }
    return items.map((item) => ({
      ...item,
      planWeekArtifactReceipt: artifacts.get(String(item._id))!,
      planWeekProviderReceipt: providers.get(String(item._id))!,
    }));
  }));
  return provenBatches
    .flat()
    .sort((left, right) => right.order - left.order);
}

/** Bounded upcoming-videos queue for a channel, soonest first. */
export const listPlan = query({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = validatedReadLimit(args.limit, CHANNEL_PLAN_LIMIT);
    const rows = (
      await Promise.all(
        ["generating", "ready", "failed"].map((status) =>
          ctx.db
            .query("contentPlan")
            .withIndex("by_channel_status_order", (q) =>
              q.eq("channelId", args.channelId).eq("status", status),
            )
            .order(status === "failed" ? "desc" : "asc")
            .take(status === "failed" ? Math.min(limit, 100) : limit),
        ),
      )
    ).flat();
    return rows
      .filter((r) => r.ownerId === args.ownerId)
      .sort((a, b) => a.order - b.order);
  },
});

/**
 * Service-only readiness projection for paid channel-inception consumers.
 * A visible `status: ready` string is deliberately insufficient: every row
 * must still belong to a finalized batch with immutable, fully priced image
 * evidence and the exact admitted R2 artifact path.
 */
export const listProvenReadyPlan = query({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePlannerService(ctx);
    const limit = validatedReadLimit(args.limit, PROVEN_READY_PLAN_LIMIT);
    // Start from finalized batches, not arbitrary ready rows. Invalid or
    // legacy contentPlan rows therefore cannot crowd valid evidence out of a
    // bounded pre-filter window.
    const batches = await ctx.db
      .query("planBatches")
      .withIndex("by_channel_status", (q) =>
        q.eq("channelId", args.channelId).eq("status", "ready"),
      )
      .order("desc")
      .take(PROVEN_READY_BATCH_SCAN_LIMIT);
    return (await proveReadyPlanBatches(ctx, args, batches)).slice(0, limit);
  },
});

/**
 * Cursor page used by durable readiness scans. Pagination happens before
 * provenance filtering so any number of newer invalid legacy batches cannot
 * permanently hide an older valid batch.
 */
export const listProvenReadyPlanPage = query({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requirePlannerService(ctx);
    validatedReadLimit(args.paginationOpts.numItems, PROVEN_READY_BATCH_PAGE_LIMIT);
    const batchPage = await ctx.db
      .query("planBatches")
      .withIndex("by_channel_status", (q) =>
        q.eq("channelId", args.channelId).eq("status", "ready"),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...batchPage,
      page: await proveReadyPlanBatches(ctx, args, batchPage.page),
    };
  },
});

/**
 * Small, stable projection for the persistent channel header. The detailed
 * week-ahead view owns the larger bounded queue read; every other tab only
 * needs a small set to calculate the next production slot and artwork fallback.
 */
export const listReadyPlanPreview = query({
  args: { ownerId: v.string(), channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.ownerId !== args.ownerId) return [];
    return await ctx.db
      .query("contentPlan")
      .withIndex("by_channel_status_order", (q) =>
        q.eq("channelId", args.channelId).eq("status", "ready"),
      )
      .take(25);
  },
});

/**
 * Bounded active planned items across the owner's channels, joined with channel name +
 * cadence (drives the Schedule calendar — dates are projected client-side from
 * each channel's cadence + the item order). Soonest-first per channel.
 */
export const listPlanByOwner = query({
  args: { ownerId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = validatedReadLimit(args.limit, OWNER_PLAN_LIMIT);
    // Active calendar reads must not subscribe to the owner's unbounded used
    // history. Read only the three non-terminal states through a compound
    // index, then preserve the existing per-channel order projection.
    const rows = (
      await Promise.all(
        ["generating", "ready", "failed"].map((status) =>
          ctx.db
            .query("contentPlan")
            .withIndex("by_owner_status", (q) =>
              q.eq("ownerId", args.ownerId).eq("status", status),
            )
            .order("desc")
            .take(status === "failed" ? Math.min(limit, 100) : limit),
        ),
      )
    ).flat().sort((a, b) => a.order - b.order);

    const chCache = new Map<string, { name: string; slug: string; cadence: string; frequency: string; days?: number[] } | null>();
    const getCh = async (id: string) => {
      if (chCache.has(id)) return chCache.get(id)!;
      const ch = await ctx.db.get(id as typeof rows[number]["channelId"]);
      const cadence = ch?.identity?.cadence ?? "weekly";
      const val = ch
        ? {
            name: ch.name,
            slug: ch.slug,
            cadence,
            frequency: ch.schedule?.frequency ?? cadence,
            days: ch.schedule?.days,
          }
        : null;
      chCache.set(id, val);
      return val;
    };

    const out = [];
    for (const r of rows) {
      const ch = await getCh(r.channelId);
      out.push({
        _id: r._id,
        channelId: r.channelId,
        channelName: ch?.name ?? "(unknown)",
        channelSlug: ch?.slug ?? "",
        cadence: ch?.cadence ?? "weekly",
        frequency: ch?.frequency ?? ch?.cadence ?? "weekly",
        days: ch?.days,
        order: r.order,
        topic: r.topic,
        title: r.title,
        thumbnailKey: r.thumbnailKey,
        status: r.status,
        scheduledAt: r.scheduledAt,
        scheduledRunId: r.scheduledRunId,
        scheduledFailure: r.scheduledFailure,
      });
    }
    return out;
  },
});

/** Bounded cursor history for diagnostics without subscribing UI to all rows. */
export const listPlanHistoryPage = query({
  args: {
    ownerId: v.string(),
    status: v.union(
      v.literal("failed"),
      v.literal("used"),
      v.literal("cancelled"),
    ),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    validatedReadLimit(args.paginationOpts.numItems, PLAN_HISTORY_PAGE_LIMIT);
    return await ctx.db
      .query("contentPlan")
      .withIndex("by_owner_status", (q) =>
        q.eq("ownerId", args.ownerId).eq("status", args.status),
      )
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

/** Pin (or clear) a planned item's calendar date — drag-to-reschedule / date field. */
export const setScheduledAt = mutation({
  args: { id: v.id("contentPlan"), scheduledAt: v.union(v.number(), v.null()) },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.id);
    if (!item) throw new Error("content plan item not found");
    if (item.scheduledRunId && item.status !== "used") {
      throw new Error("cannot reschedule a plan item after its run has been claimed");
    }
    if (args.scheduledAt !== null && (!Number.isFinite(args.scheduledAt) || args.scheduledAt <= 0)) {
      throw new Error("scheduled publish timestamp is invalid");
    }
    await ctx.db.patch(args.id, { scheduledAt: args.scheduledAt ?? undefined });
    return null;
  },
});

/**
 * Atomically admit one plan batch against the channel's per-run ceiling.
 * Replays with the same owner/channel/request key return the original batch;
 * no provider is called before this reservation exists.
 */
export const reservePlanBatch = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    requestKey: v.string(),
    triggerRunId: v.string(),
    contractVersion: v.string(),
    requestedCount: v.number(),
    reservedCostUsd: v.number(),
    recovery: v.optional(v.object({
      guardVersion: v.literal(PLAN_WEEK_RECOVERY_GUARD_VERSION),
      batchId: v.id("planBatches"),
      itemIds: v.array(v.id("contentPlan")),
      expectedActualCostUsd: v.number(),
      providerRoute: v.string(),
      taskVersion: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    await requirePlannerService(ctx);
    const now = Date.now();
    const requestKey = args.requestKey.trim();
    if (!requestKey || requestKey.length > 180) throw new Error("invalid plan request key");
    if (!Number.isInteger(args.requestedCount) || args.requestedCount < 1 || args.requestedCount > 12) {
      throw new Error("plan requestedCount must be an integer from 1 to 12");
    }
    if (args.contractVersion !== PLAN_WEEK_CONTRACT_VERSION) {
      throw new Error(`unsupported plan reservation contract: ${args.contractVersion}`);
    }
    const reservedCostUsd = validUsd(args.reservedCostUsd, "plan reservation");
    const requiredReservationUsd = planWeekContractReservation(args.requestedCount).totalUsd;
    if (reservedCostUsd + 0.000001 < requiredReservationUsd) {
      throw new Error(
        `plan budget admission denied: reservation $${reservedCostUsd.toFixed(4)} is below ` +
        `${PLAN_WEEK_CONTRACT_VERSION} floor $${requiredReservationUsd.toFixed(4)}`,
      );
    }
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.ownerId !== args.ownerId) throw new Error("plan channel ownership mismatch");

    const existing = await ctx.db
      .query("planBatches")
      .withIndex("by_request", (q) =>
        q.eq("ownerId", args.ownerId).eq("channelId", args.channelId).eq("requestKey", requestKey),
      )
      .unique();
    const recoveryExpectation: PlanWeekRecoveryExpectation | undefined = args.recovery
      ? {
          ...args.recovery,
          batchId: String(args.recovery.batchId),
          itemIds: args.recovery.itemIds.map(String),
          contractVersion: args.contractVersion as PlanWeekRecoveryExpectation["contractVersion"],
          providerRoute: args.recovery.providerRoute as PlanWeekRecoveryExpectation["providerRoute"],
        }
      : undefined;
    if (recoveryExpectation) {
      const state = await loadPlanWeekRecoveryState(ctx, {
        batchId: args.recovery!.batchId,
        itemIds: args.recovery!.itemIds,
      });
      assertExactPlanWeekRecoveryIdentity({
        recovery: recoveryExpectation,
        ownerId: args.ownerId,
        channelId: String(args.channelId),
        requestKey,
        requestedCount: args.requestedCount,
        state,
      });
      if (!existing || existing._id !== args.recovery!.batchId) {
        throw new Error("plan-week recovery guard: request key does not resolve to the exact batch");
      }
      if (state.batch?.recoveryGuardVersion !== null) {
        assertSameClaimedPlanWeekRecovery({
          recovery: recoveryExpectation,
          taskRunId: args.triggerRunId,
          state,
        });
      } else {
        assertExactFailedPlanWeekRecoveryState({
          recovery: recoveryExpectation,
          ownerId: args.ownerId,
          channelId: String(args.channelId),
          requestKey,
          requestedCount: args.requestedCount,
          state,
        });
      }
    }
    if (existing) {
      if (existing.requestedCount !== args.requestedCount || existing.contractVersion !== args.contractVersion ||
          Math.abs(existing.reservedCostUsd - reservedCostUsd) > 0.000001) {
        throw new Error("plan idempotency key was reused with different parameters");
      }
      if (["reserved", "running"].includes(existing.status) && existing.leaseExpiresAt <= now) {
        if (existing.reservedCostUsd > channel.budget + 0.000001) {
          throw new Error(
            `plan budget admission denied: reservation $${existing.reservedCostUsd.toFixed(2)} ` +
            `exceeds channel ceiling $${channel.budget.toFixed(2)}`,
          );
        }
        const readmitted = {
          status: "reserved",
          error: undefined,
          retryable: true,
          finishedAt: undefined,
          leaseExpiresAt: now + PLAN_BATCH_LEASE_MS,
          updatedAt: now,
          ...(recoveryExpectation ? {
            triggerRunId: args.triggerRunId,
            recoveryGuardVersion: recoveryExpectation.guardVersion,
            recoveryTaskRunId: args.triggerRunId,
            recoveryExpectedItemIds: args.recovery!.itemIds,
            recoveryExpectedActualCostUsd: recoveryExpectation.expectedActualCostUsd,
            recoveryExpectedProviderRoute: recoveryExpectation.providerRoute,
            recoveryExpectedTaskVersion: recoveryExpectation.taskVersion,
          } : {}),
        };
        await ctx.db.patch(existing._id, readmitted);
        return { ...existing, ...readmitted, batchId: existing._id, reused: true };
      }
      if (existing.status === "failed" && existing.retryable) {
        if (existing.reservedCostUsd > channel.budget + 0.000001) {
          throw new Error(
            `plan budget admission denied: reservation $${existing.reservedCostUsd.toFixed(2)} ` +
            `exceeds channel ceiling $${channel.budget.toFixed(2)}`,
          );
        }
        const channelBatches = await ctx.db
          .query("planBatches")
          .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
          .collect();
        for (const batch of channelBatches) {
          if (batch._id === existing._id || batch.ownerId !== args.ownerId ||
              !["reserved", "running"].includes(batch.status)) continue;
          if (batch.leaseExpiresAt > now) {
            throw new Error(`plan budget admission denied: channel already has active batch ${batch.requestKey}`);
          }
          await ctx.db.patch(batch._id, {
            status: "failed",
            error: "planner lease expired before completion",
            retryable: true,
            finishedAt: now,
            updatedAt: now,
          });
        }
        const readmitted = {
          status: "reserved",
          retryable: true,
          error: undefined,
          finishedAt: undefined,
          leaseExpiresAt: now + PLAN_BATCH_LEASE_MS,
          updatedAt: now,
          ...(recoveryExpectation ? {
            triggerRunId: args.triggerRunId,
            recoveryGuardVersion: recoveryExpectation.guardVersion,
            recoveryTaskRunId: args.triggerRunId,
            recoveryExpectedItemIds: args.recovery!.itemIds,
            recoveryExpectedActualCostUsd: recoveryExpectation.expectedActualCostUsd,
            recoveryExpectedProviderRoute: recoveryExpectation.providerRoute,
            recoveryExpectedTaskVersion: recoveryExpectation.taskVersion,
          } : {}),
        };
        await ctx.db.patch(existing._id, readmitted);
        return { ...existing, ...readmitted, batchId: existing._id, reused: true };
      }
      return { ...existing, batchId: existing._id, reused: true };
    }

    if (recoveryExpectation) {
      throw new Error("plan-week recovery guard: exact failed batch is missing; fresh batch creation is forbidden");
    }

    if (reservedCostUsd > channel.budget + 0.000001) {
      throw new Error(
        `plan budget admission denied: worst-case $${reservedCostUsd.toFixed(2)} exceeds channel ceiling $${channel.budget.toFixed(2)}`,
      );
    }

    const channelBatches = await ctx.db
      .query("planBatches")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .collect();
    for (const batch of channelBatches) {
      if (batch.ownerId !== args.ownerId || !["reserved", "running"].includes(batch.status)) continue;
      if (batch.leaseExpiresAt > now) {
        throw new Error(`plan budget admission denied: channel already has active batch ${batch.requestKey}`);
      }
      await ctx.db.patch(batch._id, {
        status: "failed",
        error: "planner lease expired before completion",
        retryable: true,
        finishedAt: now,
        updatedAt: now,
      });
    }

    const batchId = await ctx.db.insert("planBatches", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      channelSlug: channel.slug,
      requestKey,
      triggerRunId: args.triggerRunId,
      contractVersion: args.contractVersion,
      requestedCount: args.requestedCount,
      reservedCostUsd,
      actualCostUsd: 0,
      status: "reserved",
      topicState: "pending",
      topicAttempt: 0,
      accountingComplete: true,
      budgetExceeded: false,
      retryable: true,
      leaseExpiresAt: now + PLAN_BATCH_LEASE_MS,
      createdAt: now,
      updatedAt: now,
    });
    const batch = await ctx.db.get(batchId);
    return { ...batch!, batchId, reused: false };
  },
});

/** Claim the one paid Topicraft phase. A live/ambiguous claim never repurchases. */
export const claimPlanTopics = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    batchId: v.id("planBatches"),
    claimant: v.string(),
  },
  handler: async (ctx, args) => {
    await requirePlannerService(ctx);
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.ownerId !== args.ownerId || batch.channelId !== args.channelId) {
      throw new Error("plan batch ownership mismatch");
    }
    if (batch.contractVersion !== PLAN_WEEK_CONTRACT_VERSION) {
      throw new Error("plan topics do not belong to the active attested Novita contract");
    }
    if (batch.topicState === "complete") return { state: "complete" as const, itemIds: batch.itemIds ?? [] };
    if (batch.budgetExceeded) {
      return {
        state: "blocked" as const,
        attempt: batch.topicAttempt,
        error: batch.error ?? "plan topic budget was exceeded",
      };
    }
    const now = Date.now();
    const liveClaim = batch.topicState === "claimed" &&
      (batch.topicClaimedAt ?? now) + PLAN_BATCH_LEASE_MS > now;
    if (batch.topicProviderStartedAt !== undefined) {
      if (liveClaim) {
        return {
          state: "busy" as const,
          attempt: batch.topicAttempt,
          error: "plan topic provider claim is already active",
        };
      }
      return {
        state: "recovery_only" as const,
        attempt: batch.topicAttempt,
        error: "plan topic provider spend already started; only exact checkpoint recovery is allowed",
      };
    }
    if (batch.topicState === "failed" && !batch.retryable) {
      return {
        state: "blocked" as const,
        attempt: batch.topicAttempt,
        error: batch.error ?? "plan topic phase is not retryable",
      };
    }
    if (liveClaim) {
      return {
        state: "busy" as const,
        attempt: batch.topicAttempt,
        error: "plan topic provider claim is already active",
      };
    }
    const attempt = batch.topicAttempt + 1;
    await ctx.db.patch(args.batchId, {
      status: "running",
      topicState: "claimed",
      topicAttempt: attempt,
      topicClaimedBy: args.claimant.slice(0, 180),
      topicClaimedAt: now,
      topicProviderStartedAt: undefined,
      topicProviderStartedBy: undefined,
      retryable: false,
      error: undefined,
      leaseExpiresAt: now + PLAN_BATCH_LEASE_MS,
      updatedAt: now,
      finishedAt: undefined,
    });
    return { state: "claimed" as const, attempt };
  },
});

/**
 * Durable at-most-once fence set immediately before the first paid topic call.
 * Once set, lease expiry can only recover this exact attempt's checkpoint.
 */
export const markPlanTopicsProviderStarted = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    batchId: v.id("planBatches"),
    attempt: v.number(),
    claimant: v.string(),
  },
  handler: async (ctx, args) => {
    await requirePlannerService(ctx);
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.ownerId !== args.ownerId || batch.channelId !== args.channelId) {
      throw new Error("plan batch ownership mismatch");
    }
    if (batch.topicAttempt !== args.attempt) throw new Error("stale plan topic provider-start attempt");
    const claimant = args.claimant.slice(0, 180);
    if (batch.topicProviderStartedAt !== undefined) {
      if (batch.topicProviderStartedBy !== claimant) {
        throw new Error("plan topic provider-start claimant mismatch");
      }
      return { state: "started" as const, startedAt: batch.topicProviderStartedAt };
    }
    if (batch.topicState !== "claimed") throw new Error("plan topics are not actively claimed");
    if (batch.topicClaimedBy !== claimant) throw new Error("plan topic claim claimant mismatch");
    const now = Date.now();
    await ctx.db.patch(args.batchId, {
      topicProviderStartedAt: now,
      topicProviderStartedBy: claimant,
      topicClaimedAt: now,
      leaseExpiresAt: now + PLAN_BATCH_LEASE_MS,
      updatedAt: now,
    });
    return { state: "started" as const, startedAt: now };
  },
});

/**
 * Append an immutable usage checkpoint and recompute totals from the ledger.
 * The checkpoint key makes retries no-ops; no global mutable counter/delta is
 * trusted for billing.
 */
export const recordPlanBatchUsage = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    batchId: v.id("planBatches"),
    itemId: v.optional(v.id("contentPlan")),
    checkpointKey: v.string(),
    fingerprint: v.string(),
    modelUsage: v.any(),
    imageUsage: v.any(),
    costUsd: v.number(),
    accountingComplete: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requirePlannerService(ctx);
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.ownerId !== args.ownerId || batch.channelId !== args.channelId) {
      throw new Error("plan batch ownership mismatch");
    }
    if (batch.contractVersion !== PLAN_WEEK_CONTRACT_VERSION) {
      throw new Error("plan usage does not belong to the active contract");
    }
    const checkpointKey = args.checkpointKey.trim();
    if (!checkpointKey || checkpointKey.length > 220) throw new Error("invalid plan usage checkpoint key");
    const { modelCost, imageCost, accountingComplete } = usageEvidence(args.modelUsage, args.imageUsage);
    const costUsd = validUsd(args.costUsd, "plan usage checkpoint");
    if (![modelCost, imageCost].every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)) {
      throw new Error("plan usage summary has invalid costs");
    }
    if (Math.abs(costUsd - Number(((modelCost as number) + (imageCost as number)).toFixed(6))) > 0.000001) {
      throw new Error("plan usage checkpoint cost does not match scoped summaries");
    }
    if (args.accountingComplete !== accountingComplete) {
      throw new Error("plan usage accountingComplete does not match scoped usage evidence");
    }
    const fingerprint = validUsageFingerprint(args.fingerprint);
    const expectedFingerprint = await sha256Hex(canonicalJson({
      contractVersion: PLAN_WEEK_CONTRACT_VERSION,
      costUsd,
      accountingComplete,
      modelUsage: args.modelUsage,
      imageUsage: args.imageUsage,
    }));
    if (fingerprint !== expectedFingerprint) {
      throw new Error("plan usage fingerprint does not match its canonical evidence");
    }
    const prior = await ctx.db
      .query("planBatchUsage")
      .withIndex("by_checkpoint", (q) => q.eq("batchId", args.batchId).eq("checkpointKey", checkpointKey))
      .unique();
    if (prior) {
      if (prior.fingerprint !== fingerprint || prior.itemId !== args.itemId ||
          prior.accountingComplete !== accountingComplete || Math.abs(prior.costUsd - costUsd) > 0.000001) {
        throw new Error("plan usage checkpoint replay mismatch");
      }
      return { usageId: prior._id, actualCostUsd: batch.actualCostUsd, reused: true };
    }
    if (args.itemId) {
      const item = await ctx.db.get(args.itemId);
      if (!item || item.batchId !== args.batchId || item.ownerId !== args.ownerId) {
        throw new Error("plan usage item ownership mismatch");
      }
    }

    const priorRows = await ctx.db
      .query("planBatchUsage")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .collect();
    const usageId = await ctx.db.insert("planBatchUsage", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      batchId: args.batchId,
      itemId: args.itemId,
      checkpointKey,
      fingerprint,
      modelUsage: args.modelUsage,
      imageUsage: args.imageUsage,
      costUsd,
      accountingComplete: args.accountingComplete,
      createdAt: Date.now(),
    });
    const allRows = [...priorRows, { costUsd, accountingComplete }];
    const actualCostUsd = Number(allRows.reduce((sum, row) => sum + row.costUsd, 0).toFixed(6));
    const batchAccountingComplete = allRows.every((row) => row.accountingComplete);
    const budgetExceeded = actualCostUsd > batch.reservedCostUsd + 0.000001;
    const now = Date.now();
    await ctx.db.patch(args.batchId, {
      actualCostUsd,
      accountingComplete: batchAccountingComplete,
      budgetExceeded,
      ...(budgetExceeded
        ? {
            status: "failed",
            retryable: false,
            error: `planner actual cost $${actualCostUsd.toFixed(4)} exceeded reservation $${batch.reservedCostUsd.toFixed(4)}`,
            finishedAt: now,
          }
        : {}),
      updatedAt: now,
    });
    if (args.itemId) {
      const itemRows = priorRows.filter((row) => row.itemId === args.itemId);
      const itemCost = Number((itemRows.reduce((sum, row) => sum + row.costUsd, 0) + costUsd).toFixed(6));
      await ctx.db.patch(args.itemId, { generationCostUsd: itemCost });
    }
    return { usageId, actualCostUsd, reused: false, budgetExceeded, accountingComplete: batchAccountingComplete };
  },
});

/** Persist Topicraft output and insert the whole plan exactly once. */
export const savePlanTopics = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    batchId: v.id("planBatches"),
    attempt: v.number(),
    usageCheckpointKey: v.string(),
    fingerprint: v.string(),
    modelUsage: v.any(),
    imageUsage: v.any(),
    costUsd: v.number(),
    accountingComplete: v.boolean(),
    items: v.array(v.object({
      topic: v.string(),
      title: v.string(),
      description: v.string(),
      sceneSeed: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    await requirePlannerService(ctx);
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.ownerId !== args.ownerId || batch.channelId !== args.channelId) {
      throw new Error("plan batch ownership mismatch");
    }
    if (batch.topicState === "complete") return { state: "saved" as const, itemIds: batch.itemIds ?? [] };
    if (batch.topicAttempt !== args.attempt) throw new Error("stale plan topic completion attempt");
    if (batch.budgetExceeded) return { state: "blocked" as const, error: batch.error ?? "plan budget was exceeded" };
    // A failed state may be restored only from the caller's durable R2 payload;
    // usage fingerprint + immutable checkpoint below fence stale/mismatched data.
    if (batch.topicState !== "claimed" && batch.topicState !== "failed") {
      throw new Error("plan topics were not claimed or durably recoverable");
    }
    if (args.items.length < 1 || args.items.length > batch.requestedCount) {
      throw new Error("plan topic output count is outside the admitted request");
    }
    if (args.items.some((item) => !item.topic.trim() || !item.title.trim() || !item.description.trim())) {
      throw new Error("plan topic output contains an empty required field");
    }
    const normalized = args.items.map((item) => item.topic.trim().toLowerCase().replace(/\s+/g, " "));
    if (new Set(normalized).size !== normalized.length) throw new Error("plan topic output contains duplicates");
    const {
      modelCost,
      imageCost,
      accountingComplete: suppliedAccountingComplete,
    } = usageEvidence(args.modelUsage, args.imageUsage);
    const costUsd = validUsd(args.costUsd, "plan topic usage checkpoint");
    if (![modelCost, imageCost].every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0) ||
        Math.abs(costUsd - Number(((modelCost as number) + (imageCost as number)).toFixed(6))) > 0.000001) {
      throw new Error("plan topic usage cost does not match scoped summaries");
    }
    if (args.accountingComplete !== suppliedAccountingComplete) {
      throw new Error("plan topic accountingComplete does not match scoped usage evidence");
    }
    const fingerprint = validUsageFingerprint(args.fingerprint);
    let usage = await ctx.db
      .query("planBatchUsage")
      .withIndex("by_checkpoint", (q) =>
        q.eq("batchId", args.batchId).eq("checkpointKey", args.usageCheckpointKey),
      )
      .unique();
    if (usage && (usage.itemId || usage.fingerprint !== fingerprint ||
        usage.accountingComplete !== suppliedAccountingComplete || Math.abs(usage.costUsd - costUsd) > 0.000001)) {
      throw new Error("plan topic usage checkpoint replay mismatch");
    }
    const priorRows = await ctx.db
      .query("planBatchUsage")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .collect();
    if (!usage) {
      const usageId = await ctx.db.insert("planBatchUsage", {
        ownerId: args.ownerId,
        channelId: args.channelId,
        batchId: args.batchId,
        checkpointKey: args.usageCheckpointKey,
        fingerprint,
        modelUsage: args.modelUsage,
        imageUsage: args.imageUsage,
        costUsd,
        accountingComplete: suppliedAccountingComplete,
        createdAt: Date.now(),
      });
      usage = (await ctx.db.get(usageId))!;
    }
    const usageRows = priorRows.some((row) => row._id === usage!._id) ? priorRows : [...priorRows, usage!];
    const actualCostUsd = Number(usageRows.reduce((sum, row) => sum + row.costUsd, 0).toFixed(6));
    const accountingComplete = usageRows.every((row) => row.accountingComplete);
    const budgetExceeded = actualCostUsd > batch.reservedCostUsd + 0.000001;
    if (!accountingComplete || budgetExceeded) {
      const error = !accountingComplete
        ? "plan topic model usage contains an unpriced call"
        : `planner actual cost $${actualCostUsd.toFixed(4)} exceeded reservation $${batch.reservedCostUsd.toFixed(4)}`;
      const now = Date.now();
      await ctx.db.patch(args.batchId, {
        actualCostUsd,
        accountingComplete,
        budgetExceeded,
        status: "failed",
        topicState: "failed",
        topicUsageCheckpointKey: args.usageCheckpointKey,
        retryable: false,
        error,
        updatedAt: now,
        finishedAt: now,
      });
      return { state: "blocked" as const, error };
    }

    const existingItems = await ctx.db
      .query("contentPlan")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .collect();
    if (existingItems.length) throw new Error("plan batch has partial unexpected topic rows");
    const channelItems = await ctx.db
      .query("contentPlan")
      .withIndex("by_channel_order", (q) => q.eq("channelId", args.channelId))
      .collect();
    let order = channelItems.length ? Math.max(...channelItems.map((row) => row.order)) + 1 : 0;
    const itemIds = [];
    const now = Date.now();
    for (let index = 0; index < args.items.length; index++) {
      const item = args.items[index];
      itemIds.push(await ctx.db.insert("contentPlan", {
        ownerId: args.ownerId,
        channelId: args.channelId,
        batchId: args.batchId,
        itemKey: `${batch.requestKey}:${index}`,
        order: order++,
        topic: item.topic.trim(),
        title: item.title.trim(),
        description: item.description.trim(),
        sceneSeed: item.sceneSeed?.trim() || undefined,
        status: "generating",
        generationState: "pending",
        generationAttempt: 0,
        generationRetryable: true,
        createdAt: now,
      }));
    }
    await ctx.db.patch(args.batchId, {
      itemIds,
      topicState: "complete",
      topicUsageCheckpointKey: args.usageCheckpointKey,
      actualCostUsd,
      accountingComplete,
      budgetExceeded: false,
      status: "running",
      retryable: true,
      error: undefined,
      updatedAt: now,
    });
    return { state: "saved" as const, itemIds };
  },
});

export const failPlanTopics = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    batchId: v.id("planBatches"),
    attempt: v.number(),
    usageCheckpointKey: v.string(),
    error: v.string(),
    retryable: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requirePlannerService(ctx);
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.ownerId !== args.ownerId || batch.channelId !== args.channelId) {
      throw new Error("plan batch ownership mismatch");
    }
    if (batch.topicState === "complete") {
      return { state: "complete" as const, itemIds: batch.itemIds ?? [] };
    }
    if (batch.topicAttempt !== args.attempt) throw new Error("stale plan topic failure attempt");
    const usage = await ctx.db
      .query("planBatchUsage")
      .withIndex("by_checkpoint", (q) =>
        q.eq("batchId", args.batchId).eq("checkpointKey", args.usageCheckpointKey),
      )
      .unique();
    if (!usage || usage.itemId) throw new Error("plan topic failure usage checkpoint is missing");
    const now = Date.now();
    await ctx.db.patch(args.batchId, {
      status: "failed",
      topicState: "failed",
      topicUsageCheckpointKey: args.usageCheckpointKey,
      error: cleanError(args.error),
      retryable: args.retryable && usage.accountingComplete && usage.costUsd === 0 &&
        batch.topicProviderStartedAt === undefined,
      updatedAt: now,
      finishedAt: now,
    });
    return { state: "failed" as const };
  },
});

export const claimPlanItem = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    batchId: v.id("planBatches"),
    itemId: v.id("contentPlan"),
    claimant: v.string(),
  },
  handler: async (ctx, args) => {
    await requirePlannerService(ctx);
    const [batch, item] = await Promise.all([ctx.db.get(args.batchId), ctx.db.get(args.itemId)]);
    if (!batch || !item || batch.ownerId !== args.ownerId || batch.channelId !== args.channelId ||
        item.batchId !== args.batchId || item.ownerId !== args.ownerId) {
      throw new Error("plan item ownership mismatch");
    }
    if (item.status === "ready" && item.thumbnailKey) {
      return { state: "complete" as const, attempt: item.generationAttempt ?? 0, thumbnailKey: item.thumbnailKey };
    }
    if (batch.budgetExceeded || !batch.accountingComplete ||
        (batch.status === "failed" && !batch.retryable)) {
      return { state: "blocked" as const, attempt: item.generationAttempt ?? 0, error: item.generationError ?? batch.error };
    }
    const now = Date.now();
    const liveClaim = item.generationState === "claimed" &&
      (item.generationClaimedAt ?? now) + PLAN_BATCH_LEASE_MS > now;
    if (item.generationProviderStartedAt !== undefined) {
      if (liveClaim) {
        return {
          state: "busy" as const,
          attempt: item.generationAttempt ?? 0,
          claimedAt: item.generationClaimedAt,
        };
      }
      return {
        state: "recovery_only" as const,
        attempt: item.generationAttempt ?? 0,
        error: "plan thumbnail provider spend already started; only exact checkpoint recovery is allowed",
      };
    }
    if (item.generationState === "failed" && !item.generationRetryable) {
      return {
        state: "blocked" as const,
        attempt: item.generationAttempt ?? 0,
        error: item.generationError ?? "plan thumbnail attempt is not retryable",
      };
    }
    if (liveClaim) {
      return {
        state: "busy" as const,
        attempt: item.generationAttempt ?? 0,
        claimedAt: item.generationClaimedAt,
      };
    }
    const attempt = (item.generationAttempt ?? 0) + 1;
    await ctx.db.patch(args.itemId, {
      status: "generating",
      generationState: "claimed",
      generationAttempt: attempt,
      generationClaimedBy: args.claimant.slice(0, 180),
      generationClaimedAt: now,
      generationProviderStartedAt: undefined,
      generationProviderStartedBy: undefined,
      generationError: undefined,
      generationRetryable: false,
    });
    await ctx.db.patch(args.batchId, {
      status: "running",
      retryable: false,
      error: undefined,
      leaseExpiresAt: now + PLAN_BATCH_LEASE_MS,
      updatedAt: now,
      finishedAt: undefined,
    });
    return { state: "claimed" as const, attempt };
  },
});

/** Set immediately before the claimed thumbnail attempt enters its image provider. */
export const markPlanItemProviderStarted = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    batchId: v.id("planBatches"),
    itemId: v.id("contentPlan"),
    attempt: v.number(),
    claimant: v.string(),
  },
  handler: async (ctx, args) => {
    await requirePlannerService(ctx);
    const [batch, item] = await Promise.all([ctx.db.get(args.batchId), ctx.db.get(args.itemId)]);
    if (!batch || !item || batch.ownerId !== args.ownerId || batch.channelId !== args.channelId ||
        item.batchId !== args.batchId || item.ownerId !== args.ownerId || item.channelId !== args.channelId) {
      throw new Error("plan item ownership mismatch");
    }
    if (item.generationAttempt !== args.attempt) throw new Error("stale plan item provider-start attempt");
    const claimant = args.claimant.slice(0, 180);
    if (item.generationProviderStartedAt !== undefined) {
      if (item.generationProviderStartedBy !== claimant) {
        throw new Error("plan item provider-start claimant mismatch");
      }
      return { state: "started" as const, startedAt: item.generationProviderStartedAt };
    }
    if (batch.budgetExceeded || !batch.accountingComplete ||
        (batch.status === "failed" && !batch.retryable)) {
      throw new Error("plan batch is terminal before thumbnail provider start");
    }
    if (item.generationState !== "claimed") throw new Error("plan item is not actively claimed");
    if (item.generationClaimedBy !== claimant) throw new Error("plan item claim claimant mismatch");
    const now = Date.now();
    await ctx.db.patch(args.itemId, {
      generationProviderStartedAt: now,
      generationProviderStartedBy: claimant,
      generationClaimedAt: now,
    });
    await ctx.db.patch(args.batchId, {
      leaseExpiresAt: now + PLAN_BATCH_LEASE_MS,
      updatedAt: now,
    });
    return { state: "started" as const, startedAt: now };
  },
});

export const completePlanItem = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    batchId: v.id("planBatches"),
    itemId: v.id("contentPlan"),
    attempt: v.number(),
    thumbnailKey: v.string(),
    usageCheckpointKey: v.string(),
  },
  handler: async (ctx, args) => {
    await requirePlannerService(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item || item.ownerId !== args.ownerId || item.channelId !== args.channelId || item.batchId !== args.batchId) {
      throw new Error("plan item ownership mismatch");
    }
    const alreadyReady = item.status === "ready" && Boolean(item.thumbnailKey);
    if (alreadyReady &&
        (item.generationAttempt !== args.attempt || item.usageCheckpointKey !== args.usageCheckpointKey)) {
      throw new Error("ready plan item replay does not match its fenced receipt");
    }
    const restoringFailedArtifact = item.generationState === "failed" &&
      item.generationAttempt === args.attempt && item.usageCheckpointKey === args.usageCheckpointKey;
    if (!alreadyReady && !restoringFailedArtifact &&
        (item.generationState !== "claimed" || item.generationAttempt !== args.attempt)) {
      throw new Error("stale plan item completion attempt");
    }
    const thumbnailKey = args.thumbnailKey.trim();
    if (!thumbnailKey) throw new Error("plan item cannot be ready without a thumbnail");
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.ownerId !== args.ownerId || batch.channelId !== args.channelId) {
      throw new Error("plan batch ownership mismatch");
    }
    if (batch.contractVersion !== PLAN_WEEK_CONTRACT_VERSION) {
      throw new Error("plan item does not belong to the active generation contract");
    }
    const cleanKeyPart = (value: string) => value.replace(/^\/+|\/+$/g, "");
    const expectedThumbnailKey =
      `owner/${cleanKeyPart(args.ownerId)}/channel/${cleanKeyPart(batch.channelSlug)}/plan/${args.itemId}.jpg`;
    if (thumbnailKey !== expectedThumbnailKey) {
      throw new Error("plan item thumbnail key does not match its admitted artifact path");
    }
    const [usage, renderReceipt] = await Promise.all([
      ctx.db.query("planBatchUsage")
        .withIndex("by_checkpoint", (q) =>
          q.eq("batchId", args.batchId).eq("checkpointKey", args.usageCheckpointKey),
        )
        .unique(),
      ctx.db.query("planWeekRenderReceipts")
        .withIndex("by_checkpoint", (q) => q
          .eq("ownerId", args.ownerId)
          .eq("channelId", args.channelId)
          .eq("checkpointKey", args.usageCheckpointKey),
        )
        .unique(),
    ]);
    if (!usage || usage.itemId !== args.itemId || !usage.accountingComplete) {
      throw new Error("plan item usage checkpoint is missing or unpriced");
    }
    if (!renderReceipt) throw new Error("plan item finalized provider receipt is missing");
    if (!(await verifyFinalizedPlanWeekRenderReceipt(renderReceipt, {
      ownerId: args.ownerId,
      channelId: String(args.channelId),
      batchId: String(args.batchId),
      itemId: String(args.itemId),
      attempt: args.attempt,
      requestKey: batch.requestKey,
      checkpointKey: args.usageCheckpointKey,
      destinationKey: thumbnailKey,
    }))) {
      throw new Error("plan item provider receipt is not artifact-finalized");
    }
    if (renderReceipt.batchId !== args.batchId || renderReceipt.itemId !== args.itemId ||
        renderReceipt.attempt !== args.attempt || renderReceipt.requestKey !== batch.requestKey ||
        renderReceipt.destinationKey !== thumbnailKey) {
      throw new Error("plan item finalized provider receipt is not bound to the item attempt");
    }
    if (!imageUsageMatchesProviderReceipt(usage.imageUsage, renderReceipt.providerReceipt)) {
      throw new Error("plan item usage does not match its finalized provider receipt");
    }
    if (alreadyReady) return item.thumbnailKey!;
    await ctx.db.patch(args.itemId, {
      thumbnailKey,
      status: "ready",
      generationState: "complete",
      generationError: undefined,
      generationRetryable: false,
      usageCheckpointKey: args.usageCheckpointKey,
    });
    return thumbnailKey;
  },
});

export const failPlanItem = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    batchId: v.id("planBatches"),
    itemId: v.id("contentPlan"),
    attempt: v.number(),
    usageCheckpointKey: v.string(),
    error: v.string(),
    retryable: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requirePlannerService(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item || item.ownerId !== args.ownerId || item.channelId !== args.channelId || item.batchId !== args.batchId) {
      throw new Error("plan item ownership mismatch");
    }
    if (item.status === "ready") return null;
    if (item.generationAttempt !== args.attempt) throw new Error("stale plan item failure attempt");
    const usage = await ctx.db
      .query("planBatchUsage")
      .withIndex("by_checkpoint", (q) =>
        q.eq("batchId", args.batchId).eq("checkpointKey", args.usageCheckpointKey),
      )
      .unique();
    if (!usage || usage.itemId !== args.itemId) {
      if (args.retryable) throw new Error("plan item failure usage checkpoint is missing");
      const error = cleanError(args.error);
      const now = Date.now();
      await ctx.db.patch(args.itemId, {
        status: "failed",
        generationState: "failed",
        generationError: error,
        generationRetryable: false,
        usageCheckpointKey: undefined,
      });
      await ctx.db.patch(args.batchId, {
        status: "failed",
        accountingComplete: false,
        retryable: false,
        error,
        updatedAt: now,
        finishedAt: now,
        leaseExpiresAt: now,
      });
      return null;
    }
    await ctx.db.patch(args.itemId, {
      status: "failed",
      generationState: "failed",
      generationError: cleanError(args.error),
      generationRetryable: args.retryable && usage.accountingComplete && usage.costUsd === 0 &&
        item.generationProviderStartedAt === undefined,
      usageCheckpointKey: args.usageCheckpointKey,
    });
    return null;
  },
});

/** Ready is derived from persisted artifacts and accounting, never asserted by the worker. */
export const finalizePlanBatch = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    batchId: v.id("planBatches"),
  },
  handler: async (ctx, args) => {
    await requirePlannerService(ctx);
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.ownerId !== args.ownerId || batch.channelId !== args.channelId) {
      throw new Error("plan batch ownership mismatch");
    }
    const items = await ctx.db
      .query("contentPlan")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .collect();
    const now = Date.now();
    const expectedItemIds = batch.itemIds ?? [];
    const actualItemIds = new Set(items.map((item) => item._id));
    const itemSetComplete = expectedItemIds.length > 0 && items.length === expectedItemIds.length &&
      expectedItemIds.every((itemId) => actualItemIds.has(itemId));
    const allReady = itemSetComplete && batch.topicState === "complete" && Boolean(batch.topicUsageCheckpointKey) &&
      items.every((item) => item.status === "ready" && Boolean(item.thumbnailKey) && Boolean(item.usageCheckpointKey));
    if (allReady && batch.accountingComplete && !batch.budgetExceeded) {
      await ctx.db.patch(args.batchId, {
        status: "ready",
        retryable: false,
        error: undefined,
        updatedAt: now,
        finishedAt: now,
        leaseExpiresAt: now,
      });
      return { status: "ready" as const, planned: items.length, actualCostUsd: batch.actualCostUsd };
    }
    const failed = items.filter((item) => item.status === "failed");
    if (batch.status === "failed" || failed.length || batch.topicState === "failed" ||
        batch.budgetExceeded || !batch.accountingComplete) {
      const retryable = !batch.budgetExceeded && batch.accountingComplete &&
        (batch.topicState === "failed" || (batch.status === "failed" && failed.length === 0)
          ? batch.retryable
          : failed.some((item) => item.generationRetryable));
      const error = batch.error ??
        (failed.map((item) => item.generationError).filter(Boolean).join("; ") ||
          "plan batch failed its artifact/accounting contract");
      await ctx.db.patch(args.batchId, {
        status: "failed",
        retryable,
        error: cleanError(error),
        updatedAt: now,
        finishedAt: now,
        leaseExpiresAt: now,
      });
      return { status: "failed" as const, retryable, error: cleanError(error), actualCostUsd: batch.actualCostUsd };
    }
    return { status: "running" as const, planned: items.length, actualCostUsd: batch.actualCostUsd };
  },
});

export const deleteItem = mutation({
  args: { id: v.id("contentPlan") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.id);
    if (!item) return;
    if (item.batchId) {
      const batch = await ctx.db.get(item.batchId);
      if (batch) {
        const now = Date.now();
        await ctx.db.patch(batch._id, {
          status: "failed",
          retryable: false,
          error: "a batch-managed plan item was manually deleted",
          updatedAt: now,
          finishedAt: now,
          leaseExpiresAt: now,
        });
      }
    }
    await ctx.db.delete(args.id);
  },
});

/** Drag-reorder: rewrite `order` to match the given id sequence. */
export const reorder = mutation({
  args: { ids: v.array(v.id("contentPlan")) },
  handler: async (ctx, args) => {
    for (let i = 0; i < args.ids.length; i++) {
      await ctx.db.patch(args.ids[i], { order: i });
    }
  },
});

/**
 * Atomic scheduler admission for one channel.
 *
 * Priority is deliberate: a pinned item enters generation inside the lead
 * window even when ordinary cadence is not due; otherwise a cadence-due run
 * consumes the first ready unpinned plan item. Only an empty ready queue falls
 * back to a free-topic cadence run. The run insert and item fence share one
 * Convex transaction, so concurrent scheduler ticks return the same queued run
 * instead of purchasing two renders.
 */
export const claimNextPlanRun = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    dueBefore: v.number(),
    /**
     * A serialized channel owns its next topic through the durable episode
     * reservation, never through a generic content-plan item.  The selector
     * is persisted on the run so recovery cannot lose that authority.
     */
    narrativeSeriesSelector: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await requirePlannerService(ctx);
    const now = Date.now();
    if (!Number.isFinite(args.dueBefore) || args.dueBefore < now || args.dueBefore > now + 7 * 24 * 60 * 60 * 1_000) {
      throw new Error("scheduled plan due window is invalid");
    }
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("scheduled plan channel ownership mismatch");
    }
    if (channel.status !== "active") {
      return { state: "disabled" as const };
    }
    const narrativeSeriesSelector = args.narrativeSeriesSelector === undefined
      ? undefined
      : parseNarrativeSeriesRunSelector(args.narrativeSeriesSelector);
    if (narrativeSeriesSelector) {
      const identity = channel.identity && typeof channel.identity === "object"
        ? channel.identity as Record<string, unknown>
        : undefined;
      const pointer = identity?.narrativeSeriesPlan;
      if (
        !pointer || typeof pointer !== "object" || Array.isArray(pointer)
        || (pointer as { fingerprint?: unknown }).fingerprint !== narrativeSeriesSelector.seriesPlanFingerprint
      ) {
        throw new Error("narrative series selector does not match this channel's durable horizon pointer");
      }
    }

    const [running, queued, awaitingFactualReview, blockedFactualReview, lastRun] = await Promise.all([
      ctx.db
        .query("runs")
        .withIndex("by_channel_status_thumbnail_refresh_source", (q) => q
          .eq("channelId", args.channelId)
          .eq("status", "running")
          .eq("thumbnailRefreshSourceRunId", undefined))
        .first(),
      ctx.db
        .query("runs")
        .withIndex("by_channel_status_thumbnail_refresh_source", (q) => q
          .eq("channelId", args.channelId)
          .eq("status", "queued")
          .eq("thumbnailRefreshSourceRunId", undefined))
        .first(),
      ctx.db
        .query("runs")
        .withIndex("by_channel_status_thumbnail_refresh_source", (q) => q
          .eq("channelId", args.channelId)
          .eq("status", "awaiting_factual_review")
          .eq("thumbnailRefreshSourceRunId", undefined))
        .first(),
      ctx.db
        .query("runs")
        .withIndex("by_channel_status_thumbnail_refresh_source", (q) => q
          .eq("channelId", args.channelId)
          .eq("status", "factual_review_blocked")
          .eq("thumbnailRefreshSourceRunId", undefined))
        .first(),
      ctx.db
        .query("runs")
        .withIndex("by_channel_thumbnail_refresh_source", (q) => q
          .eq("channelId", args.channelId)
          .eq("thumbnailRefreshSourceRunId", undefined))
        .order("desc")
        .first(),
    ]);
    if (running) return { state: "busy" as const, runId: running._id };
    if (awaitingFactualReview) {
      if (awaitingFactualReview.ownerId !== args.ownerId) {
        throw new Error("awaiting factual review run ownership mismatch");
      }
      // This is a durable operator pause, not a queued scheduler job. Keeping
      // it in the claim transaction prevents cadence fallback from creating an
      // unrelated unsupervised run while factual evidence awaits approval.
      return { state: "busy" as const, runId: awaitingFactualReview._id };
    }
    if (blockedFactualReview) {
      if (blockedFactualReview.ownerId !== args.ownerId) {
        throw new Error("blocked factual review run ownership mismatch");
      }
      return {
        state: "blocked" as const,
        runId: blockedFactualReview._id,
        reason: blockedFactualReview.error ?? "factual review is blocked; create a fresh reviewed revision before scheduling",
      };
    }
    if (queued) {
      if (queued.ownerId !== args.ownerId) throw new Error("queued run ownership mismatch");
      if (queued.narrativeSeriesSelector !== undefined) {
        const queuedSelector = parseNarrativeSeriesRunSelector(queued.narrativeSeriesSelector);
        if (!narrativeSeriesSelector || queuedSelector.fingerprint !== narrativeSeriesSelector.fingerprint) {
          return {
            state: "blocked" as const,
            runId: queued._id,
            reason: "queued narrative series run requires its exact durable selector",
          };
        }
        return {
          state: "cadence" as const,
          reused: true,
          runId: queued._id,
          narrativeSeriesSelector: queuedSelector,
        };
      }
      if (narrativeSeriesSelector) {
        return {
          state: "blocked" as const,
          runId: queued._id,
          reason: "a generic queued run exists; do not attach a narrative selector after run creation",
        };
      }
      if (queued.planItemId) {
        const item = await ctx.db.get(queued.planItemId);
        if (!item || item.ownerId !== args.ownerId || item.channelId !== args.channelId || item.scheduledRunId !== queued._id) {
          throw new Error("queued scheduled run fence mismatch");
        }
        return {
          state: "claimed" as const,
          reused: true,
          runId: queued._id,
          ...scheduledRunPayload(queued),
        };
      }
      return { state: "cadence" as const, reused: true, runId: queued._id };
    }

    // The lease reaper only sets this marker when the run has a complete,
    // immutable invocation snapshot. Re-dispatching the same id lets the
    // runner reuse durable completed stages without purchasing them twice.
    if (lastRun?.status === "failed" && lastRun.leaseRecoveryPending === true) {
      if (lastRun.ownerId !== args.ownerId) {
        throw new Error("recoverable run ownership mismatch");
      }
      if (lastRun.planItemId) {
        const item = await ctx.db.get(lastRun.planItemId);
        if (
          !item ||
          item.ownerId !== args.ownerId ||
          item.channelId !== args.channelId ||
          item.status !== "ready" ||
          item.scheduledRunId !== lastRun._id
        ) {
          throw new Error("recoverable scheduled run fence mismatch");
        }
        const payload = scheduledItemPayload(item);
        assertScheduledPlanPayloadMatches(payload, scheduledRunPayload(lastRun));
        return {
          state: "claimed" as const,
          reused: true,
          recoveryDispatch: true,
          runId: lastRun._id,
          ...payload,
        };
      }
      if (lastRun.narrativeSeriesSelector !== undefined) {
        const recoveredSelector = parseNarrativeSeriesRunSelector(lastRun.narrativeSeriesSelector);
        if (!narrativeSeriesSelector || recoveredSelector.fingerprint !== narrativeSeriesSelector.fingerprint) {
          return {
            state: "blocked" as const,
            runId: lastRun._id,
            reason: "narrative series lease recovery requires its exact durable selector",
          };
        }
        return {
          state: "cadence" as const,
          reused: true,
          recoveryDispatch: true,
          runId: lastRun._id,
          narrativeSeriesSelector: recoveredSelector,
        };
      }
      if (narrativeSeriesSelector) {
        return {
          state: "blocked" as const,
          runId: lastRun._id,
          reason: "a recoverable generic run cannot be converted into a narrative series run",
        };
      }
      return {
        state: "cadence" as const,
        reused: true,
        recoveryDispatch: true,
        runId: lastRun._id,
      };
    }

    const cadenceDue = isGenerationDue({
      now,
      lastStartedAt: lastRun?.startedAt ?? 0,
      schedule: channel.schedule,
      cadence: channel.identity?.cadence,
    });
    if (narrativeSeriesSelector) {
      // A series horizon and a generic ready-plan queue are competing topic
      // authorities. Do not silently ignore either: explicit repair is needed
      // before the route-owned serial planner can advance.
      const readyRows = await ctx.db
        .query("contentPlan")
        .withIndex("by_channel_status_order", (q) =>
          q.eq("channelId", args.channelId).eq("status", "ready"),
        )
        .take(1);
      if (readyRows.some((item) => item.ownerId === args.ownerId)) {
        return {
          state: "blocked" as const,
          reason: "serialized narrative channel has a generic ready content plan; reconcile its topic authority before dispatch",
        };
      }
      if (!cadenceDue) {
        return { state: "not_due" as const, lastStartedAt: lastRun?.startedAt ?? 0 };
      }
      const runId = await ctx.db.insert("runs", {
        ownerId: args.ownerId,
        channelId: args.channelId,
        status: "queued",
        startedAt: now,
        costTotal: 0,
        heartbeatAt: now,
        leaseExpiresAt: now + RUN_QUEUE_LEASE_MS,
        narrativeSeriesSelector,
      });
      return {
        state: "cadence" as const,
        reused: false,
        runId,
        narrativeSeriesSelector,
      };
    }

    const pinnedRows = await ctx.db
      .query("contentPlan")
      .withIndex("by_channel_status_schedule", (q) =>
        q
          .eq("channelId", args.channelId)
          .eq("status", "ready")
          // Convex sorts a missing optional value before every number. Without
          // this lower bound, unpinned rows can fill the bounded read and hide
          // a genuinely due pinned item.
          .gt("scheduledAt", undefined)
          .lte("scheduledAt", args.dueBefore),
      )
      .take(32);
    const duePinnedRows = pinnedRows
      .filter((item) =>
        item.ownerId === args.ownerId &&
        Number.isFinite(item.scheduledAt) &&
        (item.scheduledAt ?? 0) > 0,
      )
      .sort((left, right) =>
        (left.scheduledAt ?? Number.POSITIVE_INFINITY) -
          (right.scheduledAt ?? Number.POSITIVE_INFINITY) ||
        left.order - right.order,
      );
    const earliestDuePinned = duePinnedRows[0];
    if (earliestDuePinned) {
      let reason: string | undefined;
      if (!earliestDuePinned.topic.trim()) {
        reason = "ready plan item has no topic; repair or remove it before generation";
      } else if (!earliestDuePinned.title?.trim()) {
        reason = "ready plan item has no title; repair or remove it before generation";
      } else if (!earliestDuePinned.thumbnailKey?.trim()) {
        reason = "ready plan item has no admitted thumbnail; repair its planner artifact before generation";
      } else {
        try {
          assertScheduledPublishIsFuture(
            earliestDuePinned.scheduledAt!,
            now,
            MIN_PLAN_RENDER_LEAD_MS,
          );
        } catch {
          reason = "pinned publish time is too near or past; reschedule it at least 2 hours ahead";
        }
      }
      if (reason) {
        await ctx.db.patch(earliestDuePinned._id, { scheduledFailure: reason });
        return {
          state: "blocked" as const,
          planItemId: earliestDuePinned._id,
          reason,
        };
      }
    }
    const pinned = selectDueScheduledPlanItem(
      earliestDuePinned
        ? [
            {
              ...scheduledItemPayload(earliestDuePinned),
              status: earliestDuePinned.status,
              order: earliestDuePinned.order,
              scheduledRunId: earliestDuePinned.scheduledRunId
                ? String(earliestDuePinned.scheduledRunId)
                : undefined,
            },
          ]
        : [],
      args.dueBefore,
    );

    let chosen = pinned;
    let readyRows: typeof pinnedRows | undefined;
    if (!chosen && cadenceDue) {
      readyRows = await ctx.db
        .query("contentPlan")
        .withIndex("by_channel_status_order", (q) =>
          q.eq("channelId", args.channelId).eq("status", "ready"),
        )
        .take(32);
      const ownedReadyRows = readyRows.filter((item) => item.ownerId === args.ownerId);
      const incomplete = ownedReadyRows.find((item) =>
        !item.topic.trim() ||
        !item.title?.trim() ||
        !item.thumbnailKey?.trim() ||
        (item.scheduledAt !== undefined &&
          (!Number.isFinite(item.scheduledAt) || item.scheduledAt <= 0)),
      );
      if (incomplete) {
        const reason = !incomplete.topic.trim()
          ? "ready plan item has no topic; repair or remove it before generation"
          : !incomplete.title?.trim()
            ? "ready plan item has no title; repair or remove it before generation"
            : !incomplete.thumbnailKey?.trim()
              ? "ready plan item has no admitted thumbnail; repair its planner artifact before generation"
              : "ready plan item has an invalid pinned publish time; reschedule it before generation";
        await ctx.db.patch(incomplete._id, { scheduledFailure: reason });
        return { state: "blocked" as const, planItemId: incomplete._id, reason };
      }
      chosen = selectUnpinnedPlanItem(
        ownedReadyRows
          .filter((item) => item.scheduledAt === undefined)
          .map((item) => ({
            ...scheduledItemPayload(item),
            status: item.status,
            order: item.order,
            scheduledRunId: item.scheduledRunId ? String(item.scheduledRunId) : undefined,
          })),
      );
    }

    if (!chosen) {
      if (!cadenceDue) {
        return { state: "not_due" as const, lastStartedAt: lastRun?.startedAt ?? 0 };
      }
      const ownedReadyRows = (readyRows ?? []).filter((item) => item.ownerId === args.ownerId);
      if (ownedReadyRows.length > 0) {
        const nextScheduledAt = ownedReadyRows
          .map((item) => item.scheduledAt)
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
          .sort((left, right) => left - right)[0];
        return {
          state: "not_due" as const,
          lastStartedAt: lastRun?.startedAt ?? 0,
          ...(nextScheduledAt !== undefined ? { nextScheduledAt } : {}),
        };
      }
      const runId = await ctx.db.insert("runs", {
        ownerId: args.ownerId,
        channelId: args.channelId,
        status: "queued",
        startedAt: now,
        costTotal: 0,
        heartbeatAt: now,
        leaseExpiresAt: now + RUN_QUEUE_LEASE_MS,
      });
      return { state: "cadence" as const, reused: false, runId };
    }

    const itemId = ctx.db.normalizeId("contentPlan", chosen.planItemId);
    if (!itemId) throw new Error("scheduled plan item id is invalid");
    const item = await ctx.db.get(itemId);
    if (!item || item.ownerId !== args.ownerId || item.channelId !== args.channelId || item.status !== "ready") {
      throw new Error("scheduled plan item ownership/state changed during admission");
    }
    const payload = scheduledItemPayload(item);
    if (item.scheduledRunId) {
      const priorRun = await ctx.db.get(item.scheduledRunId);
      if (!priorRun || priorRun.ownerId !== args.ownerId || priorRun.channelId !== args.channelId || priorRun.planItemId !== item._id) {
        return { state: "blocked" as const, reason: "scheduled plan run fence is orphaned" };
      }
      assertScheduledPlanPayloadMatches(payload, scheduledRunPayload(priorRun));
      if (priorRun.status === "ok") {
        const priorTopic = await ctx.db
          .query("topicMemory")
          .withIndex("by_channel_key", (q) => q.eq("channelId", args.channelId).eq("key", payload.topic))
          .first();
        if (!priorTopic) {
          await ctx.db.insert("topicMemory", {
            ownerId: args.ownerId,
            channelId: args.channelId,
            key: payload.topic,
            usedAt: priorRun.finishedAt ?? now,
          });
        }
        await ctx.db.patch(item._id, {
          status: "used",
          scheduledUsedAt: priorRun.finishedAt ?? now,
          scheduledFailure: undefined,
        });
        return { state: "finalized" as const, runId: priorRun._id, planItemId: item._id };
      }
      if (priorRun.status === "queued") {
        return { state: "claimed" as const, reused: true, runId: priorRun._id, ...payload };
      }
      if (priorRun.status === "running") return { state: "busy" as const, runId: priorRun._id };
      return {
        state: "blocked" as const,
        runId: priorRun._id,
        planItemId: item._id,
        reason: item.scheduledFailure ?? priorRun.error ?? `scheduled plan run is ${priorRun.status}`,
      };
    }

    const runId = await ctx.db.insert("runs", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      status: "queued",
      startedAt: now,
      costTotal: 0,
      heartbeatAt: now,
      leaseExpiresAt: now + RUN_QUEUE_LEASE_MS,
      planItemId: item._id,
      plannedTopic: payload.topic,
      plannedTitle: payload.title,
      plannedThumbnailKey: payload.thumbnailKey,
      ...(payload.scheduledAt !== undefined ? { plannedPublishAt: payload.scheduledAt } : {}),
    });
    await ctx.db.patch(item._id, {
      scheduledRunId: runId,
      scheduledClaimedAt: now,
      scheduledFailure: undefined,
    });
    return { state: "claimed" as const, reused: false, runId, ...payload };
  },
});

/**
 * Settles a non-successful pre-pipeline Casefile research dispatch for one
 * already-claimed scheduled plan. This is intentionally separate from normal
 * pipeline failure handling: no pipeline lease exists yet, and the only safe
 * choices are a bounded future retry or a visible manual stop. Keeping the
 * counter on the plan row makes the stop survive scheduler/task restarts.
 */
export const recordCasefileResearchDeferral = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    itemId: v.id("contentPlan"),
    runId: v.id("runs"),
    outcome: v.union(
      v.literal("research_failed"),
      v.literal("daily_ceiling_reached"),
      v.literal("ineligible"),
    ),
    reason: v.string(),
  },
  returns: v.union(
    v.object({ state: v.literal("requeue"), failureCount: v.number() }),
    v.object({ state: v.literal("blocked"), failureCount: v.number(), reason: v.string() }),
    v.object({ state: v.literal("not_applicable") }),
  ),
  handler: async (ctx, args) => {
    await requirePlannerService(ctx);
    const [item, run] = await Promise.all([ctx.db.get(args.itemId), ctx.db.get(args.runId)]);
    if (!item || !run || item.ownerId !== args.ownerId || run.ownerId !== args.ownerId ||
        item.channelId !== args.channelId || run.channelId !== args.channelId ||
        item.scheduledRunId !== args.runId || run.planItemId !== args.itemId) {
      throw new Error("Casefile research deferral ownership/fence mismatch");
    }
    if (item.status === "used" || run.status !== "queued") {
      return { state: "not_applicable" as const };
    }

    const now = Date.now();
    const disposition = decideCasefileAutoResearchPlanDisposition({
      outcome: args.outcome as CasefileAutoResearchDeferralOutcome,
      previousFailureCount: item.casefileResearchFailureCount,
      // The regular lease reaper intentionally clears scheduledClaimedAt when
      // it replaces an unstarted queued run. Keep a separate first-research
      // timestamp so that replacement cannot reset this plan's 48h stop
      // window and turn it into an infinite retry loop.
      planClaimedAt: item.casefileResearchStartedAt ?? item.scheduledClaimedAt ?? run.startedAt,
      now,
      maxFailures: CASEFILE_AUTO_RESEARCH_MAX_PLAN_FAILURES,
      maxAgeMs: CASEFILE_AUTO_RESEARCH_MAX_PLAN_AGE_MS,
    });
    const outcomeDetail = cleanError(args.reason);
    const failurePatch = args.outcome === "research_failed"
      ? {
          casefileResearchFirstFailedAt: item.casefileResearchFirstFailedAt ?? now,
          casefileResearchLastFailedAt: now,
        }
      : {};
    const commonPatch = {
      casefileResearchStartedAt:
        item.casefileResearchStartedAt ?? item.scheduledClaimedAt ?? run.startedAt ?? now,
      casefileResearchFailureCount: disposition.failureCount,
      casefileResearchLastOutcome: args.outcome,
      ...failurePatch,
    };

    if (disposition.state === "requeue") {
      await ctx.db.patch(args.itemId, commonPatch);
      return { state: "requeue" as const, failureCount: disposition.failureCount };
    }

    const reason = cleanError(`${disposition.reason} Last scheduler outcome: ${outcomeDetail}`);
    await ctx.db.patch(args.runId, {
      status: "failed",
      finishedAt: now,
      error: reason,
      heartbeatAt: now,
      leaseExpiresAt: undefined,
      leaseOwner: undefined,
      leaseRecoveryPending: undefined,
      remoteChildWaitLeaseOwner: undefined,
      remoteChildWaitExecutionLeaseToken: undefined,
      remoteChildWaitBlockId: undefined,
      remoteChildWaitDispatchKey: undefined,
      remoteChildWaitUntil: undefined,
    });
    await ctx.db.patch(args.itemId, {
      ...commonPatch,
      casefileResearchBlockedAt: now,
      scheduledFailure: reason,
    });
    return { state: "blocked" as const, failureCount: disposition.failureCount, reason };
  },
});

/** Service-only durable lookup used to reject forged/stale Trigger payloads. */
export const getClaimedPlanItemForRun = query({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    itemId: v.id("contentPlan"),
    runId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    await requirePlannerService(ctx);
    const [item, run] = await Promise.all([ctx.db.get(args.itemId), ctx.db.get(args.runId)]);
    if (!item || !run || item.ownerId !== args.ownerId || run.ownerId !== args.ownerId ||
        item.channelId !== args.channelId || run.channelId !== args.channelId ||
        item.scheduledRunId !== args.runId || run.planItemId !== args.itemId) {
      throw new Error("scheduled plan run ownership/fence mismatch");
    }
    const payload = scheduledItemPayload(item);
    assertScheduledPlanPayloadMatches(payload, scheduledRunPayload(run));
    return payload;
  },
});

/** Atomically marks both a successful run and its exact plan item complete. */
export const completeClaimedPlanRun = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    itemId: v.id("contentPlan"),
    runId: v.id("runs"),
    leaseOwner: v.optional(v.string()),
    executionLeaseToken: v.optional(v.number()),
    finishedAt: v.number(),
    costTotal: v.number(),
  },
  handler: async (ctx, args) => {
    await requirePlannerService(ctx);
    if (!Number.isFinite(args.finishedAt) || !Number.isFinite(args.costTotal) || args.costTotal < 0) {
      throw new Error("scheduled plan completion values are invalid");
    }
    const [item, run, stages] = await Promise.all([
      ctx.db.get(args.itemId),
      ctx.db.get(args.runId),
      ctx.db.query("runStages").withIndex("by_run", (q) => q.eq("runId", args.runId)).collect(),
    ]);
    if (!item || !run || item.ownerId !== args.ownerId || run.ownerId !== args.ownerId ||
        item.channelId !== args.channelId || run.channelId !== args.channelId ||
        item.scheduledRunId !== args.runId || run.planItemId !== args.itemId) {
      throw new Error("scheduled plan completion ownership/fence mismatch");
    }
    const payload = scheduledItemPayload(item);
    assertScheduledPlanPayloadMatches(payload, scheduledRunPayload(run));
    const liveStages = stages.filter((stage) => stage.status !== "superseded");
    if (!liveStages.some((stage) => stage.status === "ok") || liveStages.some((stage) => stage.status !== "ok")) {
      throw new Error("scheduled plan cannot be used before durable pipeline stages succeed");
    }
    if (item.status === "used") {
      if (run.status !== "ok" || Math.abs(run.costTotal - args.costTotal) > 0.000001) {
        throw new Error("scheduled plan completion replay mismatch");
      }
      // A lost response can re-observe its exact completed result, but it
      // cannot write a terminal row after its execution lease was cleared.
      return { state: "used" as const, reused: true };
    }
    if (item.status !== "ready") throw new Error(`scheduled plan item is ${item.status}, not ready`);
    assertClaimedPlanExecutionFence(
      run,
      args.leaseOwner,
      args.executionLeaseToken,
    );
    const continuationPatch = await completedPublishContinuationPatch(
      ctx,
      run,
      args.finishedAt,
    );

    const priorTopic = await ctx.db
      .query("topicMemory")
      .withIndex("by_channel_key", (q) => q.eq("channelId", args.channelId).eq("key", payload.topic))
      .first();
    if (!priorTopic) {
      await ctx.db.insert("topicMemory", {
        ownerId: args.ownerId,
        channelId: args.channelId,
        key: payload.topic,
        usedAt: args.finishedAt,
      });
    }
    await ctx.db.patch(args.runId, {
      status: "ok",
      finishedAt: args.finishedAt,
      costTotal: args.costTotal,
      error: undefined,
      heartbeatAt: args.finishedAt,
      leaseExpiresAt: undefined,
      leaseOwner: undefined,
      leaseRecoveryPending: undefined,
      remoteChildWaitLeaseOwner: undefined,
      remoteChildWaitExecutionLeaseToken: undefined,
      remoteChildWaitBlockId: undefined,
      remoteChildWaitDispatchKey: undefined,
      remoteChildWaitUntil: undefined,
      ...continuationPatch,
    });
    await ctx.db.patch(args.itemId, {
      status: "used",
      scheduledUsedAt: args.finishedAt,
      scheduledFailure: undefined,
    });
    return { state: "used" as const, reused: false };
  },
});

/** Persist failure without releasing the paid-work fence to a different run. */
export const failClaimedPlanRun = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    itemId: v.id("contentPlan"),
    runId: v.id("runs"),
    leaseOwner: v.optional(v.string()),
    executionLeaseToken: v.optional(v.number()),
    failedAt: v.number(),
    error: v.string(),
    costTotal: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePlannerService(ctx);
    const [item, run] = await Promise.all([ctx.db.get(args.itemId), ctx.db.get(args.runId)]);
    if (!item || !run || item.ownerId !== args.ownerId || run.ownerId !== args.ownerId ||
        item.channelId !== args.channelId || run.channelId !== args.channelId ||
        item.scheduledRunId !== args.runId || run.planItemId !== args.itemId) {
      throw new Error("scheduled plan failure ownership/fence mismatch");
    }
    if (item.status === "used") return { state: "used" as const };
    assertClaimedPlanExecutionFence(
      run,
      args.leaseOwner,
      args.executionLeaseToken,
    );
    const error = cleanError(args.error);
    await ctx.db.patch(args.runId, {
      status: "failed",
      finishedAt: args.failedAt,
      ...(args.costTotal !== undefined ? { costTotal: validUsd(args.costTotal, "run cost") } : {}),
      error,
      heartbeatAt: args.failedAt,
      leaseExpiresAt: undefined,
      leaseOwner: undefined,
      leaseRecoveryPending: undefined,
      remoteChildWaitLeaseOwner: undefined,
      remoteChildWaitExecutionLeaseToken: undefined,
      remoteChildWaitBlockId: undefined,
      remoteChildWaitDispatchKey: undefined,
      remoteChildWaitUntil: undefined,
    });
    await ctx.db.patch(args.itemId, { scheduledFailure: error });
    return { state: "failed" as const };
  },
});

const OPERATIONAL_CALENDAR_MAINTENANCE_CONFIRMATION =
  "CANCEL_ORPHAN_READY_AND_MATERIALIZE_SCHEDULE_DEFAULTS";

/**
 * Recoverable operational-calendar maintenance. Dry-run is the default safety
 * path. Apply marks orphan ready rows cancelled (never deletes them) and writes
 * only schedule values that the runtime already treated as implicit defaults.
 */
export const reconcileOperationalCalendarData = mutation({
  args: {
    ownerId: v.string(),
    apply: v.boolean(),
    confirmation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (
      args.apply &&
      args.confirmation !== OPERATIONAL_CALENDAR_MAINTENANCE_CONFIRMATION
    ) {
      throw new Error(
        `apply requires confirmation ${OPERATIONAL_CALENDAR_MAINTENANCE_CONFIRMATION}`,
      );
    }

    const [channels, readyRows] = await Promise.all([
      ctx.db
        .query("channels")
        .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
        .collect(),
      ctx.db
        .query("contentPlan")
        .withIndex("by_owner_status", (q) =>
          q.eq("ownerId", args.ownerId).eq("status", "ready"),
        )
        .collect(),
    ]);
    const orphanReadyRows = orphanReadyRowsForMaintenance(
      readyRows,
      channels.map((channel) => channel._id),
    );
    // LOCK GUARD (skip, do NOT fork). This is a fleet-wide backfill that reruns
    // on demand; forking here would mint a v2 for every locked channel on every
    // pass — the locked row would still be missing its defaults next time, so
    // the forks would never stop. A finished channel keeps the schedule it
    // shipped with.
    const lockedSkipped = channels.filter((channel) => isChannelLocked(channel));
    const scheduleUpdates = channels.flatMap((channel) => {
      if (isChannelLocked(channel)) return [];
      const result = materializeCalendarScheduleDefaults(channel);
      return result.changed ? [{ channel, ...result }] : [];
    });
    const fieldCounts = {
      frequency: 0,
      days: 0,
      timezone: 0,
      localTime: 0,
      enabled: 0,
    };
    for (const update of scheduleUpdates) {
      for (const field of update.fields) fieldCounts[field] += 1;
    }

    if (args.apply) {
      for (const row of orphanReadyRows) {
        await ctx.db.patch(row._id, orphanReadyCancellationPatch());
      }
      for (const update of scheduleUpdates) {
        await ctx.db.patch(update.channel._id, { schedule: update.schedule });
      }
    }

    return {
      mode: args.apply ? "apply" as const : "dry_run" as const,
      orphanReady: {
        count: orphanReadyRows.length,
        action: args.apply ? "cancelled" as const : "would_cancel" as const,
        sampleIds: orphanReadyRows.slice(0, 20).map((row) => String(row._id)),
      },
      scheduleDefaults: {
        channelCount: scheduleUpdates.length,
        action: args.apply ? "materialized" as const : "would_materialize" as const,
        // Locked ("done") channels are deliberately excluded from the backfill.
        lockedSkippedCount: lockedSkipped.length,
        lockedSkippedIds: lockedSkipped.slice(0, 50).map((channel) => String(channel._id)),
        fieldCounts,
        channels: scheduleUpdates.slice(0, 50).map((update) => ({
          channelId: String(update.channel._id),
          name: update.channel.name,
          fields: update.fields,
          frequency: update.schedule.frequency,
          days: update.schedule.days ?? [],
          timezone: update.schedule.timezone,
          localTime: update.schedule.localTime,
          enabled: update.schedule.enabled,
        })),
      },
    };
  },
});
