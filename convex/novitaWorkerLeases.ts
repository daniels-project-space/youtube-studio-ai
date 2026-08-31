import { v } from "convex/values";
import { mutation, query } from "./studioFunctions";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { assertRunExecutionWriteFence, isRunLeaseExpired } from "../src/lib/runLease";
import { renderChildProviderWorkWindowMs } from "../src/lib/renderChildLease";
import { renderBlockMachineClass } from "../src/lib/pipelineInvocationSnapshot";

/**
 * A disposable Novita worker is a billing-bearing resource, not merely a
 * background job.  This module deliberately keeps its lifecycle small,
 * explicit, and durable so a Trigger retry can reconcile it without creating
 * a second GPU or treating an unverified stop as a successful close.
 */

const MANAGED_WORKER_NAME = /^yt-render-4090-[a-z0-9][a-z0-9-]{0,120}$/;
const SHA_256 = /^[a-f0-9]{64}$/;
const PINNED_IMAGE = /^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/i;
const INSTANCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,255}$/;
const CREATE_ATTEMPT_TOKEN = /^[a-f0-9-]{16,80}$/i;

// The owning Trigger render task has a 90-minute ceiling.  The lease allows a
// little cleanup headroom but cannot be extended indefinitely by retries.
const MAX_WORKER_LIFETIME_MS = 2 * 60 * 60_000;
const MAX_BOOT_WINDOW_MS = 20 * 60_000;
const MAX_REAP_CANDIDATES = 32;
const MAX_SCAN_PER_STATE = 64;

const leaseStatus = v.union(
  v.literal("requested"),
  v.literal("create_claimed"),
  v.literal("create_dispatched"),
  v.literal("provisioning"),
  v.literal("booting"),
  v.literal("rendering"),
  v.literal("draining"),
  v.literal("delete_requested"),
  v.literal("deleted_verified"),
  v.literal("failed"),
  v.literal("deletion_unverified"),
);

const heartbeatStatus = v.union(
  v.literal("booting"),
  v.literal("rendering"),
  v.literal("draining"),
);

type LeaseStatus =
  | "requested"
  | "create_claimed"
  | "create_dispatched"
  | "provisioning"
  | "booting"
  | "rendering"
  | "draining"
  | "delete_requested"
  | "deleted_verified"
  | "failed"
  | "deletion_unverified";

const ACTIVE_STATUSES = [
  "requested",
  "create_claimed",
  "create_dispatched",
  "provisioning",
  "booting",
  "rendering",
  "draining",
  "delete_requested",
  "failed",
  "deletion_unverified",
] as const satisfies readonly LeaseStatus[];

type RemoteChildFence = {
  leaseOwner: string;
  executionLeaseToken: number;
  dispatchKey: string;
};

const remoteChildFenceValidator = v.object({
  leaseOwner: v.string(),
  executionLeaseToken: v.number(),
  dispatchKey: v.string(),
});

function assertInternalSecret(secret: string, operation: string): void {
  const expected = process.env.INTERNAL_QUERY_SECRET;
  if (!expected || secret !== expected) {
    throw new Error(`${operation}: invalid internal secret`);
  }
}

function assertText(value: string, name: string, max = 300): void {
  if (!value || value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`novitaWorkerLeases: invalid ${name}`);
  }
}

function assertWorkerName(workerName: string): void {
  if (!MANAGED_WORKER_NAME.test(workerName)) {
    throw new Error("novitaWorkerLeases: worker must be a managed RTX 4090 name");
  }
}

function assertSha256(value: string, name: string): void {
  if (!SHA_256.test(value)) {
    throw new Error(`novitaWorkerLeases: invalid ${name}`);
  }
}

function assertEpoch(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`novitaWorkerLeases: invalid ${name}`);
  }
}

function assertCost(value: number): void {
  // This is an abuse guard, not the render-budget decision.  At the locked
  // 4090 spot SKU, a two-hour worker is well below this ceiling.
  if (!Number.isFinite(value) || value <= 0 || value > 100) {
    throw new Error("novitaWorkerLeases: maximumCostUsd is invalid");
  }
}

function assertLeaseTimes(args: {
  requestedAt: number;
  bootDeadlineAt: number;
  absoluteDeadlineAt: number;
}): void {
  assertEpoch(args.requestedAt, "requestedAt");
  assertEpoch(args.bootDeadlineAt, "bootDeadlineAt");
  assertEpoch(args.absoluteDeadlineAt, "absoluteDeadlineAt");
  if (
    args.bootDeadlineAt < args.requestedAt ||
    args.absoluteDeadlineAt < args.bootDeadlineAt ||
    args.bootDeadlineAt - args.requestedAt > MAX_BOOT_WINDOW_MS ||
    args.absoluteDeadlineAt - args.requestedAt > MAX_WORKER_LIFETIME_MS
  ) {
    throw new Error("novitaWorkerLeases: worker deadlines exceed the bounded lifecycle");
  }
}

function assertAfterLeaseClock(
  lease: { lastHeartbeatAt: number; requestedAt: number },
  now: number,
  operation: string,
): void {
  assertEpoch(now, "now");
  if (now < lease.requestedAt || now < lease.lastHeartbeatAt) {
    throw new Error(`${operation}: stale lifecycle timestamp`);
  }
}

