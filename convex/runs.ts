import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import { internalMutation, query as publicQuery } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { evaluateConvexAuthProbeIdentity } from "../src/lib/convexAuthProbe";
import {
  decidePipelineInvocationClaim,
  normalizePipelineInvocationSnapshot,
  renderBlockMachineClass,
  type PipelineInvocationSnapshot,
} from "../src/lib/pipelineInvocationSnapshot";
import { pipelineInvocationSha256 } from "../src/lib/pipelineInvocationHash";
import { frozenRunPipelinePresentation } from "../src/lib/runPipelinePresentation";
import {
  assertScheduledPlanPayloadMatches,
  normalizeScheduledPlanPayload,
} from "../src/lib/scheduledPlanRuntime";
import {
  assertChannelInceptionProbeEnvelopeStructure,
  type ChannelInceptionProbeAttemptCheckpoint,
} from "../src/lib/channelInceptionProbeContract";
import {
  completedPublishContinuationPatch,
  requireExactBoundPublishIntent,
} from "./publishContinuationState";
import {
  MAX_AUTOMATIC_LEASE_RECOVERIES,
  RUN_EXECUTION_LEASE_MS,
  RUN_QUEUE_LEASE_MS,
  assertRunExecutionWriteFence,
  assertRunLeaseClaimable,
  effectiveRunLeaseExpiry,
  expiredRunRecoveryDisposition,
  isRunLeaseExpired,
  requiresRunExecutionWriteFence,
} from "../src/lib/runLease";
import {
  MAX_REMOTE_CHILD_WAIT_LEASE_MS,
  RENDER_CHILD_HEARTBEAT_LEASE_MS,
  renderChildProviderWorkWindowMs,
} from "../src/lib/renderChildLease";
import {
  SERIALIZED_PROGRAM_EPISODE_BUSY_RETRY_MAX_ATTEMPTS,
  SERIALIZED_PROGRAM_EPISODE_BUSY_RETRY_MAX_DELAY_MS,
} from "../src/lib/serializedProgramEpisode";
import {
  BUNDLE_FANOUT_DISPATCH_LEASE_MS,
  BUNDLE_FANOUT_DISPATCH_MAX_LIFETIME_MS,
  BUNDLE_FANOUT_MAX_DISPATCH_ATTEMPTS,
  BUNDLE_FANOUT_QUEUE_WAIT_MAX_MS,
  BUNDLE_FANOUT_VERSION,
  bundleFanoutDispatchIsTerminal,
  bundleFanoutDispatchKey,
  bundleFanoutDispatchRetryDelayMs,
} from "../src/lib/bundleFanoutContract";
import {
  RECENT_RUNS_LIMIT,
  RUN_HISTORY_PAGE_LIMIT,
  RUNS_BY_CHANNEL_LIMIT,
  validatedReadLimit,
} from "../src/lib/boundedConvexReads";
import { normalizeReleaseEvidenceStatus } from "../src/lib/releaseEvidenceStatus";
import { MAX_PUBLISH_CONTINUATION_ENQUEUE_ATTEMPTS } from "../src/lib/publishRetrySchedule";
import {
  assertApprovedFactualReviewResume,
  requeueExpiredFactualReviewResumeForLease,
  terminalizeFactualReviewResumeForLease,
} from "./factualReviewCheckpoints";
import { assertReviewedDataStoryInitialAdmissionLease } from "./reviewedDataStoryRunAdmissions";
import { assertRouteQualificationBenchmarkDispatchLease } from "./routeQualificationBenchmarkRuns";

const MAX_SELF_HEAL_GENERATION = 2;
// An accepted post-upload continuation must either claim its failed run within
// the ordinary queue lease or be reissued from its immutable outbox receipt.
// Keep this aligned with the run queue so a healthy serialized delivery is not
// prematurely duplicated.
export const PUBLISH_CONTINUATION_QUEUE_LEASE_MS = RUN_QUEUE_LEASE_MS;

function normalizeSelfHealGeneration(value: unknown): number {
  if (value === undefined) return 0;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_SELF_HEAL_GENERATION
  ) {
    throw new Error("run self-heal generation is invalid");
  }
  return value;
}

function clearRemoteChildWaitPatch() {
  return {
    remoteChildWaitLeaseOwner: undefined,
    remoteChildWaitExecutionLeaseToken: undefined,
    remoteChildWaitBlockId: undefined,
    remoteChildWaitDispatchKey: undefined,
    remoteChildWaitUntil: undefined,
    remoteChildWaitDeadline: undefined,
  };
}

function assertOptionalRunExecutionWriteFence(
  run: Parameters<typeof assertRunExecutionWriteFence>[0],
  leaseOwner: string | undefined,
  executionLeaseToken: number | undefined,
  operation: string,
): void {
  if ((leaseOwner === undefined) !== (executionLeaseToken === undefined)) {
    throw new Error(`${operation} must provide both execution lease fence fields or neither`);
  }
  if (leaseOwner !== undefined && executionLeaseToken !== undefined) {
    assertRunExecutionWriteFence(run, { leaseOwner, executionLeaseToken }, Date.now());
  } else if (requiresRunExecutionWriteFence(run)) {
    throw new Error(`${operation} requires an execution lease fence`);
  }
}

/**
 * A publish upload can complete in the external scheduler after its originating
 * pipeline has already reached a terminal failed state. That scheduler has no
 * pipeline execution lease, but it may only record the immutable uploaded
 * intent so the failed pipeline can be resumed. Keep this deliberately
 * separate from the normal worker-write fence: a live worker, a reaper-pending
 * run, or any residual child/lease receipt must still present its exact lease.
 */
function assertPublishContinuationHandoffFence(
  run: Parameters<typeof assertRunExecutionWriteFence>[0] & {
    remoteChildWaitLeaseOwner?: string;
    remoteChildWaitExecutionLeaseToken?: number;
    remoteChildWaitBlockId?: string;
    remoteChildWaitDispatchKey?: string;
    remoteChildWaitUntil?: number;
    remoteChildWaitDeadline?: number;
  },
  leaseOwner: string | undefined,
  executionLeaseToken: number | undefined,
  externalUploadedFailedRunHandoff: "uploaded_failed_run" | undefined,
  operation: string,
): void {
  if (externalUploadedFailedRunHandoff === undefined) {
    assertOptionalRunExecutionWriteFence(
      run,
      leaseOwner,
      executionLeaseToken,
      operation,
    );
    return;
  }
  if (leaseOwner !== undefined || executionLeaseToken !== undefined) {
    throw new Error(
      `${operation} external uploaded handoff cannot also provide an execution lease fence`,
    );
  }
  if (
    run.status !== "failed" ||
    run.leaseOwner !== undefined ||
    run.leaseExpiresAt !== undefined ||
    run.leaseRecoveryPending === true ||
    run.remoteChildWaitLeaseOwner !== undefined ||
    run.remoteChildWaitExecutionLeaseToken !== undefined ||
    run.remoteChildWaitBlockId !== undefined ||
    run.remoteChildWaitDispatchKey !== undefined ||
    run.remoteChildWaitUntil !== undefined ||
    run.remoteChildWaitDeadline !== undefined
  ) {
    throw new Error(
      `${operation} external uploaded handoff requires a terminal failed run without an active or recovering execution lease`,
    );
  }
}

function publishContinuationAttemptCount(value: unknown): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("publish continuation has an invalid bounded delivery count");
  }
  return value as number;
}

function publishContinuationQueueDeadline(run: {
  publishContinuationQueueDeadlineAt?: unknown;
  publishContinuationQueuedAt?: unknown;
}): number | undefined {
  const explicit = run.publishContinuationQueueDeadlineAt;
  if (explicit !== undefined) {
    return Number.isSafeInteger(explicit) && (explicit as number) >= 0
      ? (explicit as number)
      : undefined;
  }
  // Pre-deadline rows still have their durable queue receipt. Infer the same
  // bounded deadline so deployment cannot leave a legacy accepted delivery
  // stalled forever.
  const queuedAt = run.publishContinuationQueuedAt;
  if (!Number.isSafeInteger(queuedAt) || (queuedAt as number) < 0) return undefined;
  const deadline = (queuedAt as number) + PUBLISH_CONTINUATION_QUEUE_LEASE_MS;
  return Number.isSafeInteger(deadline) ? deadline : undefined;
}

function publishContinuationManualRecoveryPatch(now: number, reason: string) {
  return {
    publishContinuationState: "manual_recovery_required" as const,
    publishContinuationUpdatedAt: now,
    publishContinuationQueuedAt: undefined,
    publishContinuationQueueDeadlineAt: undefined,
    publishContinuationTriggerRunId: undefined,
    publishContinuationLastError: reason.slice(0, 1_000),
    heartbeatAt: now,
  };
}

function withReleaseEvidenceStatus<T extends { releaseEvidenceStatus?: unknown }>(run: T) {
  // Missing is a pre-projection legacy record, not a passing release state.
  return {
    ...run,
    releaseEvidenceStatus: normalizeReleaseEvidenceStatus(run.releaseEvidenceStatus),
  };
}

/**
 * Data-free rollout contract for the Trigger -> Convex authentication boundary.
 * This function is callable without credentials solely so the rollout probe can
 * positively observe denial; only a matching service identity is granted.
 */
export const verifyAuthBoundary = publicQuery({
  args: {
    expectedOwnerId: v.string(),
    challenge: v.string(),
  },
  handler: async (ctx, args) =>
    evaluateConvexAuthProbeIdentity(await ctx.auth.getUserIdentity(), args),
});

export const createRun = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    status: v.optional(v.union(v.literal("queued"), v.literal("running"))),
  },
  returns: v.id("runs"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const status = args.status ?? "queued";
    return await ctx.db.insert("runs", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      status,
      startedAt: now,
      costTotal: 0,
      releaseEvidenceStatus: "not_ready",
      releaseEvidenceUpdatedAt: now,
      heartbeatAt: now,
      selfHealGeneration: 0,
      leaseExpiresAt:
        now + (status === "queued" ? RUN_QUEUE_LEASE_MS : RUN_EXECUTION_LEASE_MS),
    });
  },
});

/**
 * Idempotent no-spend shell for a Channel Inception probe child. The stable
 * dispatch key closes the crash gap between creating the run row and saving
 * the parent stage checkpoint.
 */
export const createProbeRun = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    dispatchKey: v.string(),
  },
  returns: v.id("runs"),
  handler: async (ctx, args) => {
    if (!args.dispatchKey.trim() || args.dispatchKey.length > 300) {
      throw new Error("probe dispatch key must contain 1-300 characters");
    }
    const existing = await ctx.db
      .query("runs")
      .withIndex("by_channel_probe_dispatch", (q) =>
        q.eq("channelId", args.channelId).eq("probeDispatchKey", args.dispatchKey))
      .unique();
    if (existing) {
      if (existing.ownerId !== args.ownerId) {
        throw new Error("probe dispatch key owner mismatch");
      }
      return existing._id;
    }
    const now = Date.now();
    return await ctx.db.insert("runs", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      status: "queued",
      startedAt: now,
      costTotal: 0,
      releaseEvidenceStatus: "not_ready",
      releaseEvidenceUpdatedAt: now,
      heartbeatAt: now,
      selfHealGeneration: 0,
      leaseExpiresAt: now + RUN_QUEUE_LEASE_MS,
      probeDispatchKey: args.dispatchKey,
    });
  },
});

type BundleFanoutDispatchState = "pending" | "dispatching" | "enqueued" | "failed";

function mintBundleFanoutDispatchToken(): string {
  const token = globalThis.crypto?.randomUUID?.();
  if (!token) throw new Error("bundle fanout dispatch token could not be minted");
  return token;
}

function bundleFanoutEnvelopeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("bundle fanout dispatch envelope must be an object");
  }
  return value as Record<string, unknown>;
}

function assertBundleFanoutEnvelopeBinding(input: {
  envelope: unknown;
  fingerprint: string;
  ownerId: string;
  baseRunId: string;
  baseChannelId: string;
  siblingChannelId: string;
  dispatchKey: string;
}): Record<string, unknown> {
  if (!/^[a-f0-9]{64}$/.test(input.fingerprint)) {
    throw new Error("bundle fanout dispatch envelope fingerprint is invalid");
  }
  const expectedKey = bundleFanoutDispatchKey(input.baseRunId, input.siblingChannelId);
  if (input.dispatchKey !== expectedKey) {
    throw new Error("bundle fanout dispatch key is not bound to its base run and sibling");
  }
  const envelope = bundleFanoutEnvelopeRecord(input.envelope);
  if (
    envelope.version !== BUNDLE_FANOUT_VERSION ||
    envelope.ownerId !== input.ownerId ||
    envelope.baseRunId !== input.baseRunId ||
    envelope.baseChannelId !== input.baseChannelId ||
    envelope.siblingChannelId !== input.siblingChannelId ||
    envelope.dispatchKey !== expectedKey ||
    envelope.dispatchEnvelopeFingerprint !== input.fingerprint
  ) {
    throw new Error("bundle fanout dispatch envelope is not bound to its durable identities");
  }
  const reuse = bundleFanoutEnvelopeRecord(envelope.reuse);
  if (
    typeof reuse.language !== "string" ||
    !reuse.language.trim() ||
    reuse.language.length > 64 ||
    !Array.isArray(reuse.footageKeys) ||
    reuse.footageKeys.length > 160 ||
    reuse.footageKeys.some((key) => typeof key !== "string" || !key.trim() || key.length > 2_000)
  ) {
    throw new Error("bundle fanout dispatch envelope reuse payload is invalid");
  }
  if (
    (reuse.topic !== undefined && (typeof reuse.topic !== "string" || reuse.topic.length > 20_000)) ||
    (reuse.musicKey !== undefined &&
      (typeof reuse.musicKey !== "string" || !reuse.musicKey.trim() || reuse.musicKey.length > 2_000))
  ) {
    throw new Error("bundle fanout dispatch envelope optional reuse fields are invalid");
  }
  if (reuse.thirdPartyStockEvidence !== undefined) {
    const stockEvidence = bundleFanoutEnvelopeRecord(reuse.thirdPartyStockEvidence);
    if (
      stockEvidence.version !== "third-party-stock-evidence/v1" ||
      typeof stockEvidence.manifestKey !== "string" ||
      !stockEvidence.manifestKey.trim() ||
      stockEvidence.manifestKey.length > 2_000 ||
      typeof stockEvidence.manifestSha256 !== "string" ||
      !/^[a-f0-9]{64}$/i.test(stockEvidence.manifestSha256) ||
      typeof stockEvidence.inputCount !== "number" ||
      !Number.isInteger(stockEvidence.inputCount) ||
      stockEvidence.inputCount < 1 ||
      stockEvidence.inputCount > 160 ||
      typeof stockEvidence.stockAssetCount !== "number" ||
      !Number.isInteger(stockEvidence.stockAssetCount) ||
      stockEvidence.stockAssetCount < 0 ||
      stockEvidence.stockAssetCount > stockEvidence.inputCount
    ) {
      throw new Error("bundle fanout third-party stock evidence reference is invalid");
    }
  }
  let encoded: string;
  try {
    encoded = JSON.stringify(envelope);
  } catch {
    throw new Error("bundle fanout dispatch envelope cannot be serialized");
  }
  if (!encoded || encoded.length > 250_000) {
    throw new Error("bundle fanout dispatch envelope exceeds its durable size limit");
  }
  return envelope;
}

