import { v } from "convex/values";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { assertRunExecutionWriteFence } from "../src/lib/runLease";
import { summarizeRemoteChildCosts, type RemoteChildCostAttempt } from "../src/lib/remoteChildCostEvidence";

const identityArgs = {
  ownerId: v.string(), channelId: v.id("channels"), runId: v.id("runs"),
  leaseOwner: v.string(), executionLeaseToken: v.number(), blockId: v.string(), dispatchKey: v.string(),
};
type Identity = {
  ownerId: string; channelId: Id<"channels">; runId: Id<"runs">;
  leaseOwner: string; executionLeaseToken: number; blockId: string; dispatchKey: string;
};

async function fencedStage(ctx: MutationCtx, args: Identity) {
  await requireStudioServiceIdentity(ctx, args.ownerId, "remote child cost receipt");
  const run = await ctx.db.get(args.runId);
  if (!run || run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
    throw new Error("remote child cost ownership/channel mismatch");
  }
  assertRunExecutionWriteFence(run, args, Date.now());
  if (run.remoteChildWaitDispatchKey !== args.dispatchKey || run.remoteChildWaitBlockId !== args.blockId ||
      run.remoteChildWaitLeaseOwner !== args.leaseOwner ||
      run.remoteChildWaitExecutionLeaseToken !== args.executionLeaseToken ||
      (run.remoteChildWaitUntil ?? 0) <= Date.now()) {
    throw new Error("remote child cost receipt has a stale dispatch fence");
  }
  const stage = await ctx.db.query("runStages").withIndex("by_run_block", (q) =>
    q.eq("runId", args.runId).eq("block", args.blockId)).unique();
  if (!stage || stage.status !== "running") throw new Error("remote child cost receipt requires its running stage");
  return stage;
}

const attemptArgs = { ...identityArgs, taskRunId: v.string(), attemptNumber: v.number() };

export const begin = mutation({
  args: attemptArgs,
  handler: async (ctx, args) => {
    const stage = await fencedStage(ctx, args);
    if (!args.taskRunId.trim() || args.taskRunId.length > 200 ||
        !Number.isSafeInteger(args.attemptNumber) || args.attemptNumber < 1 || args.attemptNumber > 20) {
      throw new Error("remote child attempt identity is invalid");
    }
    const attempts: RemoteChildCostAttempt[] = stage.remoteChildCostAttempts ?? [];
    const sameDispatch = attempts.filter((row) => row.dispatchKey === args.dispatchKey);
    if (sameDispatch.some((row) => row.taskRunId !== args.taskRunId ||
        row.attemptNumber >= args.attemptNumber || row.status === "started" || !row.complete || row.status === "succeeded")) {
      throw new Error("PAID_STAGE_RECONCILIATION_REQUIRED: remote child attempt cannot replay completed or ambiguous work");
    }
    if (attempts.length >= 60) throw new Error("remote child attempt receipt limit exceeded");
    await ctx.db.patch(stage._id, { remoteChildCostAttempts: [...attempts, {
      dispatchKey: args.dispatchKey, taskRunId: args.taskRunId, attemptNumber: args.attemptNumber,
      status: "started", costUsd: 0, complete: false,
    }] });
  },
});

export const finish = mutation({
  args: {
    ...attemptArgs, status: v.union(v.literal("succeeded"), v.literal("failed")), costUsd: v.number(), complete: v.boolean(),
    checkpointCostReceipts: v.array(v.object({ id: v.string(), costUsd: v.number() })),
  },
  handler: async (ctx, args) => {
    const stage = await fencedStage(ctx, args);
    if (!Number.isFinite(args.costUsd) || args.costUsd < 0) throw new Error("remote child cost is invalid");
    const attempts: RemoteChildCostAttempt[] = stage.remoteChildCostAttempts ?? [];
    const index = attempts.findIndex((row) => row.dispatchKey === args.dispatchKey &&
      row.taskRunId === args.taskRunId && row.attemptNumber === args.attemptNumber);
    const prior = attempts[index];
    if (!prior) throw new Error("remote child cost receipt has no admitted attempt");
    if (prior.status !== "started") {
      if (prior.status !== args.status || prior.costUsd !== args.costUsd || prior.complete !== args.complete) {
        throw new Error("remote child terminal cost receipt is immutable");
      }
      return summarizeRemoteChildCosts(attempts, args.dispatchKey);
    }
    const updated = attempts.map((row, i) => i === index
      ? { ...row, status: args.status, costUsd: args.costUsd, complete: args.complete } : row);
    const summary = summarizeRemoteChildCosts(updated, args.dispatchKey);
    const cost = Math.max(stage.cost, (stage.costBeforeExecution ?? 0) + summary.costUsd);
    const receipts = new Map((stage.checkpointCostReceipts ?? []).map((receipt) => [receipt.id, receipt]));
    for (const receipt of args.checkpointCostReceipts) {
      if (!/^[a-f0-9]{64}$/.test(receipt.id) || !Number.isFinite(receipt.costUsd) || receipt.costUsd < 0 ||
          (receipts.has(receipt.id) && receipts.get(receipt.id)!.costUsd !== receipt.costUsd)) {
        throw new Error("remote checkpoint cost receipt is invalid or changed");
      }
      receipts.set(receipt.id, receipt);
    }
    if (receipts.size > 256 || [...receipts.values()].reduce((sum, receipt) => sum + receipt.costUsd, 0) > cost + 1e-9) {
      throw new Error("remote checkpoint receipts exceed the stage cost or receipt limit");
    }
    await ctx.db.patch(stage._id, {
      remoteChildCostAttempts: updated,
      checkpointCostReceipts: [...receipts.values()],
      cost,
    });
    return summary;
  },
});

export const getForDispatch = query({
  args: { ownerId: v.string(), channelId: v.id("channels"), runId: v.id("runs"), blockId: v.string(), dispatchKey: v.string() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "remote child cost reconciliation");
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerId !== args.ownerId || run.channelId !== args.channelId) throw new Error("remote child cost ownership mismatch");
    const stage = await ctx.db.query("runStages").withIndex("by_run_block", (q) =>
      q.eq("runId", args.runId).eq("block", args.blockId)).unique();
    return summarizeRemoteChildCosts(stage?.remoteChildCostAttempts ?? [], args.dispatchKey);
  },
});