function assertOwnedActiveRun(
  channel: { ownerId: string } | null,
  run: { ownerId: string; channelId: unknown; status: string } | null,
  ownerId: string,
  channelId: unknown,
): void {
  if (!channel || channel.ownerId !== ownerId) {
    throw new Error("novitaWorkerLeases: channel ownership mismatch");
  }
  if (
    !run ||
    run.ownerId !== ownerId ||
    run.channelId !== channelId ||
    ["ok", "failed", "canceled"].includes(run.status)
  ) {
    throw new Error("novitaWorkerLeases: run ownership/status mismatch");
  }
}

function assertRemoteChildFenceShape(fence: RemoteChildFence): void {
  assertText(fence.leaseOwner, "remote child leaseOwner");
  assertText(fence.dispatchKey, "remote child dispatchKey", 500);
  if (
    !Number.isSafeInteger(fence.executionLeaseToken) ||
    fence.executionLeaseToken < 1
  ) {
    throw new Error("novitaWorkerLeases: invalid remote child execution lease token");
  }
}

/**
 * The caller-side renewal is a useful early rejection, but it cannot close a
 * process-pause race by itself. This check runs in the same Convex mutation as
 * the worker reservation/create transition, so a reaper's new execution token
 * serializes ahead of any stale child attempting to consume paid capacity.
 */
async function assertCurrentRemoteChildFence(
  ctx: Pick<MutationCtx, "db">,
  args: {
    ownerId: string;
    channelId: Id<"channels">;
    runId: Id<"runs">;
    blockId: string;
    fence: RemoteChildFence;
    now: number;
    operation: string;
    requireFullProviderWindow: boolean;
  },
): Promise<void> {
  assertRemoteChildFenceShape(args.fence);
  const run = await ctx.db.get(args.runId);
  if (
    !run ||
    run.ownerId !== args.ownerId ||
    run.channelId !== args.channelId
  ) {
    throw new Error(`${args.operation}: remote child run ownership/channel mismatch`);
  }
  assertRunExecutionWriteFence(run, {
    leaseOwner: args.fence.leaseOwner,
    executionLeaseToken: args.fence.executionLeaseToken,
  }, args.now);
  const remoteChildWaitUntil = run.remoteChildWaitUntil;
  const remoteChildWaitDeadline = run.remoteChildWaitDeadline;
  if (
    run.remoteChildWaitLeaseOwner !== args.fence.leaseOwner ||
    run.remoteChildWaitExecutionLeaseToken !== args.fence.executionLeaseToken ||
    run.remoteChildWaitBlockId !== args.blockId ||
    run.remoteChildWaitDispatchKey !== args.fence.dispatchKey ||
    typeof remoteChildWaitUntil !== "number" ||
    !Number.isFinite(remoteChildWaitUntil) ||
    typeof remoteChildWaitDeadline !== "number" ||
    !Number.isFinite(remoteChildWaitDeadline) ||
    remoteChildWaitDeadline < remoteChildWaitUntil ||
    run.leaseExpiresAt !== remoteChildWaitUntil ||
    args.now >= remoteChildWaitUntil ||
    args.now >= remoteChildWaitDeadline
  ) {
    throw new Error(`${args.operation}: remote child lifecycle fence is stale or invalid`);
  }
  if (args.requireFullProviderWindow) {
    const providerWindowMs = renderChildProviderWorkWindowMs(
      renderBlockMachineClass(args.blockId),
    );
    if (args.now + providerWindowMs > remoteChildWaitDeadline) {
      throw new Error(`${args.operation}: remote child lacks a full provider work window`);
    }
  }
}

/**
 * A remote worker lease remains tied to the exact parent generation for its
 * entire mutable lifecycle, not just its initial create POST. The only
 * fence-free writer for such a lease is the scheduled reaper after the parent
 * execution is no longer live; a stale child can never impersonate that path
 * while a recovered parent owns the run.
 */
async function assertRemoteChildLifecycleMutationFence(
  ctx: Pick<MutationCtx, "db">,
  args: {
    lease: {
      ownerId: string;
      channelId: Id<"channels">;
      runId: Id<"runs">;
      blockId: string;
      remoteChildFenceRequired?: boolean;
    };
    fence?: RemoteChildFence;
    reaper?: boolean;
    now: number;
    operation: string;
    requireFullProviderWindow?: boolean;
  },
): Promise<void> {
  if (!args.lease.remoteChildFenceRequired) {
    if (args.fence) {
      throw new Error(`${args.operation}: remote child fence does not match this lease`);
    }
    return;
  }
  if (args.fence) {
    if (args.reaper) {
      throw new Error(`${args.operation}: remote child and reaper fences are mutually exclusive`);
    }
    await assertCurrentRemoteChildFence(ctx, {
      ownerId: args.lease.ownerId,
      channelId: args.lease.channelId,
      runId: args.lease.runId,
      blockId: args.lease.blockId,
      fence: args.fence,
      now: args.now,
      operation: args.operation,
      requireFullProviderWindow: args.requireFullProviderWindow ?? false,
    });
    return;
  }
  if (!args.reaper) {
    throw new Error(`${args.operation}: remote child fence is required`);
  }
  const run = await ctx.db.get(args.lease.runId);
  // Reapers reconcile an abandoned lease only after its owning run has
  // stopped or expired. A recovered parent is already `running` with a fresh
  // lease before it dispatches its child, so this closes the gap before that
  // child writes its first remote wait receipt.
  if (
    run &&
    run.ownerId === args.lease.ownerId &&
    run.channelId === args.lease.channelId &&
    run.status === "running" &&
    !isRunLeaseExpired(run, args.now)
  ) {
    throw new Error(`${args.operation}: live remote parent requires its exact child fence`);
  }
}