function bundleFanoutDispatchState(run: {
  bundleDispatchState?: unknown;
}): BundleFanoutDispatchState {
  const state = run.bundleDispatchState;
  if (
    state !== "pending" &&
    state !== "dispatching" &&
    state !== "enqueued" &&
    state !== "failed"
  ) {
    throw new Error("bundle fanout dispatch receipt state is invalid");
  }
  return state;
}

function bundleFanoutDispatchAttempts(run: { bundleDispatchAttempts?: unknown }): number {
  const attempts = run.bundleDispatchAttempts;
  if (
    !Number.isSafeInteger(attempts) ||
    (attempts as number) < 0 ||
    (attempts as number) > BUNDLE_FANOUT_MAX_DISPATCH_ATTEMPTS
  ) {
    throw new Error("bundle fanout dispatch receipt attempts are invalid");
  }
  return attempts as number;
}

function bundleFanoutDispatchDeadline(run: { bundleDispatchDeadlineAt?: unknown }): number {
  const deadline = run.bundleDispatchDeadlineAt;
  if (!Number.isSafeInteger(deadline) || (deadline as number) <= 0) {
    throw new Error("bundle fanout dispatch receipt deadline is invalid");
  }
  return deadline as number;
}

function hasLiveBundleFanoutDispatchLease(
  state: BundleFanoutDispatchState,
  run: {
    bundleDispatchLeaseToken?: unknown;
    bundleDispatchLeaseExpiresAt?: unknown;
  },
  leaseToken: string,
  now: number,
): boolean {
  return state === "dispatching" &&
    run.bundleDispatchLeaseToken === leaseToken &&
    Number.isSafeInteger(run.bundleDispatchLeaseExpiresAt) &&
    (run.bundleDispatchLeaseExpiresAt as number) > now;
}

function bundleFanoutEnqueuedReceiptPatch(now: number) {
  return {
    bundleDispatchState: "enqueued" as const,
    bundleDispatchNextAttemptAt: undefined,
    bundleDispatchLeaseToken: undefined,
    bundleDispatchLeaseExpiresAt: undefined,
    bundleDispatchQueueDeadlineAt: undefined,
    bundleDispatchEnqueuedAt: now,
    bundleDispatchUpdatedAt: now,
  };
}

function bundleFanoutReceiptTerminalPatch(now: number, message: string) {
  return {
    bundleDispatchState: "failed" as const,
    bundleDispatchNextAttemptAt: undefined,
    bundleDispatchLeaseToken: undefined,
    bundleDispatchLeaseExpiresAt: undefined,
    bundleDispatchQueueDeadlineAt: undefined,
    bundleDispatchLastError: message,
    bundleDispatchUpdatedAt: now,
  };
}

function hasBundleFanoutReceipt(run: {
  bundleDispatchState?: unknown;
  bundleParentRunId?: unknown;
  bundleParentChannelId?: unknown;
  bundleDispatchKey?: unknown;
  bundleDispatchEnvelope?: unknown;
  bundleDispatchEnvelopeFingerprint?: unknown;
}): boolean {
  return run.bundleDispatchState !== undefined ||
    run.bundleParentRunId !== undefined ||
    run.bundleParentChannelId !== undefined ||
    run.bundleDispatchKey !== undefined ||
    run.bundleDispatchEnvelope !== undefined ||
    run.bundleDispatchEnvelopeFingerprint !== undefined;
}

function boundedBundleFanoutQueueDeadline(
  run: {
    status?: unknown;
    bundleDispatchState?: unknown;
    bundleDispatchQueueDeadlineAt?: unknown;
    bundleDispatchEnqueuedAt?: unknown;
  },
): number | undefined {
  const deadline = run.bundleDispatchQueueDeadlineAt;
  const enqueuedAt = run.bundleDispatchEnqueuedAt;
  if (
    run.status !== "queued" ||
    run.bundleDispatchState !== "enqueued" ||
    !Number.isSafeInteger(deadline) ||
    !Number.isSafeInteger(enqueuedAt)
  ) {
    return undefined;
  }
  const expectedDeadline = (enqueuedAt as number) + BUNDLE_FANOUT_QUEUE_WAIT_MAX_MS;
  if (!Number.isSafeInteger(expectedDeadline) || deadline !== expectedDeadline) {
    return undefined;
  }
  return deadline as number;
}

function liveBundleFanoutQueueDeadline(
  run: {
    status?: unknown;
    bundleDispatchState?: unknown;
    bundleDispatchQueueDeadlineAt?: unknown;
    bundleDispatchEnqueuedAt?: unknown;
  },
  now: number,
): number | undefined {
  const deadline = boundedBundleFanoutQueueDeadline(run);
  return deadline !== undefined && deadline > now ? deadline : undefined;
}

function bundleFanoutTerminalPatch(now: number, message: string) {
  return {
    status: "failed",
    finishedAt: now,
    heartbeatAt: now,
    leaseExpiresAt: undefined,
    leaseOwner: undefined,
    leaseRecoveryPending: undefined,
    error: message,
    ...bundleFanoutReceiptTerminalPatch(now, message),
    ...clearRemoteChildWaitPatch(),
  };
}

/**
 * Atomically creates (or recovers) one no-spend sibling child shell and freezes
 * its exact reuse payload before any Trigger dispatch can reach a paid pipeline.
 */
export const claimBundleFanoutRun = mutation({
  args: {
    ownerId: v.string(),
    baseRunId: v.id("runs"),
    baseChannelId: v.id("channels"),
    siblingChannelId: v.id("channels"),
    dispatchKey: v.string(),
    envelope: v.any(),
    fingerprint: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "bundle fanout child claim");
    const [baseRun, baseChannel, sibling] = await Promise.all([
      ctx.db.get(args.baseRunId),
      ctx.db.get(args.baseChannelId),
      ctx.db.get(args.siblingChannelId),
    ]);
    if (!baseRun || !baseChannel || !sibling) {
      throw new Error("bundle fanout base run or channel does not exist");
    }
    if (
      baseRun.ownerId !== args.ownerId ||
      baseRun.channelId !== args.baseChannelId ||
      baseChannel.ownerId !== args.ownerId ||
      baseChannel.groupRole !== "base" ||
      !baseChannel.groupId ||
      sibling.ownerId !== args.ownerId ||
      sibling.groupId !== baseChannel.groupId ||
      sibling.groupRole !== "sibling" ||
      sibling.status !== "active"
    ) {
      throw new Error("bundle fanout base/sibling group identity is invalid");
    }
    const envelope = assertBundleFanoutEnvelopeBinding({
      envelope: args.envelope,
      fingerprint: args.fingerprint,
      ownerId: args.ownerId,
      baseRunId: String(args.baseRunId),
      baseChannelId: String(args.baseChannelId),
      siblingChannelId: String(args.siblingChannelId),
      dispatchKey: args.dispatchKey,
    });
    const existing = await ctx.db
      .query("runs")
      .withIndex("by_channel_bundle_dispatch", (q) =>
        q.eq("channelId", args.siblingChannelId).eq("bundleDispatchKey", args.dispatchKey))
      .unique();
    if (existing) {
      if (
        existing.ownerId !== args.ownerId ||
        existing.bundleParentRunId !== args.baseRunId ||
        existing.bundleParentChannelId !== args.baseChannelId ||
        existing.bundleDispatchKey !== args.dispatchKey ||
        existing.bundleDispatchEnvelopeFingerprint !== args.fingerprint
      ) {
        throw new Error("bundle fanout child receipt is immutable");
      }
      return {
        runId: existing._id,
        dispatchState: bundleFanoutDispatchState(existing),
        envelope: existing.bundleDispatchEnvelope,
        fingerprint: existing.bundleDispatchEnvelopeFingerprint,
        reused: true,
      };
    }
    const now = Date.now();
    const deadline = now + BUNDLE_FANOUT_DISPATCH_MAX_LIFETIME_MS;
    const childRunId = await ctx.db.insert("runs", {
      ownerId: args.ownerId,
      channelId: args.siblingChannelId,
      status: "queued",
      startedAt: now,
      costTotal: 0,
      releaseEvidenceStatus: "not_ready",
      releaseEvidenceUpdatedAt: now,
      heartbeatAt: now,
      selfHealGeneration: 0,
      // A pending/dispatching outbox receipt has only the 30-minute handoff
      // boundary. The longer queue allowance is installed after Trigger
      // acknowledgement, never before.
      leaseExpiresAt: deadline,
      bundleParentRunId: args.baseRunId,
      bundleParentChannelId: args.baseChannelId,
      bundleDispatchKey: args.dispatchKey,
      bundleDispatchEnvelope: envelope,
      bundleDispatchEnvelopeFingerprint: args.fingerprint,
      bundleDispatchState: "pending",
      bundleDispatchAttempts: 0,
      bundleDispatchNextAttemptAt: now,
      bundleDispatchDeadlineAt: deadline,
      bundleDispatchClaimedAt: now,
      bundleDispatchUpdatedAt: now,
    });
    return {
      runId: childRunId,
      dispatchState: "pending" as const,
      envelope,
      fingerprint: args.fingerprint,
      reused: false,
    };
  },
});

/** Claim one due fanout receipt so at most one dispatcher is between Convex and Trigger. */
export const claimBundleFanoutDispatch = mutation({
  args: {
    ownerId: v.string(),
    runId: v.id("runs"),
    now: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "bundle fanout dispatch claim");
    if (!Number.isSafeInteger(args.now) || args.now < 0) {
      throw new Error("bundle fanout dispatch claim time is invalid");
    }
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerId !== args.ownerId) {
      throw new Error("bundle fanout dispatch run owner mismatch");
    }
    const state = bundleFanoutDispatchState(run);
    const attempts = bundleFanoutDispatchAttempts(run);
    const deadline = bundleFanoutDispatchDeadline(run);
    const dispatchKey = run.bundleDispatchKey;
    const fingerprint = run.bundleDispatchEnvelopeFingerprint;
    const parentRunId = run.bundleParentRunId;
    const parentChannelId = run.bundleParentChannelId;
    if (
      typeof dispatchKey !== "string" ||
      !dispatchKey.trim() ||
      typeof fingerprint !== "string" ||
      !parentRunId ||
      !parentChannelId
    ) {
      throw new Error("bundle fanout dispatch receipt identity is incomplete");
    }
    const envelope = assertBundleFanoutEnvelopeBinding({
      envelope: run.bundleDispatchEnvelope,
      fingerprint,
      ownerId: args.ownerId,
      baseRunId: String(parentRunId),
      baseChannelId: String(parentChannelId),
      siblingChannelId: String(run.channelId),
      dispatchKey,
    });
    if (state === "failed") {
      return {
        kind: "failed" as const,
        runId: run._id,
        error: run.bundleDispatchLastError ?? run.error ?? "bundle fanout dispatch is terminal",
      };
    }
    if (run.status === "running" || run.status === "ok") {
      // Trigger already accepted this child. A lost enqueue acknowledgement
      // must never reset an execution/remote-child lease back to queue time.
      await ctx.db.patch(run._id, bundleFanoutEnqueuedReceiptPatch(args.now));
      return { kind: "enqueued" as const, runId: run._id };
    }
    if (run.status === "failed" || run.status === "canceled") {
      const error = run.bundleDispatchLastError ?? run.error ?? "bundle fanout child became terminal before dispatch";
      await ctx.db.patch(run._id, bundleFanoutReceiptTerminalPatch(args.now, error));
      return { kind: "failed" as const, runId: run._id, error };
    }
    if (state === "enqueued") {
      return { kind: "enqueued" as const, runId: run._id };
    }
    if (args.now >= deadline || bundleFanoutDispatchIsTerminal(attempts)) {
      const error =
        args.now >= deadline
          ? "bundle fanout dispatch deadline elapsed; manual reconciliation is required"
          : `bundle fanout dispatch exhausted ${BUNDLE_FANOUT_MAX_DISPATCH_ATTEMPTS} attempts; manual reconciliation is required`;
      await ctx.db.patch(run._id, bundleFanoutTerminalPatch(args.now, error));
      return { kind: "failed" as const, runId: run._id, error };
    }
    const leaseExpiresAt = run.bundleDispatchLeaseExpiresAt;
    if (
      state === "dispatching" &&
      Number.isSafeInteger(leaseExpiresAt) &&
      (leaseExpiresAt as number) > args.now
    ) {
      return { kind: "busy" as const, runId: run._id, retryAt: leaseExpiresAt };
    }
    const nextAttemptAt = run.bundleDispatchNextAttemptAt;
    if (
      state === "pending" &&
      Number.isSafeInteger(nextAttemptAt) &&
      (nextAttemptAt as number) > args.now
    ) {
      return { kind: "pending" as const, runId: run._id, retryAt: nextAttemptAt };
    }
    if (state !== "pending" && state !== "dispatching") {
      throw new Error("bundle fanout dispatch receipt cannot be claimed");
    }
    if (run.status !== "queued") {
      throw new Error("bundle fanout dispatch child is not queued for delivery");
    }
    // The original child claim is only an admission snapshot. Re-read both
    // channels immediately before the external Trigger boundary so a sibling
    // disabled or moved while a lost enqueue is recovering cannot spend.
    const [baseRun, baseChannel, sibling] = await Promise.all([
      ctx.db.get(parentRunId),
      ctx.db.get(parentChannelId),
      ctx.db.get(run.channelId),
    ]);
    const groupId = baseChannel?.groupId;
    if (
      !baseRun ||
      baseRun.ownerId !== args.ownerId ||
      baseRun.channelId !== parentChannelId ||
      !baseChannel ||
      baseChannel.ownerId !== args.ownerId ||
      baseChannel.groupRole !== "base" ||
      baseChannel.status !== "active" ||
      !groupId ||
      !sibling ||
      sibling.ownerId !== args.ownerId ||
      sibling.groupRole !== "sibling" ||
      sibling.status !== "active" ||
      sibling.groupId !== groupId
    ) {
      const error =
        "bundle fanout sibling/base eligibility changed before dispatch; receipt canceled and manual reconciliation is required";
      await ctx.db.patch(run._id, bundleFanoutTerminalPatch(args.now, error));
      return { kind: "failed" as const, runId: run._id, error };
    }
    const attempt = attempts + 1;
    const leaseToken = mintBundleFanoutDispatchToken();
    const claimLeaseExpiresAt = Math.min(deadline, args.now + BUNDLE_FANOUT_DISPATCH_LEASE_MS);
    await ctx.db.patch(run._id, {
      bundleDispatchState: "dispatching",
      bundleDispatchAttempts: attempt,
      bundleDispatchNextAttemptAt: undefined,
      bundleDispatchLeaseToken: leaseToken,
      bundleDispatchLeaseExpiresAt: claimLeaseExpiresAt,
      bundleDispatchUpdatedAt: args.now,
    });
    return {
      kind: "claimed" as const,
      runId: run._id,
      channelId: run.channelId,
      envelope,
      fingerprint,
      dispatchKey,
      leaseToken,
      attempt,
      leaseExpiresAt: claimLeaseExpiresAt,
    };
  },
});