function sameImmutableLease(
  existing: {
    ownerId: string;
    channelId: unknown;
    runId: unknown;
    blockId: string;
    phase: "image" | "video";
    manifestId: string;
    manifestSha256: string;
    workerName: string;
    productId: string;
    gpuSku: "RTX 4090";
    gpuCount: 1;
    clusterId: string;
    storageId: string;
    imageDigest: string;
    maximumCostUsd: number;
    remoteChildFenceRequired?: boolean;
    requestedAt: number;
    bootDeadlineAt: number;
    absoluteDeadlineAt: number;
  },
  candidate: {
    ownerId: string;
    channelId: unknown;
    runId: unknown;
    blockId: string;
    phase: "image" | "video";
    manifestId: string;
    manifestSha256: string;
    workerName: string;
    productId: string;
    gpuSku: "RTX 4090";
    gpuCount: 1;
    clusterId: string;
    storageId: string;
    imageDigest: string;
    maximumCostUsd: number;
    remoteChildFenceRequired: boolean;
    requestedAt: number;
    bootDeadlineAt: number;
    absoluteDeadlineAt: number;
  },
): boolean {
  return (
    existing.ownerId === candidate.ownerId &&
    existing.channelId === candidate.channelId &&
    existing.runId === candidate.runId &&
    existing.blockId === candidate.blockId &&
    existing.phase === candidate.phase &&
    existing.manifestId === candidate.manifestId &&
    existing.manifestSha256 === candidate.manifestSha256 &&
    existing.workerName === candidate.workerName &&
    existing.productId === candidate.productId &&
    existing.gpuSku === candidate.gpuSku &&
    existing.gpuCount === candidate.gpuCount &&
    existing.clusterId === candidate.clusterId &&
    existing.storageId === candidate.storageId &&
    existing.imageDigest === candidate.imageDigest &&
    existing.maximumCostUsd === candidate.maximumCostUsd &&
    Boolean(existing.remoteChildFenceRequired) === candidate.remoteChildFenceRequired
  );
}

function reaperReason(
  lease: {
    status: LeaseStatus;
    bootDeadlineAt: number;
    absoluteDeadlineAt: number;
    lastHeartbeatAt: number;
    lastWorkAt: number;
  },
  now: number,
  staleAfterMs: number,
): string | null {
  if (lease.status === "delete_requested") return "deletion_pending";
  if (lease.status === "failed") return "provider_or_worker_failed";
  if (lease.status === "deletion_unverified") return "deletion_unverified";
  if (lease.absoluteDeadlineAt <= now) return "absolute_deadline_exceeded";
  if (lease.status === "requested") {
    // A reservation alone has not authorized an external create POST. Reap it
    // promptly so a crashed dispatcher cannot hold scarce quota for a full
    // boot window without ever touching Novita.
    return lease.lastWorkAt <= now - staleAfterMs ? "reservation_unclaimed" : null;
  }
  if (lease.status === "create_claimed") {
    // `create_claimed` is deliberately the state before a create POST is
    // durably dispatched. It can safely be reconciled by name absence after a
    // short stale grace; `create_dispatched` cannot.
    return lease.lastWorkAt <= now - staleAfterMs ? "create_claim_abandoned" : null;
  }
  if (["create_dispatched", "provisioning", "booting"].includes(lease.status)) {
    // Image pull, network-volume attach, and model-cache hydration are normal
    // cold-start work. These states receive their complete immutable boot
    // window, rather than being killed by the shorter render heartbeat grace.
    return lease.bootDeadlineAt <= now ? "boot_deadline_exceeded" : null;
  }
  if (
    lease.lastHeartbeatAt <= now - staleAfterMs ||
    lease.lastWorkAt <= now - staleAfterMs
  ) {
    return "worker_heartbeat_stale";
  }
  return null;
}

/**
 * Reserve the durable identity before asking Novita to allocate capacity.  A
 * retried Trigger invocation can only reuse an exactly identical reservation;
 * it can never turn a prior worker name into a new spend authorization.
 */
export const reserve = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    blockId: v.string(),
    phase: v.union(v.literal("image"), v.literal("video")),
    manifestId: v.string(),
    manifestSha256: v.string(),
    workerName: v.string(),
    productId: v.string(),
    gpuSku: v.literal("RTX 4090"),
    gpuCount: v.literal(1),
    clusterId: v.string(),
    storageId: v.string(),
    imageDigest: v.string(),
    maximumCostUsd: v.number(),
    verifiedGpuQuota: v.number(),
    requestedAt: v.number(),
    bootDeadlineAt: v.number(),
    absoluteDeadlineAt: v.number(),
    remoteChildFence: v.optional(remoteChildFenceValidator),
  },
  returns: v.object({
    leaseId: v.id("novitaWorkerLeases"),
    reused: v.boolean(),
    status: leaseStatus,
    instanceId: v.optional(v.string()),
    requestedAt: v.number(),
    deletedVerifiedAt: v.optional(v.number()),
    billingReceipt: v.optional(v.any()),
  }),
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret, "novitaWorkerLeases.reserve");
    assertText(args.ownerId, "ownerId", 160);
    assertText(args.blockId, "blockId", 160);
    assertText(args.manifestId, "manifestId", 240);
    assertText(args.productId, "productId", 160);
    assertText(args.clusterId, "clusterId", 160);
    assertText(args.storageId, "storageId", 160);
    assertWorkerName(args.workerName);
    assertSha256(args.manifestSha256, "manifestSha256");
    if (!PINNED_IMAGE.test(args.imageDigest)) {
      throw new Error("novitaWorkerLeases: imageDigest must be digest pinned");
    }
    assertCost(args.maximumCostUsd);
    if (!Number.isSafeInteger(args.verifiedGpuQuota) || args.verifiedGpuQuota < 1 || args.verifiedGpuQuota > 8) {
      throw new Error("novitaWorkerLeases: verifiedGpuQuota must be an integer from 1 to 8");
    }
    assertLeaseTimes(args);

    if (args.remoteChildFence) {
      await assertCurrentRemoteChildFence(ctx, {
        ownerId: args.ownerId,
        channelId: args.channelId,
        runId: args.runId,
        blockId: args.blockId,
        fence: args.remoteChildFence,
        now: Date.now(),
        operation: "novitaWorkerLeases.reserve",
        requireFullProviderWindow: true,
      });
    }

    const [channel, run] = await Promise.all([
      ctx.db.get(args.channelId),
      ctx.db.get(args.runId),
    ]);
    assertOwnedActiveRun(channel, run, args.ownerId, args.channelId);

    const existingByName = await ctx.db
      .query("novitaWorkerLeases")
      .withIndex("by_worker_name", (q) => q.eq("workerName", args.workerName))
      .unique();
    const existingByManifest = await ctx.db
      .query("novitaWorkerLeases")
      .withIndex("by_manifest", (q) => q.eq("manifestId", args.manifestId))
      .unique();
    const row = {
      ownerId: args.ownerId,
      channelId: args.channelId,
      runId: args.runId,
      blockId: args.blockId,
      phase: args.phase,
      manifestId: args.manifestId,
      manifestSha256: args.manifestSha256,
      workerName: args.workerName,
      productId: args.productId,
      gpuSku: args.gpuSku,
      gpuCount: args.gpuCount,
      clusterId: args.clusterId,
      storageId: args.storageId,
      imageDigest: args.imageDigest,
      maximumCostUsd: args.maximumCostUsd,
      remoteChildFenceRequired: args.remoteChildFence !== undefined,
      requestedAt: args.requestedAt,
      bootDeadlineAt: args.bootDeadlineAt,
      absoluteDeadlineAt: args.absoluteDeadlineAt,
    };

    if (existingByName || existingByManifest) {
      const existing = existingByName ?? existingByManifest;
      if (!existing || !sameImmutableLease(existing, row)) {
        throw new Error("novitaWorkerLeases: immutable worker/manifest collision");
      }
      return {
        leaseId: existing._id,
        reused: true,
        status: existing.status,
        ...(existing.instanceId ? { instanceId: existing.instanceId } : {}),
        requestedAt: existing.requestedAt,
        ...(existing.instanceCreatedAt !== undefined ? { instanceCreatedAt: existing.instanceCreatedAt } : {}),
        ...(existing.deletedVerifiedAt !== undefined ? { deletedVerifiedAt: existing.deletedVerifiedAt } : {}),
        ...(existing.billingReceipt !== undefined ? { billingReceipt: existing.billingReceipt } : {}),
      };
    }

    // Convex mutations are serializable. Reserving this slot in the same
    // transaction as the lease insertion is the global 4090 concurrency
    // fence—separate Trigger jobs cannot both observe the same free slot and
    // overrun the verified account quota.
    let occupiedSlots = 0;
    for (const status of ACTIVE_STATUSES) {
      const remaining = args.verifiedGpuQuota - occupiedSlots;
      if (remaining < 1) break;
      const rows = await ctx.db
        .query("novitaWorkerLeases")
        .withIndex("by_status_last_work", (q) => q.eq("status", status))
        .take(remaining);
      occupiedSlots += rows.length;
    }
    if (occupiedSlots >= args.verifiedGpuQuota) {
      throw new Error("novitaWorkerLeases: verified RTX 4090 fleet quota is exhausted");
    }

    const leaseId = await ctx.db.insert("novitaWorkerLeases", {
      ...row,
      status: "requested",
      lastHeartbeatAt: args.requestedAt,
      lastWorkAt: args.requestedAt,
    });
    return { leaseId, reused: false, status: "requested" as const, requestedAt: args.requestedAt };
  },
});

/** Bind the sole Novita provider id to a reserved worker exactly once. */
export const claimCreate = mutation({
  args: {
    secret: v.string(),
    workerName: v.string(),
    attemptToken: v.string(),
    now: v.number(),
    remoteChildFence: v.optional(remoteChildFenceValidator),
  },
  returns: v.object({
    claimed: v.boolean(),
    status: leaseStatus,
    instanceId: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret, "novitaWorkerLeases.claimCreate");
    assertWorkerName(args.workerName);
    assertEpoch(args.now, "now");
    if (!CREATE_ATTEMPT_TOKEN.test(args.attemptToken)) {
      throw new Error("novitaWorkerLeases: invalid create attempt token");
    }
    const lease = await ctx.db
      .query("novitaWorkerLeases")
      .withIndex("by_worker_name", (q) => q.eq("workerName", args.workerName))
      .unique();
    if (!lease) throw new Error("novitaWorkerLeases: worker not found");
    assertAfterLeaseClock(lease, args.now, "novitaWorkerLeases.claimCreate");
    await assertRemoteChildLifecycleMutationFence(ctx, {
      lease,
      fence: args.remoteChildFence,
      now: Date.now(),
      operation: "novitaWorkerLeases.claimCreate",
      requireFullProviderWindow: true,
    });
    if (lease.status === "requested") {
      await ctx.db.patch(lease._id, {
        status: "create_claimed",
        createAttemptToken: args.attemptToken,
        createClaimedAt: args.now,
        lastHeartbeatAt: args.now,
        lastWorkAt: args.now,
      });
      return { claimed: true, status: "create_claimed" as const };
    }
    if (lease.status === "create_claimed" && lease.createAttemptToken === args.attemptToken) {
      return { claimed: true, status: lease.status };
    }
    return {
      claimed: false,
      status: lease.status,
      ...(lease.instanceId ? { instanceId: lease.instanceId } : {}),
    };
  },
});