/** Record the only durable evidence that Trigger accepted this fanout task. */
export const markBundleFanoutDispatchEnqueued = mutation({
  args: {
    ownerId: v.string(),
    runId: v.id("runs"),
    leaseToken: v.string(),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "bundle fanout dispatch enqueue receipt");
    if (!args.leaseToken.trim() || !Number.isSafeInteger(args.now) || args.now < 0) {
      throw new Error("bundle fanout dispatch enqueue receipt is invalid");
    }
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerId !== args.ownerId) {
      throw new Error("bundle fanout dispatch enqueue run owner mismatch");
    }
    const state = bundleFanoutDispatchState(run);
    if (!hasLiveBundleFanoutDispatchLease(state, run, args.leaseToken, args.now)) {
      throw new Error("bundle fanout dispatch enqueue receipt lost its claim lease");
    }
    if (run.status === "failed" || run.status === "canceled") {
      // Trigger can start and terminalize the child before its caller records
      // acceptance. Do not let the base stage report bundleEmitted in that
      // race; the durable dispatcher will reconcile the terminal receipt.
      throw new Error("bundle fanout child became terminal before enqueue acknowledgement");
    }
    const receiptPatch = bundleFanoutEnqueuedReceiptPatch(args.now);
    if (run.status === "queued") {
      await ctx.db.patch(run._id, {
        ...receiptPatch,
        // This exceptional bound covers one documented same-channel remote
        // render wait. The ordinary reaper honors it only for this fanout row.
        bundleDispatchQueueDeadlineAt: args.now + BUNDLE_FANOUT_QUEUE_WAIT_MAX_MS,
        leaseExpiresAt: args.now + RUN_QUEUE_LEASE_MS,
      });
    } else if (run.status === "running" || run.status === "ok") {
      // Trigger may have claimed execution before its caller records success.
      // Record only the outbox acknowledgement: never overwrite an execution
      // or remote-child lease with a generic queue lease.
      await ctx.db.patch(run._id, receiptPatch);
    } else {
      throw new Error("bundle fanout dispatch child is not claimable for enqueue acknowledgement");
    }
    return null;
  },
});

/**
 * A failed enqueue remains visible in the bounded outbox. The claim token
 * prevents an older dispatcher from overwriting a newer accepted dispatch.
 */
export const deferBundleFanoutDispatch = mutation({
  args: {
    ownerId: v.string(),
    runId: v.id("runs"),
    leaseToken: v.string(),
    now: v.number(),
    error: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "bundle fanout dispatch deferral");
    if (!args.leaseToken.trim() || !Number.isSafeInteger(args.now) || args.now < 0) {
      throw new Error("bundle fanout dispatch deferral is invalid");
    }
    const message = args.error.trim();
    if (!message || message.length > 1_000) {
      throw new Error("bundle fanout dispatch error is invalid");
    }
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerId !== args.ownerId) {
      throw new Error("bundle fanout dispatch deferral run owner mismatch");
    }
    const state = bundleFanoutDispatchState(run);
    if (!hasLiveBundleFanoutDispatchLease(state, run, args.leaseToken, args.now)) {
      throw new Error("bundle fanout dispatch deferral lost its claim lease");
    }
    if (run.status === "running" || run.status === "ok") {
      // An ambiguous Trigger response is not a reason to redeliver when the
      // child has already claimed execution. Keep its active lease untouched.
      await ctx.db.patch(run._id, bundleFanoutEnqueuedReceiptPatch(args.now));
      return { kind: "enqueued" as const };
    }
    if (run.status === "failed" || run.status === "canceled") {
      const terminal = run.bundleDispatchLastError ?? run.error ??
        "bundle fanout child became terminal before dispatch deferral";
      await ctx.db.patch(run._id, bundleFanoutReceiptTerminalPatch(args.now, terminal));
      return { kind: "failed" as const, error: terminal };
    }
    if (run.status !== "queued") {
      throw new Error("bundle fanout dispatch child is not queued for deferral");
    }
    const attempts = bundleFanoutDispatchAttempts(run);
    const deadline = bundleFanoutDispatchDeadline(run);
    if (bundleFanoutDispatchIsTerminal(attempts) || args.now >= deadline) {
      const terminal = bundleFanoutDispatchIsTerminal(attempts)
        ? `bundle fanout dispatch exhausted ${BUNDLE_FANOUT_MAX_DISPATCH_ATTEMPTS} attempts; manual reconciliation is required`
        : "bundle fanout dispatch deadline elapsed; manual reconciliation is required";
      await ctx.db.patch(run._id, bundleFanoutTerminalPatch(args.now, terminal));
      return { kind: "failed" as const, error: terminal };
    }
    const retryAt = args.now + bundleFanoutDispatchRetryDelayMs(attempts);
    if (retryAt >= deadline) {
      const terminal = "bundle fanout dispatch retry would exceed its deadline; manual reconciliation is required";
      await ctx.db.patch(run._id, bundleFanoutTerminalPatch(args.now, terminal));
      return { kind: "failed" as const, error: terminal };
    }
    await ctx.db.patch(run._id, {
      bundleDispatchState: "pending",
      bundleDispatchNextAttemptAt: retryAt,
      bundleDispatchLeaseToken: undefined,
      bundleDispatchLeaseExpiresAt: undefined,
      bundleDispatchQueueDeadlineAt: undefined,
      bundleDispatchLastError: message,
      bundleDispatchUpdatedAt: args.now,
      // An unacknowledged dispatcher never gets the longer queue allowance.
      // The reaper terminalizes the receipt at this fixed handoff boundary.
      leaseExpiresAt: deadline,
    });
    return { kind: "pending" as const, retryAt, attempt: attempts };
  },
});

/** Indexed service outbox for pending or abandoned fanout dispatch leases. */
export const listDueBundleFanoutDispatches = query({
  args: {
    ownerId: v.string(),
    now: v.number(),
  },
  returns: v.array(v.object({ runId: v.id("runs") })),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "bundle fanout dispatch listing");
    if (!Number.isSafeInteger(args.now) || args.now < 0) {
      throw new Error("bundle fanout dispatch listing time is invalid");
    }
    const [pending, expired] = await Promise.all([
      ctx.db
        .query("runs")
        .withIndex("by_owner_bundle_dispatch_due", (q) =>
          q
            .eq("ownerId", args.ownerId)
            .eq("bundleDispatchState", "pending")
            .lte("bundleDispatchNextAttemptAt", args.now))
        .take(25),
      ctx.db
        .query("runs")
        .withIndex("by_owner_bundle_dispatch_lease", (q) =>
          q
            .eq("ownerId", args.ownerId)
            .eq("bundleDispatchState", "dispatching")
            .lte("bundleDispatchLeaseExpiresAt", args.now))
        .take(25),
    ]);
    const ids = new Set<string>();
    const due: Array<{ runId: typeof pending[number]["_id"] }> = [];
    for (const run of [...pending, ...expired]) {
      if (run.status !== "queued") continue;
      if (ids.has(String(run._id))) continue;
      ids.add(String(run._id));
      due.push({ runId: run._id });
    }
    return due;
  },
});

export const claimExecutionLease = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    leaseOwner: v.string(),
    now: v.number(),
    // Only the bounded factual-review outbox may supply this. The worker never
    // accepts review content, route/profile state, or artifacts from Trigger.
    factualReviewResume: v.optional(v.object({
      checkpointId: v.id("factualReviewCheckpoints"),
      checkpointFingerprint: v.string(),
      approvalFingerprint: v.string(),
      invocationSha256: v.string(),
    })),
    // Only the dedicated reviewed-data-story outbox may cross its initial
    // manual boundary. The facts remain reload-only in runPipeline.
    reviewedDataStoryInitialAdmission: v.optional(v.object({
      admissionFingerprint: v.string(),
      packId: v.id("reviewedEvidencePacks"),
      contentFingerprint: v.string(),
    })),
    // Only the private route-qualification dispatcher may start a full
    // production-chain benchmark. The signed input itself is verified by the
    // Trigger receiver; this lease checks the durable outbox identity first.
    routeQualificationBenchmarkDispatch: v.optional(v.object({
      dispatchEnvelopeFingerprint: v.string(),
    })),
  },
  returns: v.union(
    v.object({
      kind: v.literal("claimed"),
      leaseExpiresAt: v.number(),
      executionAttempts: v.number(),
      executionLeaseToken: v.number(),
      selfHealGeneration: v.number(),
    }),
    v.object({
      kind: v.literal("fanout_ineligible"),
      error: v.string(),
    }),
    v.object({
      kind: v.literal("factual_review_awaiting"),
      error: v.string(),
    }),
    v.object({
      kind: v.literal("factual_review_ineligible"),
      error: v.string(),
    }),
    v.object({
      kind: v.literal("reviewed_data_story_initial_awaiting"),
      error: v.string(),
    }),
    v.object({
      kind: v.literal("reviewed_data_story_initial_ineligible"),
      error: v.string(),
    }),
    v.object({
      kind: v.literal("route_qualification_benchmark_awaiting"),
      error: v.string(),
    }),
    v.object({
      kind: v.literal("route_qualification_benchmark_ineligible"),
      error: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "run execution lease claim");
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`run not found: ${args.runId}`);
    if (run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
      throw new Error("run lease ownership/channel mismatch");
    }
    if (!args.leaseOwner.trim() || !Number.isFinite(args.now)) {
      throw new Error("run lease claim is invalid");
    }
    if (run.status === "factual_review_blocked") {
      return {
        kind: "factual_review_ineligible" as const,
        error: run.error ?? "factual review is terminally blocked; create a fresh revision",
      };
    }
    if (run.status === "reviewed_data_story_admission_blocked") {
      return {
        kind: "reviewed_data_story_initial_ineligible" as const,
        error: run.error ?? "reviewed data-story initial admission is terminally blocked; create a fresh reviewed pack",
      };
    }
    if (run.status === "route_qualification_benchmark_blocked") {
      return {
        kind: "route_qualification_benchmark_ineligible" as const,
        error: run.error ?? "route qualification benchmark is terminally blocked; create a fresh owner request",
      };
    }
    let factualReviewResuming = false;
    let reviewedDataStoryInitialResuming = false;
    let routeQualificationBenchmarkResuming = false;
    if (run.status === "awaiting_route_qualification_benchmark_dispatch") {
      if (!args.routeQualificationBenchmarkDispatch) {
        return {
          kind: "route_qualification_benchmark_awaiting" as const,
          error: "route qualification benchmark is awaiting its exact owner-confirmed private dispatch",
        };
      }
      try {
        assertRouteQualificationBenchmarkDispatchLease(
          run,
          args.routeQualificationBenchmarkDispatch,
        );
        routeQualificationBenchmarkResuming = true;
      } catch (error) {
        const message = `route qualification benchmark dispatch rejected before execution: ${
          error instanceof Error ? error.message : String(error)
        }`;
        await ctx.db.patch(run._id, {
          status: "route_qualification_benchmark_blocked",
          routeQualificationBenchmarkDispatchState: "blocked",
          routeQualificationBenchmarkDispatchQueueDeadlineAt: undefined,
          routeQualificationBenchmarkDispatchLastError: message,
          error: message,
          finishedAt: args.now,
          heartbeatAt: args.now,
        });
        return { kind: "route_qualification_benchmark_ineligible" as const, error: message };
      }
    } else if (
      args.routeQualificationBenchmarkDispatch &&
      run.routeQualificationBenchmarkDispatchState !== "consumed"
    ) {
      const message = "route qualification benchmark dispatch was supplied for a run outside its dedicated immutable outbox";
      await ctx.db.patch(run._id, {
        status: "route_qualification_benchmark_blocked",
        routeQualificationBenchmarkDispatchState: "blocked",
        routeQualificationBenchmarkDispatchQueueDeadlineAt: undefined,
        routeQualificationBenchmarkDispatchLastError: message,
        error: message,
        finishedAt: args.now,
        heartbeatAt: args.now,
      });
      return { kind: "route_qualification_benchmark_ineligible" as const, error: message };
    }
    if (run.status === "awaiting_reviewed_evidence_dispatch") {
      if (!args.reviewedDataStoryInitialAdmission) {
        return {
          kind: "reviewed_data_story_initial_awaiting" as const,
          error: "reviewed data-story is awaiting its exact owner-selected evidence dispatch",
        };
      }
      try {
        const admission = assertReviewedDataStoryInitialAdmissionLease(
          run,
          args.reviewedDataStoryInitialAdmission,
        );
        if (
          admission.selector.packId !== String(args.reviewedDataStoryInitialAdmission.packId) ||
          admission.selector.contentFingerprint !== args.reviewedDataStoryInitialAdmission.contentFingerprint
        ) {
          throw new Error("reviewed data-story initial dispatch selector does not match its immutable admission");
        }
        reviewedDataStoryInitialResuming = true;
      } catch (error) {
        const message = `reviewed data-story initial admission rejected before execution: ${
          error instanceof Error ? error.message : String(error)
        }`;
        await ctx.db.patch(run._id, {
          status: "reviewed_data_story_admission_blocked",
          reviewedDataStoryInitialDispatchState: "blocked",
          reviewedDataStoryInitialDispatchQueueDeadlineAt: undefined,
          reviewedDataStoryInitialDispatchLastError: message,
          error: message,
          finishedAt: args.now,
          heartbeatAt: args.now,
        });
        return { kind: "reviewed_data_story_initial_ineligible" as const, error: message };
      }
    } else if (
      args.reviewedDataStoryInitialAdmission &&
      run.reviewedDataStoryInitialDispatchState !== "consumed"
    ) {
      const message = "reviewed data-story initial admission was supplied for a run outside its dedicated immutable dispatch";
      await ctx.db.patch(run._id, {
        status: "reviewed_data_story_admission_blocked",
        reviewedDataStoryInitialDispatchState: "blocked",
        reviewedDataStoryInitialDispatchQueueDeadlineAt: undefined,
        reviewedDataStoryInitialDispatchLastError: message,
        error: message,
        finishedAt: args.now,
        heartbeatAt: args.now,
      });
      return { kind: "reviewed_data_story_initial_ineligible" as const, error: message };
    }
    if (run.status === "awaiting_factual_review") {
      if (!args.factualReviewResume) {
        // A scheduler/duplicate Trigger payload without the owner-approved
        // receipt must never cross this boundary. Keep the run waiting rather
        // than converting a human pause into a task failure/retry treadmill.
        return {
          kind: "factual_review_awaiting" as const,
          error: "factual review is awaiting explicit owner approval",
        };
      }
      try {
        await assertApprovedFactualReviewResume(ctx, {
          ownerId: args.ownerId,
          channelId: args.channelId,
          runId: args.runId,
          checkpointId: args.factualReviewResume.checkpointId,
          checkpointFingerprint: args.factualReviewResume.checkpointFingerprint,
          approvalFingerprint: args.factualReviewResume.approvalFingerprint,
          invocationSha256: args.factualReviewResume.invocationSha256,
        });
        factualReviewResuming = true;
      } catch (error) {
        const message = `factual review resume rejected before execution: ${
          error instanceof Error ? error.message : String(error)
        }`;
        await terminalizeFactualReviewResumeForLease(ctx, {
          ownerId: args.ownerId,
          channelId: args.channelId,
          runId: args.runId,
          reason: message,
          now: args.now,
        });
        return { kind: "factual_review_ineligible" as const, error: message };
      }
    } else if (args.factualReviewResume && run.factualReviewState !== "resumed") {
      const message = "factual review resume was supplied for a run that is not its approved awaiting receipt";
      await terminalizeFactualReviewResumeForLease(ctx, {
        ownerId: args.ownerId,
        channelId: args.channelId,
        runId: args.runId,
        reason: message,
        now: args.now,
      });
      return { kind: "factual_review_ineligible" as const, error: message };
    }
    const isFanoutReceipt = hasBundleFanoutReceipt(run);
    const fanoutState = run.bundleDispatchState === undefined
      ? undefined
      : bundleFanoutDispatchState(run);
    if (
      isFanoutReceipt &&
      (fanoutState === "failed" || run.status === "failed" || run.status === "canceled")
    ) {
      const error =
        "bundle fanout receipt is terminal before execution; manual reconciliation is required";
      // Return a terminal outcome rather than throwing after this patch:
      // Convex rolls back a mutation that throws, which would otherwise let
      // a delayed Trigger retry re-open this same paid execution boundary.
      await ctx.db.patch(run._id, bundleFanoutTerminalPatch(args.now, error));
      return { kind: "fanout_ineligible" as const, error };
    }
    if (
      run.serializedProgramEpisodeRetryAt !== undefined &&
      run.serializedProgramEpisodeRetryAt > args.now
    ) {
      throw new Error(
        `serialized program episode retry is not claimable before ${run.serializedProgramEpisodeRetryAt}`,
      );
    }
    const fanoutQueueDeadline = boundedBundleFanoutQueueDeadline(run);
    if (
      run.status === "queued" &&
      run.bundleDispatchState === "enqueued" &&
      run.bundleDispatchQueueDeadlineAt !== undefined &&
      (fanoutQueueDeadline === undefined || args.now >= fanoutQueueDeadline)
    ) {
      // The reaper terminalizes this receipt on its next tick. Reject now so a
      // delayed Trigger task cannot start provider work after this immutable
      // fanout queue deadline (or a malformed deadline) before that bounded
      // cron pass.
      throw new Error("bundle fanout queued dispatch deadline is invalid or elapsed before execution claim");
    }
    if (
      !factualReviewResuming &&
      !reviewedDataStoryInitialResuming &&
      !routeQualificationBenchmarkResuming
    ) {
      assertRunLeaseClaimable(run, args.leaseOwner, args.now);
    }
    const selfHealGeneration = normalizeSelfHealGeneration(run.selfHealGeneration);
    const reattachingLiveExecution =
      run.status === "running" &&
      run.leaseOwner === args.leaseOwner &&
      !isRunLeaseExpired(run, args.now) &&
      Number.isSafeInteger(run.executionAttempts) &&
      (run.executionAttempts ?? 0) > 0;
    // A live same-owner reattach has already crossed this admission boundary;
    // leave its fenced work intact. New or recovered generations must recheck
    // current group eligibility before they can execute any provider block.
    if (isFanoutReceipt && !reattachingLiveExecution) {
      let fanoutEligibilityError: string | undefined;
      const parentRunId = run.bundleParentRunId;
      const parentChannelId = run.bundleParentChannelId;
      if (fanoutState === undefined || !parentRunId || !parentChannelId) {
        fanoutEligibilityError =
          "bundle fanout receipt identity is incomplete before execution; manual reconciliation is required";
      } else {
        // Dispatch admission is only a point-in-time snapshot. An accepted
        // child can wait behind another remote render for hours, so validate
        // its durable parent/base/sibling binding in this same successful
        // execution-claim transaction before a Trigger worker reaches a paid
        // block. The lease assertion above prevents a stale peer from
        // canceling a different live worker's receipt.
        const [baseRun, baseChannel, sibling] = await Promise.all([
          ctx.db.get(parentRunId),
          ctx.db.get(parentChannelId),
          ctx.db.get(run.channelId),
        ]);
        const groupId = baseChannel?.groupId;
        if (
          !baseRun ||
          baseRun.ownerId !== args.ownerId ||
          baseRun.channelId !== parentChannelId ||
          !baseChannel ||
          baseChannel.ownerId !== args.ownerId ||
          baseChannel.groupRole !== "base" ||
          baseChannel.status !== "active" ||
          !groupId ||
          !sibling ||
          sibling.ownerId !== args.ownerId ||
          sibling.groupRole !== "sibling" ||
          sibling.status !== "active" ||
          sibling.groupId !== groupId
        ) {
          fanoutEligibilityError =
            "bundle fanout sibling/base eligibility changed before execution; receipt canceled and manual reconciliation is required";
        }
      }
      if (fanoutEligibilityError !== undefined) {
        await ctx.db.patch(run._id, bundleFanoutTerminalPatch(args.now, fanoutEligibilityError));
        return { kind: "fanout_ineligible" as const, error: fanoutEligibilityError };
      }
    }
    if (reattachingLiveExecution) {
      const executionAttempts = run.executionAttempts!;
      const preservesRemoteChildWait =
        run.remoteChildWaitLeaseOwner === args.leaseOwner &&
        run.remoteChildWaitExecutionLeaseToken === executionAttempts &&
        typeof run.remoteChildWaitUntil === "number" &&
        run.leaseExpiresAt === run.remoteChildWaitUntil;
      const leaseExpiresAt = preservesRemoteChildWait
        ? run.leaseExpiresAt!
        : args.now + RUN_EXECUTION_LEASE_MS;
      await ctx.db.patch(args.runId, {
        heartbeatAt: args.now,
        leaseExpiresAt,
        bundleDispatchQueueDeadlineAt: undefined,
        ...(preservesRemoteChildWait ? {} : clearRemoteChildWaitPatch()),
      });
      return {
        kind: "claimed" as const,
        leaseExpiresAt,
        executionAttempts,
        executionLeaseToken: executionAttempts,
        selfHealGeneration,
      };
    }
    const leaseExpiresAt = args.now + RUN_EXECUTION_LEASE_MS;
    const executionAttempts = (run.executionAttempts ?? 0) + 1;
    await ctx.db.patch(args.runId, {
      status: "running",
      heartbeatAt: args.now,
      leaseExpiresAt,
      leaseOwner: args.leaseOwner,
      executionAttempts,
      leaseRecoveryPending: undefined,
      serializedProgramEpisodeRetryAt: undefined,
      serializedProgramEpisodeRetryLastError: undefined,
      bundleDispatchQueueDeadlineAt: undefined,
      ...(factualReviewResuming
        ? {
            factualReviewState: "resumed" as const,
            factualReviewResumeState: "consumed" as const,
            factualReviewResumeUpdatedAt: args.now,
            factualReviewResumeQueueDeadlineAt: undefined,
            factualReviewResumeLastError: undefined,
          }
        : {}),
      ...(reviewedDataStoryInitialResuming
        ? {
            reviewedDataStoryInitialDispatchState: "consumed" as const,
            reviewedDataStoryInitialDispatchQueueDeadlineAt: undefined,
            reviewedDataStoryInitialDispatchLastError: undefined,
          }
        : {}),
      ...(routeQualificationBenchmarkResuming
        ? {
            routeQualificationBenchmarkDispatchState: "consumed" as const,
            routeQualificationBenchmarkDispatchQueueDeadlineAt: undefined,
            routeQualificationBenchmarkDispatchLastError: undefined,
          }
        : {}),
      ...clearRemoteChildWaitPatch(),
    });
    return {
      kind: "claimed" as const,
      leaseExpiresAt,
      executionAttempts,
      executionLeaseToken: executionAttempts,
      selfHealGeneration,
    };
  },
});

/**
 * Service-only durable handoff for a serialized episode that is currently
 * owned by another worker. The run stays queued with its frozen invocation;
 * Trigger may safely replay the exact same run only at/after `retryAt`.
 */
export const deferSerializedProgramEpisodeRetry = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    leaseOwner: v.string(),
    executionLeaseToken: v.number(),
    retryAt: v.number(),
    costTotal: v.number(),
    error: v.string(),
  },
  returns: v.object({ retryAt: v.number(), attempt: v.number() }),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "serialized program episode retry deferral");
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`serialized program episode retry run not found: ${args.runId}`);
    if (run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
      throw new Error("serialized program episode retry ownership/channel mismatch");
    }
    if (
      run.status === "queued" &&
      Number.isSafeInteger(run.serializedProgramEpisodeRetryAt) &&
      (run.serializedProgramEpisodeRetryAttempts ?? 0) > 0
    ) {
      // Lost Trigger responses and task retries reuse the exact durable retry
      // receipt instead of minting another delayed task identity.
      return {
        retryAt: run.serializedProgramEpisodeRetryAt!,
        attempt: run.serializedProgramEpisodeRetryAttempts!,
      };
    }
    const now = Date.now();
    try {
      assertRunExecutionWriteFence(run, {
        leaseOwner: args.leaseOwner,
        executionLeaseToken: args.executionLeaseToken,
      }, now);
    } catch {
      throw new Error("serialized program episode retry must release its current execution lease");
    }
    if (
      run.pipelineInvocationSnapshot === undefined ||
      typeof run.pipelineInvocationSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(run.pipelineInvocationSha256)
    ) {
      throw new Error("serialized program episode retry requires the exact frozen pipeline invocation");
    }
    if (
      !Number.isSafeInteger(args.retryAt) ||
      args.retryAt < now ||
      args.retryAt > now + SERIALIZED_PROGRAM_EPISODE_BUSY_RETRY_MAX_DELAY_MS
    ) {
      throw new Error("serialized program episode retry timestamp is outside its bounded durable lease window");
    }
    if (!Number.isFinite(args.costTotal) || args.costTotal < 0) {
      throw new Error("serialized program episode retry cost total is invalid");
    }
    const error = args.error.trim();
    if (!error || error.length > 1_000) {
      throw new Error("serialized program episode retry error is invalid");
    }
    const attempt = (run.serializedProgramEpisodeRetryAttempts ?? 0) + 1;
    if (attempt > SERIALIZED_PROGRAM_EPISODE_BUSY_RETRY_MAX_ATTEMPTS) {
      throw new Error("serialized program episode retry attempts are exhausted; manual contention recovery is required");
    }
    await ctx.db.patch(args.runId, {
      status: "queued",
      finishedAt: undefined,
      costTotal: args.costTotal,
      error,
      heartbeatAt: now,
      // Keep the queue lease beyond the scheduled not-before time so the
      // ordinary lease reaper never replaces this frozen invocation first.
      leaseExpiresAt: args.retryAt + RUN_QUEUE_LEASE_MS,
      leaseOwner: undefined,
      leaseRecoveryPending: undefined,
      serializedProgramEpisodeRetryAt: args.retryAt,
      serializedProgramEpisodeRetryAttempts: attempt,
      serializedProgramEpisodeRetryLastError: error,
      ...clearRemoteChildWaitPatch(),
    });
    return { retryAt: args.retryAt, attempt };
  },
});