/**
 * Durably record the exact boundary immediately before the paid provider
 * create POST. A lease with this marker but no provider id is intentionally
 * never closed just because a name listing is temporarily empty: Novita may
 * still materialize a request whose HTTP response was lost.
 */
export const markCreateDispatched = mutation({
  args: {
    secret: v.string(),
    workerName: v.string(),
    attemptToken: v.string(),
    now: v.number(),
    remoteChildFence: v.optional(remoteChildFenceValidator),
  },
  returns: v.id("novitaWorkerLeases"),
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret, "novitaWorkerLeases.markCreateDispatched");
    assertWorkerName(args.workerName);
    assertEpoch(args.now, "now");
    if (!CREATE_ATTEMPT_TOKEN.test(args.attemptToken)) {
      throw new Error("novitaWorkerLeases: invalid create attempt token");
    }
    const lease = await ctx.db
      .query("novitaWorkerLeases")
      .withIndex("by_worker_name", (q) => q.eq("workerName", args.workerName))
      .unique();
    if (!lease) throw new Error("novitaWorkerLeases: worker not found");
    assertAfterLeaseClock(lease, args.now, "novitaWorkerLeases.markCreateDispatched");
    await assertRemoteChildLifecycleMutationFence(ctx, {
      lease,
      fence: args.remoteChildFence,
      now: Date.now(),
      operation: "novitaWorkerLeases.markCreateDispatched",
      requireFullProviderWindow: true,
    });
    if (lease.status === "create_dispatched" && lease.createAttemptToken === args.attemptToken) {
      return lease._id;
    }
    if (lease.status !== "create_claimed" || lease.createAttemptToken !== args.attemptToken) {
      throw new Error("novitaWorkerLeases: provider create requires the active create claim");
    }
    await ctx.db.patch(lease._id, {
      status: "create_dispatched",
      createDispatchedAt: args.now,
      lastHeartbeatAt: args.now,
      lastWorkAt: args.now,
    });
    return lease._id;
  },
});

export const bindInstance = mutation({
  args: {
    secret: v.string(),
    workerName: v.string(),
    instanceId: v.string(),
    attemptToken: v.string(),
    now: v.number(),
    remoteChildFence: v.optional(remoteChildFenceValidator),
  },
  returns: v.id("novitaWorkerLeases"),
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret, "novitaWorkerLeases.bindInstance");
    assertWorkerName(args.workerName);
    if (!INSTANCE_ID.test(args.instanceId)) {
      throw new Error("novitaWorkerLeases: invalid instanceId");
    }
    if (!CREATE_ATTEMPT_TOKEN.test(args.attemptToken)) {
      throw new Error("novitaWorkerLeases: invalid create attempt token");
    }
    const lease = await ctx.db
      .query("novitaWorkerLeases")
      .withIndex("by_worker_name", (q) => q.eq("workerName", args.workerName))
      .unique();
    if (!lease) throw new Error("novitaWorkerLeases: reserved worker not found");
    assertAfterLeaseClock(lease, args.now, "novitaWorkerLeases.bindInstance");
    await assertRemoteChildLifecycleMutationFence(ctx, {
      lease,
      fence: args.remoteChildFence,
      now: Date.now(),
      operation: "novitaWorkerLeases.bindInstance",
    });
    if (lease.instanceId && lease.instanceId !== args.instanceId) {
      throw new Error("novitaWorkerLeases: provider instance collision");
    }
    if (lease.status === "deleted_verified") {
      throw new Error("novitaWorkerLeases: cannot bind a deleted lease");
    }
    if (
      ["create_claimed", "create_dispatched"].includes(lease.status) &&
      lease.createAttemptToken === args.attemptToken
    ) {
      await ctx.db.patch(lease._id, {
        instanceId: args.instanceId,
        status: "provisioning",
        instanceCreatedAt: lease.instanceCreatedAt ?? lease.createDispatchedAt ?? args.now,
        lastHeartbeatAt: args.now,
        lastWorkAt: args.now,
      });
    } else if (lease.instanceId === args.instanceId && ["provisioning", "booting", "rendering", "draining"].includes(lease.status)) {
      return lease._id;
    } else {
      throw new Error("novitaWorkerLeases: provider bind requires the active create claim");
    }
    return lease._id;
  },
});

/**
 * Fence lifecycle observation/deletion as well as physical creation. A
 * duplicate Trigger invocation must wait for the durable owner or reaper; it
 * must never attach to an existing provider instance and race its teardown.
 */
export const claimExecution = mutation({
  args: {
    secret: v.string(),
    workerName: v.string(),
    attemptToken: v.string(),
    now: v.number(),
    remoteChildFence: v.optional(remoteChildFenceValidator),
  },
  returns: v.object({
    claimed: v.boolean(),
    status: leaseStatus,
    instanceId: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret, "novitaWorkerLeases.claimExecution");
    assertWorkerName(args.workerName);
    assertEpoch(args.now, "now");
    if (!CREATE_ATTEMPT_TOKEN.test(args.attemptToken)) {
      throw new Error("novitaWorkerLeases: invalid execution attempt token");
    }
    const lease = await ctx.db
      .query("novitaWorkerLeases")
      .withIndex("by_worker_name", (q) => q.eq("workerName", args.workerName))
      .unique();
    if (!lease) throw new Error("novitaWorkerLeases: worker not found");
    assertAfterLeaseClock(lease, args.now, "novitaWorkerLeases.claimExecution");
    await assertRemoteChildLifecycleMutationFence(ctx, {
      lease,
      fence: args.remoteChildFence,
      now: Date.now(),
      operation: "novitaWorkerLeases.claimExecution",
    });
    if (["deleted_verified", "failed", "deletion_unverified"].includes(lease.status)) {
      return {
        claimed: false,
        status: lease.status,
        ...(lease.instanceId ? { instanceId: lease.instanceId } : {}),
      };
    }
    const recoveredRemoteController =
      Boolean(lease.remoteChildFenceRequired && args.remoteChildFence) &&
      (
        lease.remoteChildExecutionLeaseOwner !== args.remoteChildFence!.leaseOwner ||
        lease.remoteChildExecutionLeaseToken !== args.remoteChildFence!.executionLeaseToken ||
        lease.remoteChildExecutionDispatchKey !== args.remoteChildFence!.dispatchKey
      );
    if (!lease.executionAttemptToken || recoveredRemoteController) {
      await ctx.db.patch(lease._id, {
        executionAttemptToken: args.attemptToken,
        executionClaimedAt: args.now,
        lastHeartbeatAt: args.now,
        lastWorkAt: args.now,
        ...(args.remoteChildFence
          ? {
              remoteChildExecutionLeaseOwner: args.remoteChildFence.leaseOwner,
              remoteChildExecutionLeaseToken: args.remoteChildFence.executionLeaseToken,
              remoteChildExecutionDispatchKey: args.remoteChildFence.dispatchKey,
            }
          : {}),
      });
      return {
        claimed: true,
        status: lease.status,
        ...(lease.instanceId ? { instanceId: lease.instanceId } : {}),
      };
    }
    return {
      claimed: lease.executionAttemptToken === args.attemptToken,
      status: lease.status,
      ...(lease.instanceId ? { instanceId: lease.instanceId } : {}),
    };
  },
});

/** Record a worker heartbeat without allowing a teardown state to be revived. */
export const heartbeat = mutation({
  args: {
    secret: v.string(),
    workerName: v.string(),
    status: heartbeatStatus,
    now: v.number(),
    completionKey: v.optional(v.string()),
    remoteChildFence: v.optional(remoteChildFenceValidator),
  },
  returns: v.id("novitaWorkerLeases"),
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret, "novitaWorkerLeases.heartbeat");
    assertWorkerName(args.workerName);
    if (args.completionKey !== undefined) {
      assertText(args.completionKey, "completionKey", 1_000);
      if (args.status !== "draining") {
        throw new Error("novitaWorkerLeases: completionKey requires draining state");
      }
    }
    const lease = await ctx.db
      .query("novitaWorkerLeases")
      .withIndex("by_worker_name", (q) => q.eq("workerName", args.workerName))
      .unique();
    if (!lease) throw new Error("novitaWorkerLeases: worker not found");
    assertAfterLeaseClock(lease, args.now, "novitaWorkerLeases.heartbeat");
    await assertRemoteChildLifecycleMutationFence(ctx, {
      lease,
      fence: args.remoteChildFence,
      now: Date.now(),
      operation: "novitaWorkerLeases.heartbeat",
    });
    if (!lease.instanceId) {
      throw new Error("novitaWorkerLeases: heartbeat before provider instance binding");
    }
    if (["delete_requested", "deleted_verified", "failed", "deletion_unverified"].includes(lease.status)) {
      throw new Error("novitaWorkerLeases: heartbeat cannot revive a closed worker");
    }
    if (
      (args.status === "booting" && !["provisioning", "booting"].includes(lease.status)) ||
      (args.status === "rendering" && !["provisioning", "booting", "rendering"].includes(lease.status)) ||
      (args.status === "draining" && !["booting", "rendering", "draining"].includes(lease.status))
    ) {
      throw new Error("novitaWorkerLeases: invalid lifecycle transition");
    }
    if (
      args.completionKey !== undefined &&
      lease.completionKey !== undefined &&
      lease.completionKey !== args.completionKey
    ) {
      throw new Error("novitaWorkerLeases: immutable completion key collision");
    }
    await ctx.db.patch(lease._id, {
      status: args.status,
      lastHeartbeatAt: args.now,
      lastWorkAt: args.now,
      ...(args.completionKey !== undefined ? { completionKey: args.completionKey } : {}),
    });
    return lease._id;
  },
});