/**
 * Read-only service outbox for a lost serialized-episode retry enqueue.
 *
 * Every returned row has an exact frozen invocation (and, if it is a planned
 * run, an exact immutable plan payload still matching its linked plan item).
 * The Trigger dispatcher merely reissues the same global idempotency receipt;
 * this query intentionally makes no state transition before a worker's
 * `claimExecutionLease` fences the actual execution.
 */
export const listDueSerializedProgramEpisodeRetries = query({
  args: {
    ownerId: v.string(),
    now: v.number(),
  },
  returns: v.array(
    v.object({
      runId: v.id("runs"),
      channelId: v.id("channels"),
      invocationSha256: v.string(),
      retryAt: v.number(),
      attempt: v.number(),
      scheduledPlan: v.optional(
        v.object({
          planItemId: v.string(),
          topic: v.string(),
          title: v.string(),
          thumbnailKey: v.string(),
          scheduledAt: v.optional(v.number()),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "serialized program episode retry dispatch");
    if (!Number.isSafeInteger(args.now)) {
      throw new Error("serialized program episode retry dispatch time is invalid");
    }
    // Reserve half the bounded dispatch batch for each lifecycle state so a
    // noisy queued backlog cannot starve reaped same-run recoveries forever.
    const queuedCandidates = await ctx.db
      .query("runs")
      .withIndex("by_owner_serialized_program_episode_retry", (q) =>
        q
          .eq("ownerId", args.ownerId)
          .eq("status", "queued")
          .lte("serializedProgramEpisodeRetryAt", args.now),
      )
      .take(25);
    // If the dispatcher was unavailable long enough for the queue lease to
    // expire, the regular reaper marks the *same frozen run* failed with its
    // recovery marker. Keep this serial outbox responsible for re-entering it
    // promptly instead of waiting for the six-hour generation scheduler.
    const failedCandidates = await ctx.db
      .query("runs")
      .withIndex("by_owner_serialized_program_episode_retry", (q) =>
        q
          .eq("ownerId", args.ownerId)
          .eq("status", "failed")
          .lte("serializedProgramEpisodeRetryAt", args.now),
      )
      .take(25);
    const candidates = [...queuedCandidates, ...failedCandidates];
    const due: Array<{
      runId: typeof candidates[number]["_id"];
      channelId: typeof candidates[number]["channelId"];
      invocationSha256: string;
      retryAt: number;
      attempt: number;
      scheduledPlan?: {
        planItemId: string;
        topic: string;
        title: string;
        thumbnailKey: string;
        scheduledAt?: number;
      };
    }> = [];

    for (const run of candidates) {
      const retryAt = run.serializedProgramEpisodeRetryAt;
      const attempt = run.serializedProgramEpisodeRetryAttempts;
      if (
        typeof retryAt !== "number" ||
        !Number.isSafeInteger(retryAt) ||
        retryAt > args.now ||
        typeof attempt !== "number" ||
        !Number.isSafeInteger(attempt) ||
        attempt < 1 ||
        attempt > SERIALIZED_PROGRAM_EPISODE_BUSY_RETRY_MAX_ATTEMPTS ||
        (run.status === "failed" && run.leaseRecoveryPending !== true) ||
        typeof run.pipelineInvocationSha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(run.pipelineInvocationSha256) ||
        run.pipelineInvocationSnapshot === undefined
      ) {
        continue;
      }

      try {
        const invocation = normalizePipelineInvocationSnapshot(
          run.pipelineInvocationSnapshot as PipelineInvocationSnapshot,
        );
        if (
          invocation.ownerId !== args.ownerId ||
          invocation.runId !== String(run._id) ||
          invocation.channelId !== String(run.channelId) ||
          pipelineInvocationSha256(invocation) !== run.pipelineInvocationSha256
        ) {
          continue;
        }

        let scheduledPlan:
          | {
              planItemId: string;
              topic: string;
              title: string;
              thumbnailKey: string;
              scheduledAt?: number;
            }
          | undefined;
        if (run.planItemId) {
          const item = await ctx.db.get(run.planItemId);
          if (
            !item ||
            item.ownerId !== args.ownerId ||
            item.channelId !== run.channelId ||
            item.scheduledRunId !== run._id ||
            item.status !== "ready"
          ) {
            continue;
          }
          const frozenPlan = normalizeScheduledPlanPayload({
            planItemId: String(run.planItemId),
            topic: run.plannedTopic ?? "",
            title: run.plannedTitle ?? "",
            thumbnailKey: run.plannedThumbnailKey ?? "",
            ...(run.plannedPublishAt !== undefined ? { scheduledAt: run.plannedPublishAt } : {}),
          });
          const itemPlan = normalizeScheduledPlanPayload({
            planItemId: String(item._id),
            topic: item.topic,
            title: item.title ?? "",
            thumbnailKey: item.thumbnailKey ?? "",
            ...(item.scheduledAt !== undefined ? { scheduledAt: item.scheduledAt } : {}),
          });
          scheduledPlan = assertScheduledPlanPayloadMatches(frozenPlan, itemPlan);
        }

        due.push({
          runId: run._id,
          channelId: run.channelId,
          invocationSha256: run.pipelineInvocationSha256,
          retryAt,
          attempt,
          ...(scheduledPlan ? { scheduledPlan } : {}),
        });
      } catch {
        // A corrupt/mutated receipt is deliberately not dispatched. The row
        // remains observable for recovery rather than silently recompiling or
        // purchasing a new invocation from current channel state.
      }
    }
    return due;
  },
});

export const heartbeatExecutionLease = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    leaseOwner: v.string(),
    executionLeaseToken: v.number(),
    now: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "run execution lease heartbeat");
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`run not found: ${args.runId}`);
    if (run.ownerId !== args.ownerId || run.channelId !== args.channelId || !Number.isFinite(args.now)) {
      throw new Error("run heartbeat lease mismatch");
    }
    assertRunExecutionWriteFence(run, {
      leaseOwner: args.leaseOwner,
      executionLeaseToken: args.executionLeaseToken,
    }, args.now);
    const leaseExpiresAt = args.now + RUN_EXECUTION_LEASE_MS;
    await ctx.db.patch(args.runId, {
      heartbeatAt: args.now,
      leaseExpiresAt,
      ...clearRemoteChildWaitPatch(),
    });
    return leaseExpiresAt;
  },
});

/**
 * Advance the durable self-heal generation and invalidate every requested
 * stage in one transaction. The compare-and-advance guard makes a retried or
 * stale parent fail closed instead of minting a second repair generation.
 */
export const advanceSelfHealGeneration = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    leaseOwner: v.string(),
    executionLeaseToken: v.number(),
    expectedGeneration: v.number(),
    rerunBlocks: v.array(v.string()),
    reason: v.string(),
  },
  returns: v.object({ generation: v.number() }),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "self-heal generation advance");
    const now = Date.now();
    if (
      !Number.isSafeInteger(args.expectedGeneration) ||
      args.expectedGeneration < 0 ||
      args.expectedGeneration >= MAX_SELF_HEAL_GENERATION
    ) {
      throw new Error("self-heal generation advance is invalid or exhausted");
    }
    const rerunBlocks = [...new Set(args.rerunBlocks.map((block) => block.trim()))];
    const reason = args.reason.trim();
    if (
      rerunBlocks.length === 0 ||
      rerunBlocks.length > 100 ||
      rerunBlocks.some((block) => !block || block.length > 200) ||
      !reason ||
      reason.length > 1_000
    ) {
      throw new Error("self-heal stage request is invalid");
    }
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`run not found: ${args.runId}`);
    if (run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
      throw new Error("self-heal run ownership/channel mismatch");
    }
    assertRunExecutionWriteFence(run, {
      leaseOwner: args.leaseOwner,
      executionLeaseToken: args.executionLeaseToken,
    }, now);
    const generation = normalizeSelfHealGeneration(run.selfHealGeneration);
    if (generation !== args.expectedGeneration) {
      throw new Error("self-heal generation is stale");
    }
    const nextGeneration = generation + 1;
    const stages = await ctx.db
      .query("runStages")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    const stagesByBlock = new Map<string, typeof stages>();
    for (const stage of stages) {
      const blockStages = stagesByBlock.get(stage.block) ?? [];
      blockStages.push(stage);
      stagesByBlock.set(stage.block, blockStages);
    }
    const error = `superseded by self-heal #${nextGeneration}: ${reason}`;

    // Convex mutations are transactional: no observer can see h+1 unless all
    // requested stages are already superseded with the matching repair reason.
    await ctx.db.patch(args.runId, { selfHealGeneration: nextGeneration });
    for (const block of rerunBlocks) {
      const existing = stagesByBlock.get(block);
      if (existing?.length) {
        for (const stage of existing) {
          await ctx.db.patch(stage._id, { status: "superseded", error });
        }
      } else {
        await ctx.db.insert("runStages", {
          ownerId: args.ownerId,
          runId: args.runId,
          block,
          status: "superseded",
          finishedAt: now,
          cost: 0,
          error,
        });
      }
    }
    return { generation: nextGeneration };
  },
});

/**
 * Record one bounded remote-child wait before the parent suspends in
 * `triggerAndWait`. The exact dispatch key makes a late duplicate child fail
 * closed instead of attaching to a later self-heal of the same block.
 */
export const beginRemoteChildWait = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    leaseOwner: v.string(),
    executionLeaseToken: v.number(),
    blockId: v.string(),
    dispatchKey: v.string(),
    waitUntil: v.number(),
    deadline: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "remote child wait start");
    const now = Date.now();
    if (
      !args.blockId.trim() ||
      !args.dispatchKey.trim() ||
      args.dispatchKey.length > 500 ||
      !Number.isFinite(args.waitUntil) ||
      !Number.isFinite(args.deadline) ||
      args.waitUntil <= now ||
      args.deadline < args.waitUntil ||
      args.waitUntil > now + MAX_REMOTE_CHILD_WAIT_LEASE_MS ||
      args.deadline > now + MAX_REMOTE_CHILD_WAIT_LEASE_MS
    ) {
      throw new Error("remote child wait lease is outside its bounded window");
    }
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`run not found: ${args.runId}`);
    if (run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
      throw new Error("remote child wait ownership/channel mismatch");
    }
    assertRunExecutionWriteFence(run, {
      leaseOwner: args.leaseOwner,
      executionLeaseToken: args.executionLeaseToken,
    }, now);
    if (
      run.remoteChildWaitUntil !== undefined &&
      (
        run.remoteChildWaitLeaseOwner !== args.leaseOwner ||
        run.remoteChildWaitExecutionLeaseToken !== args.executionLeaseToken ||
        run.remoteChildWaitBlockId !== args.blockId ||
        run.remoteChildWaitDispatchKey !== args.dispatchKey
      )
    ) {
      throw new Error("another remote child wait is already active for this execution lease");
    }
    await ctx.db.patch(args.runId, {
      heartbeatAt: now,
      leaseExpiresAt: args.waitUntil,
      remoteChildWaitLeaseOwner: args.leaseOwner,
      remoteChildWaitExecutionLeaseToken: args.executionLeaseToken,
      remoteChildWaitBlockId: args.blockId,
      remoteChildWaitDispatchKey: args.dispatchKey,
      remoteChildWaitUntil: args.waitUntil,
      remoteChildWaitDeadline: args.deadline,
    });
    return args.waitUntil;
  },
});

/**
 * Child-side start fence. It is intentionally a mutation (rather than a
 * cached parent read) so the check is contemporaneous with the provider-free
 * child start. Paid work still requires the renewable fence below; this start
 * check intentionally does not turn a checkpointed child into a long static
 * lease.
 */
export const assertRemoteChildWaitLease = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    leaseOwner: v.string(),
    executionLeaseToken: v.number(),
    blockId: v.string(),
    dispatchKey: v.string(),
    now: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "remote child execution fence");
    if (!Number.isFinite(args.now) || !args.blockId.trim() || !args.dispatchKey.trim()) {
      throw new Error("remote child execution fence is invalid");
    }
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`run not found: ${args.runId}`);
    if (run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
      throw new Error("remote child execution ownership/channel mismatch");
    }
    assertRunExecutionWriteFence(run, {
      leaseOwner: args.leaseOwner,
      executionLeaseToken: args.executionLeaseToken,
    }, args.now);
    const remoteChildWaitUntil = run.remoteChildWaitUntil;
    const remoteChildWaitDeadline = run.remoteChildWaitDeadline;
    if (
      run.remoteChildWaitLeaseOwner !== args.leaseOwner ||
      run.remoteChildWaitExecutionLeaseToken !== args.executionLeaseToken ||
      run.remoteChildWaitBlockId !== args.blockId ||
      run.remoteChildWaitDispatchKey !== args.dispatchKey ||
      typeof remoteChildWaitUntil !== "number" ||
      !Number.isFinite(remoteChildWaitUntil) ||
      typeof remoteChildWaitDeadline !== "number" ||
      !Number.isFinite(remoteChildWaitDeadline) ||
      remoteChildWaitDeadline < remoteChildWaitUntil ||
      run.leaseExpiresAt !== remoteChildWaitUntil ||
      args.now >= remoteChildWaitUntil ||
      args.now >= remoteChildWaitDeadline
    ) {
      throw new Error("remote child execution fence is stale or lacks a live bounded work window");
    }
    return remoteChildWaitUntil;
  },
});