/** Enter teardown; callers still must obtain a provider removal confirmation. */
export const requestDeletion = mutation({
  args: {
    secret: v.string(),
    workerName: v.string(),
    now: v.number(),
    reason: v.optional(v.string()),
    remoteChildFence: v.optional(remoteChildFenceValidator),
    // The scheduled reconciler is the only fence-free writer for an
    // abandoned remote worker, and only after the parent execution expires.
    reaper: v.optional(v.literal(true)),
  },
  returns: v.id("novitaWorkerLeases"),
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret, "novitaWorkerLeases.requestDeletion");
    assertWorkerName(args.workerName);
    if (args.reason !== undefined) assertText(args.reason, "reason", 1_000);
    const lease = await ctx.db
      .query("novitaWorkerLeases")
      .withIndex("by_worker_name", (q) => q.eq("workerName", args.workerName))
      .unique();
    if (!lease) throw new Error("novitaWorkerLeases: worker not found");
    assertAfterLeaseClock(lease, args.now, "novitaWorkerLeases.requestDeletion");
    await assertRemoteChildLifecycleMutationFence(ctx, {
      lease,
      fence: args.remoteChildFence,
      reaper: args.reaper,
      now: Date.now(),
      operation: "novitaWorkerLeases.requestDeletion",
    });
    if (lease.status === "deleted_verified") return lease._id;
    await ctx.db.patch(lease._id, {
      status: "delete_requested",
      deletionRequestedAt: args.now,
      lastHeartbeatAt: args.now,
      lastWorkAt: args.now,
      ...(args.reason !== undefined ? { lastError: args.reason } : {}),
    });
    return lease._id;
  },
});

/** Terminal success: Novita returned removed or a direct 404 absence proof. */
export const markDeletedVerified = mutation({
  args: {
    secret: v.string(),
    workerName: v.string(),
    now: v.number(),
    billingReceipt: v.optional(v.any()),
    remoteChildFence: v.optional(remoteChildFenceValidator),
    reaper: v.optional(v.literal(true)),
  },
  returns: v.id("novitaWorkerLeases"),
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret, "novitaWorkerLeases.markDeletedVerified");
    assertWorkerName(args.workerName);
    const lease = await ctx.db
      .query("novitaWorkerLeases")
      .withIndex("by_worker_name", (q) => q.eq("workerName", args.workerName))
      .unique();
    if (!lease) throw new Error("novitaWorkerLeases: worker not found");
    assertAfterLeaseClock(lease, args.now, "novitaWorkerLeases.markDeletedVerified");
    await assertRemoteChildLifecycleMutationFence(ctx, {
      lease,
      fence: args.remoteChildFence,
      reaper: args.reaper,
      now: Date.now(),
      operation: "novitaWorkerLeases.markDeletedVerified",
    });
    if (lease.status === "deleted_verified") return lease._id;
    if (lease.status !== "delete_requested") {
      throw new Error("novitaWorkerLeases: deletion must be requested before verification");
    }
    await ctx.db.patch(lease._id, {
      status: "deleted_verified",
      deletedVerifiedAt: args.now,
      lastHeartbeatAt: args.now,
      lastWorkAt: args.now,
      ...(args.billingReceipt !== undefined ? { billingReceipt: args.billingReceipt } : {}),
    });
    return lease._id;
  },
});

/** Keep a failed teardown visible to the reaper rather than falsely closing it. */
export const markDeletionUnverified = mutation({
  args: {
    secret: v.string(),
    workerName: v.string(),
    now: v.number(),
    error: v.string(),
    remoteChildFence: v.optional(remoteChildFenceValidator),
    reaper: v.optional(v.literal(true)),
  },
  returns: v.id("novitaWorkerLeases"),
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret, "novitaWorkerLeases.markDeletionUnverified");
    assertWorkerName(args.workerName);
    assertText(args.error, "error", 1_000);
    const lease = await ctx.db
      .query("novitaWorkerLeases")
      .withIndex("by_worker_name", (q) => q.eq("workerName", args.workerName))
      .unique();
    if (!lease) throw new Error("novitaWorkerLeases: worker not found");
    assertAfterLeaseClock(lease, args.now, "novitaWorkerLeases.markDeletionUnverified");
    await assertRemoteChildLifecycleMutationFence(ctx, {
      lease,
      fence: args.remoteChildFence,
      reaper: args.reaper,
      now: Date.now(),
      operation: "novitaWorkerLeases.markDeletionUnverified",
    });
    if (lease.status === "deleted_verified") {
      throw new Error("novitaWorkerLeases: cannot invalidate verified deletion");
    }
    if (!["delete_requested", "deletion_unverified"].includes(lease.status)) {
      throw new Error("novitaWorkerLeases: deletion failure without a deletion request");
    }
    await ctx.db.patch(lease._id, {
      status: "deletion_unverified",
      lastHeartbeatAt: args.now,
      lastWorkAt: args.now,
      lastError: args.error,
    });
    return lease._id;
  },
});

/** Record a render/provision failure before the caller enters normal teardown. */
export const markFailed = mutation({
  args: {
    secret: v.string(),
    workerName: v.string(),
    now: v.number(),
    error: v.string(),
    remoteChildFence: v.optional(remoteChildFenceValidator),
  },
  returns: v.id("novitaWorkerLeases"),
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret, "novitaWorkerLeases.markFailed");
    assertWorkerName(args.workerName);
    assertText(args.error, "error", 1_000);
    const lease = await ctx.db
      .query("novitaWorkerLeases")
      .withIndex("by_worker_name", (q) => q.eq("workerName", args.workerName))
      .unique();
    if (!lease) throw new Error("novitaWorkerLeases: worker not found");
    assertAfterLeaseClock(lease, args.now, "novitaWorkerLeases.markFailed");
    await assertRemoteChildLifecycleMutationFence(ctx, {
      lease,
      fence: args.remoteChildFence,
      now: Date.now(),
      operation: "novitaWorkerLeases.markFailed",
    });
    if (lease.status === "deleted_verified") {
      throw new Error("novitaWorkerLeases: cannot fail a deleted lease");
    }
    if (["delete_requested", "deletion_unverified"].includes(lease.status)) {
      throw new Error("novitaWorkerLeases: teardown is already in progress");
    }
    await ctx.db.patch(lease._id, {
      status: "failed",
      lastHeartbeatAt: args.now,
      lastWorkAt: args.now,
      lastError: args.error,
    });
    return lease._id;
  },
});

/**
 * Read the durable lease for one provider-reported worker.  The Trigger reaper
 * uses this to distinguish a healthy active worker from a truly orphaned one
 * before it asks Novita to delete it.
 */
export const getByWorkerName = query({
  args: { secret: v.string(), workerName: v.string() },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret, "novitaWorkerLeases.getByWorkerName");
    assertWorkerName(args.workerName);
    return await ctx.db
      .query("novitaWorkerLeases")
      .withIndex("by_worker_name", (q) => q.eq("workerName", args.workerName))
      .unique();
  },
});

/**
 * Bounded indexed query used by the cloud reaper.  It includes hard deadline
 * breaches even while a stale worker keeps sending heartbeats, so heartbeat
 * spam cannot turn a disposable GPU into an indefinitely billed one.
 */
export const listReapCandidates = query({
  args: {
    secret: v.string(),
    now: v.number(),
    staleAfterMs: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret, "novitaWorkerLeases.listReapCandidates");
    assertEpoch(args.now, "now");
    if (
      !Number.isSafeInteger(args.staleAfterMs) ||
      args.staleAfterMs < 60_000 ||
      args.staleAfterMs > 30 * 60_000
    ) {
      throw new Error("novitaWorkerLeases: staleAfterMs must be between one and thirty minutes");
    }
    if (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > MAX_REAP_CANDIDATES) {
      throw new Error(`novitaWorkerLeases: limit must be between 1 and ${MAX_REAP_CANDIDATES}`);
    }

    const candidates: Array<{
      leaseId: string;
      workerName: string;
      instanceId?: string;
      status: LeaseStatus;
      reason: string;
      createAttemptToken?: string;
      createDispatchedAt?: number;
      requestedAt: number;
      lastHeartbeatAt: number;
      lastWorkAt: number;
      bootDeadlineAt: number;
      absoluteDeadlineAt: number;
    }> = [];

    for (const status of ACTIVE_STATUSES) {
      const rows = await ctx.db
        .query("novitaWorkerLeases")
        .withIndex("by_status_last_work", (q) => q.eq("status", status))
        .take(MAX_SCAN_PER_STATE);
      for (const lease of rows) {
        // Defense in depth: malformed historical rows must never become a
        // deletion target merely because an index happens to contain them.
        if (!MANAGED_WORKER_NAME.test(lease.workerName)) continue;
        const reason = reaperReason(lease, args.now, args.staleAfterMs);
        if (!reason) continue;
        candidates.push({
          leaseId: String(lease._id),
          workerName: lease.workerName,
          ...(lease.instanceId ? { instanceId: lease.instanceId } : {}),
          status: lease.status,
          reason,
          ...(lease.createAttemptToken ? { createAttemptToken: lease.createAttemptToken } : {}),
          ...(lease.createDispatchedAt !== undefined ? { createDispatchedAt: lease.createDispatchedAt } : {}),
          requestedAt: lease.requestedAt,
          lastHeartbeatAt: lease.lastHeartbeatAt,
          lastWorkAt: lease.lastWorkAt,
          bootDeadlineAt: lease.bootDeadlineAt,
          absoluteDeadlineAt: lease.absoluteDeadlineAt,
        });
      }
    }

    return candidates
      .sort((a, b) => {
        const aUrgency = Math.min(a.absoluteDeadlineAt, a.bootDeadlineAt, a.lastHeartbeatAt);
        const bUrgency = Math.min(b.absoluteDeadlineAt, b.bootDeadlineAt, b.lastHeartbeatAt);
        return aUrgency - bUrgency || a.workerName.localeCompare(b.workerName);
      })
      .slice(0, args.limit);
  },
});

/** Persist a verified receipt when the reaper removes an unleased worker. */
export const recordOrphanDeletion = mutation({
  args: {
    secret: v.string(),
    workerName: v.string(),
    instanceId: v.string(),
    now: v.number(),
    receipt: v.any(),
  },
  returns: v.id("novitaOrphanTeardownAudits"),
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret, "novitaWorkerLeases.recordOrphanDeletion");
    assertWorkerName(args.workerName);
    if (!INSTANCE_ID.test(args.instanceId)) throw new Error("novitaWorkerLeases: invalid instanceId");
    assertEpoch(args.now, "now");
    const existing = await ctx.db
      .query("novitaOrphanTeardownAudits")
      .withIndex("by_worker_instance", (q) => q.eq("workerName", args.workerName).eq("instanceId", args.instanceId))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("novitaOrphanTeardownAudits", {
      workerName: args.workerName,
      instanceId: args.instanceId,
      deletedVerifiedAt: args.now,
      receipt: args.receipt,
    });
  },
});