/**
 * Renewable child-side liveness fence. The receipt is intentionally short so
 * a dead Trigger child is reaped quickly, but a genuinely checkpointed Novita
 * controller can keep its exact generation alive while it polls a bounded
 * immutable worker. Provider starts require a full direct-worker window left
 * before the immutable dispatch deadline; polling may renew only the short
 * receipt and never extends that deadline.
 */
export const renewRemoteChildWaitLease = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    leaseOwner: v.string(),
    executionLeaseToken: v.number(),
    blockId: v.string(),
    dispatchKey: v.string(),
    purpose: v.union(v.literal("poll"), v.literal("provider")),
    now: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "remote child wait renewal");
    if (
      !Number.isFinite(args.now) ||
      !args.blockId.trim() ||
      !args.dispatchKey.trim()
    ) {
      throw new Error("remote child renewal fence is invalid");
    }
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`run not found: ${args.runId}`);
    if (run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
      throw new Error("remote child renewal ownership/channel mismatch");
    }
    assertRunExecutionWriteFence(run, {
      leaseOwner: args.leaseOwner,
      executionLeaseToken: args.executionLeaseToken,
    }, args.now);
    const remoteChildWaitUntil = run.remoteChildWaitUntil;
    const remoteChildWaitDeadline = run.remoteChildWaitDeadline;
    if (
      run.remoteChildWaitLeaseOwner !== args.leaseOwner ||
      run.remoteChildWaitExecutionLeaseToken !== args.executionLeaseToken ||
      run.remoteChildWaitBlockId !== args.blockId ||
      run.remoteChildWaitDispatchKey !== args.dispatchKey ||
      typeof remoteChildWaitUntil !== "number" ||
      !Number.isFinite(remoteChildWaitUntil) ||
      typeof remoteChildWaitDeadline !== "number" ||
      !Number.isFinite(remoteChildWaitDeadline) ||
      remoteChildWaitDeadline < remoteChildWaitUntil ||
      run.leaseExpiresAt !== remoteChildWaitUntil ||
      args.now >= remoteChildWaitDeadline
    ) {
      throw new Error("remote child renewal fence is stale or its bounded work deadline has elapsed");
    }
    if (args.purpose === "provider") {
      const providerWindowMs = renderChildProviderWorkWindowMs(
        renderBlockMachineClass(args.blockId),
      );
      if (args.now + providerWindowMs > remoteChildWaitDeadline) {
        throw new Error(
          "remote child renewal lacks a full bounded provider work window before its immutable deadline",
        );
      }
    }
    const nextWaitUntil = Math.min(
      remoteChildWaitDeadline,
      args.now + RENDER_CHILD_HEARTBEAT_LEASE_MS,
    );
    if (nextWaitUntil <= args.now) {
      throw new Error("remote child renewal has no remaining liveness window");
    }
    await ctx.db.patch(args.runId, {
      heartbeatAt: args.now,
      leaseExpiresAt: nextWaitUntil,
      remoteChildWaitUntil: nextWaitUntil,
    });
    return nextWaitUntil;
  },
});

/** Clear the one-shot recovery marker only after Trigger accepted dispatch. */
export const markLeaseRecoveryDispatched = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "run lease recovery dispatch");
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`run not found: ${args.runId}`);
    if (run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
      throw new Error("run recovery dispatch ownership/channel mismatch");
    }
    // The worker may claim immediately after Trigger accepts the request. Its
    // execution-lease claim already clears the marker, making this replay safe.
    if (run.status === "running" || run.leaseRecoveryPending !== true) return false;
    if (run.status !== "failed") {
      throw new Error(`run recovery dispatch cannot acknowledge ${run.status}`);
    }
    await ctx.db.patch(args.runId, { leaseRecoveryPending: undefined });
    return true;
  },
});

/** Indexed, provider-free safety net invoked by Convex cron. */
export const reapExpiredRunLeases = internalMutation({
  args: {},
  returns: v.object({ checked: v.number(), reaped: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    let checked = 0;
    let reaped = 0;
    for (const status of ["queued", "running"] as const) {
      // Deadline order is the fairness boundary: the previous startedAt scan
      // could spend every 100-row page on old-but-heartbeating workers and
      // never reach a newer row whose lease had actually expired.
      const dueCandidates = await ctx.db
        .query("runs")
        .withIndex("by_status_lease_expires_at", (q) =>
          q.eq("status", status).gt("leaseExpiresAt", undefined).lte("leaseExpiresAt", now),
        )
        .take(100);
      // Optional fields are ordered before timestamps in Convex. Read a
      // bounded legacy slice separately, materialize its deterministic
      // deadline, and then all future reaper passes use the fair index above.
      const legacyCandidates = await ctx.db
        .query("runs")
        .withIndex("by_status_lease_expires_at", (q) =>
          q.eq("status", status).eq("leaseExpiresAt", undefined),
        )
        .take(100);
      const candidates = [...dueCandidates, ...legacyCandidates];
      checked += candidates.length;
      for (const run of candidates) {
        if (run.leaseExpiresAt === undefined) {
          const inferredLeaseExpiry = effectiveRunLeaseExpiry(run);
          if (!isRunLeaseExpired(run, now)) {
            await ctx.db.patch(run._id, { leaseExpiresAt: inferredLeaseExpiry });
            continue;
          }
        }
        if (!isRunLeaseExpired(run, now)) continue;
        const fanoutQueueDeadline = liveBundleFanoutQueueDeadline(run, now);
        if (fanoutQueueDeadline !== undefined) {
          // Only an accepted fanout child gets this one bounded extension. It
          // may be serialized behind a live six-hour checkpointed remote job;
          // all ordinary queued rows still follow the generic stale-queue path.
          await ctx.db.patch(run._id, { leaseExpiresAt: fanoutQueueDeadline });
          continue;
        }
        const isFanoutReceipt = hasBundleFanoutReceipt(run);
        // A factual-review continuation carries its approval receipt only in
        // the dedicated outbox payload. If a worker dies after consuming that
        // receipt, reopening it as a generic scheduler recovery would reach
        // the review boundary without the envelope and terminalize a valid
        // approval. Requeue the exact signed receipt through its own bounded
        // outbox before applying generic lease-recovery semantics.
        if (
          run.factualReviewState === "resumed" ||
          run.factualReviewResumeState === "consumed"
        ) {
          const factualReviewRecovery = await requeueExpiredFactualReviewResumeForLease(ctx, {
            ownerId: run.ownerId,
            channelId: run.channelId,
            runId: run._id,
            now,
            reason: "factual review continuation worker lease expired; requeueing the exact approved continuation",
          });
          if (factualReviewRecovery !== "not_factual") {
            reaped++;
            continue;
          }
        }
        const recovery = expiredRunRecoveryDisposition(run);
        const priorRecoveryAttempts = Number.isSafeInteger(run.leaseRecoveryAttempts) &&
            (run.leaseRecoveryAttempts ?? 0) >= 0
          ? run.leaseRecoveryAttempts ?? 0
          : 0;
        const automaticRecoveryAllowed =
          !isFanoutReceipt &&
          recovery === "resume" &&
          priorRecoveryAttempts < MAX_AUTOMATIC_LEASE_RECOVERIES;
        const recoveryExhausted =
          !isFanoutReceipt && recovery === "resume" && !automaticRecoveryAllowed;
        const error =
          isFanoutReceipt
            ? run.bundleDispatchState === "enqueued"
              ? "bundle fanout accepted queue wait elapsed; manual reconciliation is required"
              : "bundle fanout dispatch receipt lease elapsed; manual reconciliation is required"
            : automaticRecoveryAllowed
              ? "run execution lease expired without a heartbeat; resuming the exact durable invocation"
              : recoveryExhausted
                ? `run execution lease expired after ${MAX_AUTOMATIC_LEASE_RECOVERIES} automatic same-run recoveries; manual reconciliation is required`
                : status === "queued"
                  ? "run lease expired before a worker claimed it; a fresh run will be admitted"
                  : "run execution lease expired before its invocation was frozen; a fresh run will be admitted";
        await ctx.db.patch(
          run._id,
          isFanoutReceipt
            ? bundleFanoutTerminalPatch(now, error)
            : {
                status: "failed",
                finishedAt: now,
                heartbeatAt: now,
                leaseExpiresAt: undefined,
                leaseOwner: undefined,
                error,
                leaseRecoveryPending: automaticRecoveryAllowed ? true : undefined,
                ...(automaticRecoveryAllowed
                  ? { leaseRecoveryAttempts: priorRecoveryAttempts + 1 }
                  : {}),
                ...clearRemoteChildWaitPatch(),
              },
        );
        if (run.planItemId) {
          const item = await ctx.db.get(run.planItemId);
          if (
            item &&
            item.status !== "used" &&
            item.ownerId === run.ownerId &&
            item.channelId === run.channelId &&
            item.scheduledRunId === run._id
          ) {
            await ctx.db.patch(run.planItemId, {
              scheduledFailure: error,
              ...(recovery === "replace"
                ? {
                    scheduledRunId: undefined,
                    scheduledClaimedAt: undefined,
                  }
                : {}),
            });
          }
        }
        reaped++;
      }
    }
    return { checked, reaped };
  },
});

/**
 * Atomically installs the exact pre-provider invocation once. A replay may
 * only present the byte-equivalent normalized snapshot. Legacy runs with any
 * execution evidence fail closed because their original inputs are unknowable.
 */
export const claimProbeDispatchEnvelope = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    envelope: v.any(),
    fingerprint: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`run not found: ${args.runId}`);
    if (
      run.ownerId !== args.ownerId ||
      run.channelId !== args.channelId ||
      ["ok", "failed", "canceled"].includes(run.status)
    ) {
      throw new Error("probe dispatch run identity/status mismatch");
    }
    if (!/^[a-f0-9]{64}$/.test(args.fingerprint)) {
      throw new Error("probe dispatch envelope fingerprint is invalid");
    }
    const envelope = args.envelope as ChannelInceptionProbeAttemptCheckpoint;
    assertChannelInceptionProbeEnvelopeStructure(envelope);
    if (
      envelope.ownerId !== args.ownerId ||
      envelope.channelId !== String(args.channelId) ||
      envelope.runId !== String(args.runId) ||
      envelope.dispatchEnvelopeFingerprint !== args.fingerprint
    ) {
      throw new Error("probe dispatch envelope is not bound to its durable run");
    }
    const encoded = JSON.stringify(envelope);
    if (encoded.length > 250_000) {
      throw new Error("probe dispatch envelope exceeds 250000 characters");
    }
    const existingEnvelope = run.probeDispatchEnvelope as
      | ChannelInceptionProbeAttemptCheckpoint
      | undefined;
    const existingFingerprint = run.probeDispatchEnvelopeFingerprint;
    if ((existingEnvelope === undefined) !== (existingFingerprint === undefined)) {
      throw new Error("probe dispatch envelope/fingerprint pair is incomplete");
    }
    if (existingEnvelope) {
      assertChannelInceptionProbeEnvelopeStructure(existingEnvelope);
      if (
        existingFingerprint !== args.fingerprint ||
        existingEnvelope.dispatchEnvelopeFingerprint !== args.fingerprint
      ) {
        throw new Error("probe dispatch envelope is immutable");
      }
      return {
        envelope: existingEnvelope,
        fingerprint: existingFingerprint,
        claimedAt: run.probeDispatchClaimedAt,
        reused: true,
      };
    }
    const claimedAt = Date.now();
    await ctx.db.patch(args.runId, {
      probeDispatchEnvelope: envelope,
      probeDispatchEnvelopeFingerprint: args.fingerprint,
      probeDispatchClaimedAt: claimedAt,
    });
    return {
      envelope,
      fingerprint: args.fingerprint,
      claimedAt,
      reused: false,
    };
  },
});

export const claimInvocationSnapshot = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    leaseOwner: v.string(),
    executionLeaseToken: v.number(),
    snapshot: v.any(),
    sha256: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    // This receipt becomes the sole source of pipeline inputs on retries.
    // Owner sessions may create a run, but only the server-side Trigger path
    // may seal the pre-provider invocation that a retry will execute.
    await requireStudioServiceIdentity(
      ctx,
      args.ownerId,
      "pipeline invocation snapshot claim",
    );
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`run not found: ${args.runId}`);
    if (run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
      throw new Error("pipeline invocation snapshot ownership/channel mismatch");
    }
    assertOptionalRunExecutionWriteFence(
      run,
      args.leaseOwner,
      args.executionLeaseToken,
      "run completion",
    );
    if (
      (run.pipelineInvocationSnapshot === undefined) !==
      (run.pipelineInvocationSha256 === undefined)
    ) {
      throw new Error("pipeline invocation snapshot/hash pair is incomplete");
    }
    let hasExecutionHistory =
      run.status === "failed" ||
      run.finishedAt !== undefined ||
      run.error !== undefined ||
      run.pipelineInvocationSha256 !== undefined ||
      run.pipelineFingerprint !== undefined ||
      run.videoAssetId !== undefined ||
      run.youtubeVideoId !== undefined;
    if (!hasExecutionHistory && run.pipelineInvocationSnapshot === undefined) {
      hasExecutionHistory = (await ctx.db
        .query("runStages")
        .withIndex("by_run", (q) => q.eq("runId", args.runId))
        .take(1)).length > 0;
    }
    const decision = decidePipelineInvocationClaim({
      run: {
        ownerId: run.ownerId,
        channelId: String(run.channelId),
        runId: String(run._id),
        status: run.status,
        snapshot: run.pipelineInvocationSnapshot as PipelineInvocationSnapshot | undefined,
        sha256: run.pipelineInvocationSha256,
        hasExecutionHistory,
      },
      ownerId: args.ownerId,
      channelId: String(args.channelId),
      runId: String(args.runId),
      snapshot: args.snapshot as PipelineInvocationSnapshot,
      sha256: args.sha256,
    });
    const incoming = normalizePipelineInvocationSnapshot(decision.snapshot);
    if (decision.kind === "reused") {
      return {
        snapshot: incoming,
        sha256: decision.sha256,
        claimedAt: run.pipelineInvocationClaimedAt,
        reused: true,
      };
    }
    const claimedAt = Date.now();
    await ctx.db.patch(args.runId, {
      pipelineInvocationSnapshot: incoming,
      pipelineInvocationSha256: args.sha256,
      pipelineInvocationClaimedAt: claimedAt,
      pipelinePolicyId: incoming.compilationPolicyId,
      pipelinePolicyVersion: incoming.compilationPolicyVersion,
      pipelineFingerprint: incoming.compilationFingerprint,
      pipelineModules: incoming.compilationModules,
      pipelineCapabilities: incoming.compilationCapabilities,
      reservedMaxCostUsd: incoming.reservedMaxCostUsd,
      pipelineCompiledAt: claimedAt,
    });
    return {
      snapshot: incoming,
      sha256: args.sha256,
      claimedAt,
      reused: false,
    };
  },
});

/**
 * Atomically records the post-upload continuation before any Trigger enqueue.
 * This is the outbox write that makes an enqueue outage recoverable.
 */
export const preparePublishContinuation = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    leaseOwner: v.optional(v.string()),
    executionLeaseToken: v.optional(v.number()),
    externalUploadedFailedRunHandoff: v.optional(v.literal("uploaded_failed_run")),
    intentId: v.id("publishIntents"),
    artifactId: v.string(),
    youtubeVideoId: v.string(),
    preparedAt: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "publish continuation preparation");
    if (!args.youtubeVideoId.trim() || !Number.isFinite(args.preparedAt) || args.preparedAt < 0) {
      throw new Error("publish continuation upload identity/timestamp is invalid");
    }
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`publish continuation run not found: ${args.runId}`);
    if (run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
      throw new Error("publish continuation run ownership/channel mismatch");
    }
    // A completed matching receipt is a no-op even when a late scheduler or
    // stale worker arrives after the resumed run finished. It cannot reopen or
    // mutate the run, so it does not need a lease merely to observe idempotency.
    if (
      run.publishContinuationState === "completed" &&
      run.publishContinuationIntentId === args.intentId &&
      run.publishContinuationArtifactId === args.artifactId &&
      run.publishContinuationVideoId === args.youtubeVideoId &&
      run.youtubeVideoId === args.youtubeVideoId
    ) {
      return run;
    }
    // Exhausted continuations are explicit operator work. A late immediate
    // handoff may observe the exact receipt, but cannot silently revive it.
    if (
      run.publishContinuationState === "manual_recovery_required" &&
      run.publishContinuationIntentId === args.intentId &&
      run.publishContinuationArtifactId === args.artifactId &&
      run.publishContinuationVideoId === args.youtubeVideoId &&
      run.youtubeVideoId === args.youtubeVideoId
    ) {
      return run;
    }
    assertPublishContinuationHandoffFence(
      run,
      args.leaseOwner,
      args.executionLeaseToken,
      args.externalUploadedFailedRunHandoff,
      "publish continuation upload handoff",
    );
    await requireExactBoundPublishIntent(ctx, run, {
      intentId: args.intentId,
      artifactId: args.artifactId,
      youtubeVideoId: args.youtubeVideoId,
      requireUploaded: true,
    });
    if (run.youtubeVideoId !== undefined && run.youtubeVideoId !== args.youtubeVideoId) {
      throw new Error("publish continuation run YouTube video conflict");
    }
    if (
      run.publishContinuationIntentId !== undefined &&
      run.publishContinuationIntentId !== args.intentId
    ) {
      throw new Error("publish continuation outbox intent conflict");
    }
    if (
      run.publishContinuationArtifactId !== undefined &&
      run.publishContinuationArtifactId !== args.artifactId
    ) {
      throw new Error("publish continuation outbox artifact conflict");
    }
    if (
      run.publishContinuationVideoId !== undefined &&
      run.publishContinuationVideoId !== args.youtubeVideoId
    ) {
      throw new Error("publish continuation outbox video conflict");
    }
    await ctx.db.patch(args.runId, {
      youtubeVideoId: args.youtubeVideoId,
      publishContinuationState:
        run.publishContinuationState === "queued" ? "queued" : "pending",
      publishContinuationIntentId: args.intentId,
      publishContinuationArtifactId: args.artifactId,
      publishContinuationVideoId: args.youtubeVideoId,
      publishContinuationAttempts: run.publishContinuationAttempts ?? 0,
      publishContinuationUpdatedAt: args.preparedAt,
    });
    return await ctx.db.get(args.runId);
  },
});

export const markPublishContinuationQueued = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    leaseOwner: v.optional(v.string()),
    executionLeaseToken: v.optional(v.number()),
    externalUploadedFailedRunHandoff: v.optional(v.literal("uploaded_failed_run")),
    intentId: v.id("publishIntents"),
    artifactId: v.string(),
    youtubeVideoId: v.string(),
    triggerRunId: v.string(),
    queuedAt: v.number(),
    enqueueAttempt: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "publish continuation queue receipt");
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`publish continuation run not found: ${args.runId}`);
    if (run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
      throw new Error("publish continuation queue ownership/channel mismatch");
    }
    // See preparePublishContinuation: this completed receipt is immutable and
    // must remain idempotent for a late external queue acknowledgement.
    if (
      run.publishContinuationState === "completed" &&
      run.publishContinuationIntentId === args.intentId &&
      run.publishContinuationArtifactId === args.artifactId &&
      run.publishContinuationVideoId === args.youtubeVideoId
    ) {
      return run;
    }
    assertPublishContinuationHandoffFence(
      run,
      args.leaseOwner,
      args.executionLeaseToken,
      args.externalUploadedFailedRunHandoff,
      "publish continuation queue receipt",
    );
    await requireExactBoundPublishIntent(ctx, run, {
      intentId: args.intentId,
      artifactId: args.artifactId,
      youtubeVideoId: args.youtubeVideoId,
      requireUploaded: true,
    });
    if (
      run.publishContinuationIntentId !== args.intentId ||
      run.publishContinuationArtifactId !== args.artifactId ||
      run.publishContinuationVideoId !== args.youtubeVideoId ||
      run.youtubeVideoId !== args.youtubeVideoId
    ) {
      throw new Error("publish continuation queue outbox identity/state mismatch");
    }
    if (
      !args.triggerRunId.trim() ||
      !Number.isSafeInteger(args.queuedAt) ||
      args.queuedAt < 0
    ) {
      throw new Error("publish continuation queue receipt is invalid");
    }
    const attempts = publishContinuationAttemptCount(run.publishContinuationAttempts);
    if (!Number.isSafeInteger(args.enqueueAttempt) || args.enqueueAttempt < 1) {
      throw new Error("publish continuation queue receipt attempt is invalid");
    }
    // A finished/manual receipt and any acknowledgement for an already
    // recorded attempt are immutable. This is the stale-ack fence after an
    // expired queue delivery is reissued with a newer Trigger key.
    if (
      run.publishContinuationState === "manual_recovery_required" ||
      args.enqueueAttempt <= attempts
    ) {
      return run;
    }
    if (run.publishContinuationState !== "pending") {
      throw new Error("publish continuation queue outbox is not pending");
    }
    if (args.enqueueAttempt !== attempts + 1) {
      throw new Error("publish continuation queue receipt skipped a bounded delivery attempt");
    }
    if (args.enqueueAttempt > MAX_PUBLISH_CONTINUATION_ENQUEUE_ATTEMPTS) {
      await ctx.db.patch(
        args.runId,
        publishContinuationManualRecoveryPatch(
          args.queuedAt,
          `publish continuation exceeded ${MAX_PUBLISH_CONTINUATION_ENQUEUE_ATTEMPTS} bounded delivery attempts before queue acknowledgement`,
        ),
      );
      return await ctx.db.get(args.runId);
    }
    const queueDeadlineAt = args.queuedAt + PUBLISH_CONTINUATION_QUEUE_LEASE_MS;
    if (!Number.isSafeInteger(queueDeadlineAt)) {
      throw new Error("publish continuation queue deadline is invalid");
    }
    await ctx.db.patch(args.runId, {
      publishContinuationState: "queued",
      publishContinuationAttempts: args.enqueueAttempt,
      publishContinuationUpdatedAt: args.queuedAt,
      publishContinuationQueuedAt: args.queuedAt,
      publishContinuationQueueDeadlineAt: queueDeadlineAt,
      publishContinuationTriggerRunId: args.triggerRunId,
      publishContinuationLastError: undefined,
    });
    return await ctx.db.get(args.runId);
  },
});

export const recordPublishContinuationEnqueueFailure = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    leaseOwner: v.optional(v.string()),
    executionLeaseToken: v.optional(v.number()),
    externalUploadedFailedRunHandoff: v.optional(v.literal("uploaded_failed_run")),
    intentId: v.id("publishIntents"),
    artifactId: v.string(),
    youtubeVideoId: v.string(),
    error: v.string(),
    failedAt: v.number(),
    enqueueAttempt: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "publish continuation enqueue failure");
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`publish continuation run not found: ${args.runId}`);
    if (run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
      throw new Error("publish continuation failure ownership/channel mismatch");
    }
    // A post-completion failure acknowledgement must be a strict no-op, not a
    // reason for a late worker to need (or bypass) the retired execution lease.
    if (run.publishContinuationState === "completed") {
      if (
        run.publishContinuationIntentId !== args.intentId ||
        run.publishContinuationArtifactId !== args.artifactId ||
        run.publishContinuationVideoId !== args.youtubeVideoId
      ) {
        throw new Error("completed publish continuation failure identity mismatch");
      }
      return run;
    }
    assertPublishContinuationHandoffFence(
      run,
      args.leaseOwner,
      args.executionLeaseToken,
      args.externalUploadedFailedRunHandoff,
      "publish continuation enqueue failure",
    );
    await requireExactBoundPublishIntent(ctx, run, {
      intentId: args.intentId,
      artifactId: args.artifactId,
      youtubeVideoId: args.youtubeVideoId,
      requireUploaded: true,
    });
    if (
      run.publishContinuationIntentId !== args.intentId ||
      run.publishContinuationArtifactId !== args.artifactId ||
      run.publishContinuationVideoId !== args.youtubeVideoId ||
      run.youtubeVideoId !== args.youtubeVideoId
    ) {
      throw new Error("publish continuation failure outbox identity mismatch");
    }
    if (!Number.isSafeInteger(args.failedAt) || args.failedAt < 0) {
      throw new Error("publish continuation failure timestamp is invalid");
    }
    const attempts = publishContinuationAttemptCount(run.publishContinuationAttempts);
    if (!Number.isSafeInteger(args.enqueueAttempt) || args.enqueueAttempt < 1) {
      throw new Error("publish continuation failure attempt is invalid");
    }
    // Once Trigger accepted a delivery (or a newer recovery already recorded
    // its count), an ambiguous old failure cannot regress that receipt to
    // pending. It remains observable for the queue lease scanner instead.
    if (
      run.publishContinuationState === "manual_recovery_required" ||
      run.publishContinuationState === "queued" ||
      args.enqueueAttempt <= attempts
    ) {
      return run;
    }
    if (run.publishContinuationState !== "pending") {
      throw new Error("publish continuation failure outbox is not pending");
    }
    if (args.enqueueAttempt !== attempts + 1) {
      throw new Error("publish continuation failure skipped a bounded delivery attempt");
    }
    if (args.enqueueAttempt >= MAX_PUBLISH_CONTINUATION_ENQUEUE_ATTEMPTS) {
      await ctx.db.patch(
        args.runId,
        publishContinuationManualRecoveryPatch(
          args.failedAt,
          `publish continuation could not be enqueued after ${args.enqueueAttempt} bounded attempt(s): ${args.error}`,
        ),
      );
      return await ctx.db.get(args.runId);
    }
    await ctx.db.patch(args.runId, {
      publishContinuationState: "pending",
      publishContinuationAttempts: args.enqueueAttempt,
      publishContinuationUpdatedAt: args.failedAt,
      publishContinuationQueuedAt: undefined,
      publishContinuationQueueDeadlineAt: undefined,
      publishContinuationTriggerRunId: undefined,
      publishContinuationLastError: args.error.slice(0, 1_000),
    });
    return await ctx.db.get(args.runId);
  },
});

/**
 * Recover a Trigger delivery that was accepted but never claimed its failed
 * pipeline run. This touches only the durable uploaded-intent outbox and is
 * guarded by the same no-lease external-handoff fence as the initial upload
 * scheduler path; it cannot reopen a live/recovering execution generation.
 */
export const reapExpiredQueuedPublishContinuations = mutation({
  args: {
    ownerId: v.string(),
    now: v.number(),
    limit: v.optional(v.number()),
  },
  returns: v.object({ checked: v.number(), requeued: v.number(), blocked: v.number() }),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "publish continuation queued recovery");
    if (!Number.isSafeInteger(args.now) || args.now < 0) {
      throw new Error("publish continuation queued recovery time is invalid");
    }
    const limit = Math.max(1, Math.min(50, Math.floor(args.limit ?? 25)));
    // New receipts are fair by explicit deadline. A bounded legacy slice keeps
    // queue acknowledgements written before the deadline column recoverable.
    const [due, legacy] = await Promise.all([
      ctx.db
        .query("runs")
        .withIndex("by_owner_publish_continuation_queue_deadline", (q) =>
          q
            .eq("ownerId", args.ownerId)
            .eq("publishContinuationState", "queued")
            .gt("publishContinuationQueueDeadlineAt", undefined)
            .lte("publishContinuationQueueDeadlineAt", args.now),
        )
        .take(limit),
      ctx.db
        .query("runs")
        .withIndex("by_owner_publish_continuation_queue_deadline", (q) =>
          q
            .eq("ownerId", args.ownerId)
            .eq("publishContinuationState", "queued")
            .eq("publishContinuationQueueDeadlineAt", undefined),
        )
        .take(limit),
    ]);
    let checked = 0;
    let requeued = 0;
    let blocked = 0;
    const seen = new Set<string>();
    for (const run of [...due, ...legacy]) {
      if (seen.has(String(run._id))) continue;
      seen.add(String(run._id));
      checked++;

      // A Trigger delivery can race the scanner by claiming its run. Treat the
      // active/recovering case as ownership by that worker, never as evidence
      // to overwrite a receipt from the lease-free external exception path.
      try {
        assertPublishContinuationHandoffFence(
          run,
          undefined,
          undefined,
          "uploaded_failed_run",
          "publish continuation queued recovery",
        );
      } catch {
        continue;
      }

      const deadline = publishContinuationQueueDeadline(run);
      if (deadline === undefined) {
        await ctx.db.patch(
          run._id,
          publishContinuationManualRecoveryPatch(
            args.now,
            "publish continuation queued receipt is missing its bounded dispatch deadline; manual reconciliation is required",
          ),
        );
        blocked++;
        continue;
      }
      if (deadline > args.now) {
        // Backfill only the derived legacy deadline. Future scans can then use
        // the deadline index instead of repeatedly spending the legacy slice.
        if (run.publishContinuationQueueDeadlineAt === undefined) {
          await ctx.db.patch(run._id, { publishContinuationQueueDeadlineAt: deadline });
        }
        continue;
      }

      let attempts: number;
      try {
        attempts = publishContinuationAttemptCount(run.publishContinuationAttempts);
      } catch {
        await ctx.db.patch(
          run._id,
          publishContinuationManualRecoveryPatch(
            args.now,
            "publish continuation queued receipt has an invalid bounded delivery count; manual reconciliation is required",
          ),
        );
        blocked++;
        continue;
      }
      if (attempts < 1) {
        await ctx.db.patch(
          run._id,
          publishContinuationManualRecoveryPatch(
            args.now,
            "publish continuation queued receipt has no acknowledged delivery attempt; manual reconciliation is required",
          ),
        );
        blocked++;
        continue;
      }
      if (attempts >= MAX_PUBLISH_CONTINUATION_ENQUEUE_ATTEMPTS) {
        await ctx.db.patch(
          run._id,
          publishContinuationManualRecoveryPatch(
            args.now,
            `publish continuation did not start after ${attempts} bounded delivery attempt(s); manual reconciliation is required`,
          ),
        );
        blocked++;
        continue;
      }
      if (
        !run.blockedPublishIntentId ||
        !run.blockedPublishArtifactId ||
        !run.publishContinuationIntentId ||
        !run.publishContinuationArtifactId ||
        !run.publishContinuationVideoId ||
        run.publishContinuationIntentId !== run.blockedPublishIntentId ||
        run.publishContinuationArtifactId !== run.blockedPublishArtifactId ||
        run.publishContinuationVideoId !== run.youtubeVideoId
      ) {
        await ctx.db.patch(
          run._id,
          publishContinuationManualRecoveryPatch(
            args.now,
            "publish continuation queued receipt is missing its immutable uploaded-intent fence; manual reconciliation is required",
          ),
        );
        blocked++;
        continue;
      }
      try {
        await requireExactBoundPublishIntent(ctx, run, {
          intentId: run.publishContinuationIntentId,
          artifactId: run.publishContinuationArtifactId,
          youtubeVideoId: run.publishContinuationVideoId,
          requireUploaded: true,
        });
      } catch (error) {
        await ctx.db.patch(
          run._id,
          publishContinuationManualRecoveryPatch(
            args.now,
            `publish continuation queued receipt cannot reissue its immutable uploaded intent: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
        blocked++;
        continue;
      }
      await ctx.db.patch(run._id, {
        publishContinuationState: "pending",
        publishContinuationUpdatedAt: args.now,
        publishContinuationQueuedAt: undefined,
        publishContinuationQueueDeadlineAt: undefined,
        publishContinuationTriggerRunId: undefined,
        publishContinuationLastError:
          "publish continuation accepted Trigger delivery expired before execution claim; reissuing the exact immutable uploaded intent",
        heartbeatAt: args.now,
      });
      requeued++;
    }
    return { checked, requeued, blocked };
  },
});

/** Bounded low-frequency outbox read for the Pipeline Doctor. */
export const listPendingPublishContinuations = query({
  args: {
    ownerId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 25)));
    const rows = await ctx.db
      .query("runs")
      .withIndex("by_owner_publish_continuation", (q) =>
        q.eq("ownerId", args.ownerId).eq("publishContinuationState", "pending"),
      )
      .take(limit);
    return rows.filter((run) => run.status === "failed");
  },
});

/** Complete a non-scheduled run and its exact publish fence atomically. */
export const completeRun = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    leaseOwner: v.optional(v.string()),
    executionLeaseToken: v.optional(v.number()),
    finishedAt: v.number(),
    costTotal: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.leaseOwner !== undefined || args.executionLeaseToken !== undefined) {
      await requireStudioServiceIdentity(ctx, args.ownerId, "execution-fenced run completion");
    }
    if (!Number.isFinite(args.finishedAt) || !Number.isFinite(args.costTotal) || args.costTotal < 0) {
      throw new Error("run completion values are invalid");
    }
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`run not found: ${args.runId}`);
    if (run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
      throw new Error("run completion ownership/channel mismatch");
    }
    assertOptionalRunExecutionWriteFence(
      run,
      args.leaseOwner,
      args.executionLeaseToken,
      "run completion",
    );
    const continuationPatch = await completedPublishContinuationPatch(
      ctx,
      run,
      args.finishedAt,
    );
    await ctx.db.patch(args.runId, {
      status: "ok",
      finishedAt: args.finishedAt,
      costTotal: args.costTotal,
      error: undefined,
      heartbeatAt: args.finishedAt,
      leaseExpiresAt: undefined,
      leaseOwner: undefined,
      leaseRecoveryPending: undefined,
      ...clearRemoteChildWaitPatch(),
      ...continuationPatch,
    });
    return null;
  },
});

export const updateRun = mutation({
  args: {
    runId: v.id("runs"),
    status: v.optional(v.string()),
    finishedAt: v.optional(v.number()),
    costTotal: v.optional(v.number()),
    error: v.optional(v.string()),
    videoAssetId: v.optional(v.id("assets")),
    youtubeVideoId: v.optional(v.string()),
    pipelinePolicyId: v.optional(v.string()),
    pipelinePolicyVersion: v.optional(v.string()),
    pipelineFingerprint: v.optional(v.string()),
    pipelineModules: v.optional(v.any()),
    pipelineCapabilities: v.optional(v.array(v.string())),
    reservedMaxCostUsd: v.optional(v.number()),
    pipelineCompiledAt: v.optional(v.number()),
    // Legacy/operator calls may omit both fields. New Trigger worker writes
    // always provide the pair and are rejected after lease recovery.
    leaseOwner: v.optional(v.string()),
    executionLeaseToken: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { runId, leaseOwner, executionLeaseToken, ...rest } = args;
    const existing = await ctx.db.get(runId);
    if (!existing) throw new Error(`run not found: ${runId}`);
    if (leaseOwner !== undefined || executionLeaseToken !== undefined) {
      await requireStudioServiceIdentity(ctx, existing.ownerId, "execution-fenced run update");
    }
    assertOptionalRunExecutionWriteFence(
      existing,
      leaseOwner,
      executionLeaseToken,
      "run update",
    );
    const patch: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(rest)) {
      if (val !== undefined) patch[k] = val;
    }
    if (rest.status && ["ok", "failed", "canceled"].includes(rest.status)) {
      patch.heartbeatAt = rest.finishedAt ?? Date.now();
      patch.leaseExpiresAt = undefined;
      patch.leaseOwner = undefined;
      patch.leaseRecoveryPending = undefined;
      Object.assign(patch, clearRemoteChildWaitPatch());
    }
    await ctx.db.patch(runId, patch);
    return null;
  },
});

export const getRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    return run ? withReleaseEvidenceStatus(run) : null;
  },
});

/**
 * Browser-sized live-run projection. Worker callers retain `getRun`, which
 * needs the complete immutable invocation for recovery; the Studio surface
 * receives only the verified block order required to track progress.
 */
export const getRunPresentation = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    const release = withReleaseEvidenceStatus(run);
    return {
      _id: run._id,
      channelId: run.channelId,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      costTotal: run.costTotal,
      error: run.error,
      videoAssetId: run.videoAssetId,
      youtubeVideoId: run.youtubeVideoId,
      releaseEvidenceStatus: release.releaseEvidenceStatus,
      pipeline: frozenRunPipelinePresentation({
        snapshot: run.pipelineInvocationSnapshot,
        sha256: run.pipelineInvocationSha256,
      }),
    };
  },
});

export const listRunsByChannel = query({
  args: { channelId: v.id("channels"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = validatedReadLimit(args.limit, RUNS_BY_CHANNEL_LIMIT);
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .order("desc")
      .take(limit);
    return runs.map(withReleaseEvidenceStatus);
  },
});

/** Cursor-paginated, startedAt-indexed history for workers that truly need it. */
export const listRunsByChannelSincePage = query({
  args: {
    channelId: v.id("channels"),
    startedAfter: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.startedAfter) || args.startedAfter < 0) {
      throw new Error("run history start must be a non-negative timestamp");
    }
    validatedReadLimit(args.paginationOpts.numItems, RUN_HISTORY_PAGE_LIMIT);
    const page = await ctx.db
      .query("runs")
      .withIndex("by_channel_started", (q) =>
        q.eq("channelId", args.channelId).gte("startedAt", args.startedAfter),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return { ...page, page: page.page.map(withReleaseEvidenceStatus) };
  },
});

/**
 * Active runs (queued|running) for an owner, newest first, enriched with the
 * channel name/slug — mirrors listRecent's enrichment. Powers the Overview
 * "Active runs" board.
 */
export const listActive = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    // Bounded window instead of a full-table collect: active runs are always
    // recent, so the newest 200 (index desc ≈ startedAt desc) covers them.
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .order("desc")
      .take(200);
    const now = Date.now();
    const active = runs.filter(
      (r) =>
        (r.status === "queued" || r.status === "running") &&
        !isRunLeaseExpired(r, now),
    );
    active.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    return await Promise.all(
      active.map(async (run) => {
        const channel = await ctx.db.get(run.channelId);
        return {
          _id: run._id,
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          costTotal: run.costTotal,
          youtubeVideoId: run.youtubeVideoId,
          error: run.error,
          releaseEvidenceStatus: normalizeReleaseEvidenceStatus(run.releaseEvidenceStatus),
          releaseEvidenceCertificateFingerprint: run.releaseEvidenceCertificateFingerprint,
          releaseEvidenceCertificateKey: run.releaseEvidenceCertificateKey,
          releaseEvidenceUpdatedAt: run.releaseEvidenceUpdatedAt,
          heartbeatAt: run.heartbeatAt,
          leaseExpiresAt: run.leaseExpiresAt,
          channelName: channel?.name ?? "(unknown)",
          channelSlug: channel?.slug ?? "",
        };
      }),
    );
  },
});

/**
 * Repoint all runs of one channel onto another. Used by the dedupe-channels
 * maintenance script to migrate runs off duplicate channel docs before they
 * are deleted. Idempotent: re-running with no matching runs is a no-op.
 */
export const repointChannel = mutation({
  args: {
    fromChannelId: v.id("channels"),
    toChannelId: v.id("channels"),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_channel", (q) => q.eq("channelId", args.fromChannelId))
      .collect();
    for (const run of runs) {
      await ctx.db.patch(run._id, { channelId: args.toChannelId });
    }
    return runs.length;
  },
});

/**
 * Recent runs for an owner, newest first, enriched with the channel name.
 * Powers the minimal dashboard page (read-only).
 */
export const listRecent = query({
  args: { ownerId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = validatedReadLimit(args.limit, RECENT_RUNS_LIMIT);
    // Index desc ≈ startedAt desc (startedAt is stamped at insert) — take the
    // page directly instead of collecting every owner run then slicing.
    const limited = await ctx.db
      .query("runs")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .order("desc")
      .take(limit);
    limited.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    return await Promise.all(
      limited.map(async (run) => {
        const channel = await ctx.db.get(run.channelId);
        return {
          _id: run._id,
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          costTotal: run.costTotal,
          youtubeVideoId: run.youtubeVideoId,
          error: run.error,
          releaseEvidenceStatus: normalizeReleaseEvidenceStatus(run.releaseEvidenceStatus),
          releaseEvidenceCertificateFingerprint: run.releaseEvidenceCertificateFingerprint,
          releaseEvidenceCertificateKey: run.releaseEvidenceCertificateKey,
          releaseEvidenceUpdatedAt: run.releaseEvidenceUpdatedAt,
          channelName: channel?.name ?? "(unknown)",
          channelSlug: channel?.slug ?? "",
        };
      }),
    );
  },
});
