import { v } from "convex/values";

import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import { MusicAuditionCheckpointSchema } from "../src/engine/musicAuditionCheckpoint";
import { assertRunExecutionWriteFence } from "../src/lib/runLease";

function clearExecutionLeasePatch() {
  return {
    leaseExpiresAt: undefined, leaseOwner: undefined, leaseRecoveryPending: undefined,
    remoteChildWaitLeaseOwner: undefined, remoteChildWaitExecutionLeaseToken: undefined,
    remoteChildWaitBlockId: undefined, remoteChildWaitDispatchKey: undefined,
    remoteChildWaitUntil: undefined, remoteChildWaitDeadline: undefined,
  };
}

/**
 * Trigger-only durable handoff after the `music` stage. The trusted worker
 * provides its already reconstructed checkpoint, but this mutation compares
 * every key to the current persisted stage before releasing the lease.
 */
export const createAwaiting = mutation({
  args: {
    ownerId: v.string(), channelId: v.id("channels"), runId: v.id("runs"),
    leaseOwner: v.string(), executionLeaseToken: v.number(), invocationSha256: v.string(),
    checkpoint: v.any(), now: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "music audition checkpoint creation");
    const now = args.now ?? Date.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error("music audition checkpoint time is invalid");
    const [channel, run] = await Promise.all([ctx.db.get(args.channelId), ctx.db.get(args.runId)]);
    if (!channel || channel.ownerId !== args.ownerId || !run || run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
      throw new Error("music audition ownership/channel mismatch");
    }
    assertRunExecutionWriteFence(run, { leaseOwner: args.leaseOwner, executionLeaseToken: args.executionLeaseToken }, now);
    const checkpoint = MusicAuditionCheckpointSchema.parse(args.checkpoint);
    if (
      checkpoint.ownerId !== args.ownerId || checkpoint.channelId !== String(args.channelId) ||
      checkpoint.runId !== String(args.runId) || checkpoint.invocationSha256 !== args.invocationSha256 ||
      run.pipelineInvocationSha256 !== args.invocationSha256
    ) throw new Error("music audition checkpoint does not match the frozen run");
    const stages = await ctx.db.query("runStages").withIndex("by_run_block", q => q.eq("runId", args.runId).eq("block", "music")).take(2);
    if (stages.length !== 1 || stages[0]!.status !== "ok" || !stages[0]!.outputs || typeof stages[0]!.outputs !== "object") {
      throw new Error("music audition requires one completed durable music stage");
    }
    const output = stages[0]!.outputs as Record<string, unknown>;
    if (
      output.musicProvider !== "minimax_music3" ||
      output.channelMusicProgramKey !== checkpoint.channelMusicProgramKey ||
      output.musicRuntimeReceiptKey !== checkpoint.musicRuntimeReceiptKey ||
      output.musicNativeWavKey !== checkpoint.musicNativeWavKey
    ) throw new Error("music audition checkpoint no longer matches the current music stage");
    const existing = await ctx.db.query("musicAuditionCheckpoints").withIndex("by_run", q => q.eq("runId", args.runId)).take(2);
    if (existing.length > 1) throw new Error("music audition run has more than one immutable checkpoint");
    if (existing[0]) {
      if (existing[0].checkpointFingerprint !== checkpoint.checkpointFingerprint || existing[0].decision !== "awaiting") {
        throw new Error("music audition checkpoint replay does not match its immutable awaiting receipt");
      }
      await ctx.db.patch(run._id, {
        status: "awaiting_music_audition", musicAuditionCheckpointId: existing[0]._id,
        musicAuditionCheckpointFingerprint: checkpoint.checkpointFingerprint, musicAuditionState: "awaiting",
        heartbeatAt: now, error: undefined, ...clearExecutionLeasePatch(),
      });
      return { kind: "awaiting", checkpointId: existing[0]._id, checkpointFingerprint: checkpoint.checkpointFingerprint, reused: true };
    }
    const checkpointId = await ctx.db.insert("musicAuditionCheckpoints", {
      ownerId: args.ownerId, channelId: args.channelId, runId: args.runId,
      checkpoint, checkpointFingerprint: checkpoint.checkpointFingerprint, decision: "awaiting", createdAt: now,
    });
    await ctx.db.patch(run._id, {
      status: "awaiting_music_audition", musicAuditionCheckpointId: checkpointId,
      musicAuditionCheckpointFingerprint: checkpoint.checkpointFingerprint, musicAuditionState: "awaiting",
      heartbeatAt: now, error: undefined, ...clearExecutionLeasePatch(),
    });
    return { kind: "awaiting", checkpointId, checkpointFingerprint: checkpoint.checkpointFingerprint, reused: false };
  },
});

/** Server-only review projection. It never returns a storage locator directly. */
export const getReviewForRun = query({
  args: { ownerId: v.string(), runId: v.id("runs") },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "music audition review read");
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerId !== args.ownerId) throw new Error("music audition run not found");
    const rows = await ctx.db.query("musicAuditionCheckpoints").withIndex("by_run", q => q.eq("runId", args.runId)).take(2);
    if (rows.length > 1) throw new Error("music audition run has more than one immutable checkpoint");
    const row = rows[0];
    if (!row) return null;
    const checkpoint = MusicAuditionCheckpointSchema.parse(row.checkpoint);
    if (
      row.ownerId !== args.ownerId || row.channelId !== run.channelId ||
      run.musicAuditionCheckpointId !== row._id ||
      run.musicAuditionCheckpointFingerprint !== checkpoint.checkpointFingerprint ||
      checkpoint.ownerId !== args.ownerId || checkpoint.runId !== String(args.runId)
    ) throw new Error("music audition checkpoint integrity mismatch");
    return {
      checkpoint: {
        id: row._id, decision: row.decision, createdAt: row.createdAt,
        blockedAt: row.blockedAt, blockedReason: row.blockedReason,
      },
      review: {
        // The route converts this server-derived key to a short-lived URL and
        // strips it before returning to the browser.
        nativeWavKey: checkpoint.musicNativeWavKey,
        durationSec: checkpoint.nativeOutput.durationSec,
        sampleRateHz: checkpoint.nativeOutput.sampleRateHz,
        channels: checkpoint.nativeOutput.channels,
        programFingerprint: checkpoint.programFingerprint,
      },
    };
  },
});

/** A declined native track is terminal for this frozen run; it cannot quietly
 * re-enter assembly or be replaced under the same checkpoint identity. */
export const reject = mutation({
  args: { ownerId: v.string(), checkpointId: v.id("musicAuditionCheckpoints"), reviewerId: v.string(), now: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "music audition rejection");
    const now = args.now ?? Date.now();
    if (!Number.isSafeInteger(now) || now < 0 || !args.reviewerId.trim()) throw new Error("music audition rejection is invalid");
    const row = await ctx.db.get(args.checkpointId);
    if (!row || row.ownerId !== args.ownerId) throw new Error("music audition checkpoint not found");
    const run = await ctx.db.get(row.runId);
    if (!run || run.ownerId !== args.ownerId || run.channelId !== row.channelId) throw new Error("music audition run ownership mismatch");
    if (row.decision === "rejected") return { kind: "rejected", reused: true };
    if (row.decision !== "awaiting" || run.status !== "awaiting_music_audition") {
      throw new Error("music audition checkpoint is no longer awaiting rejection");
    }
    const reason = "music audition rejected by the owner; create a fresh immutable track before assembly";
    await ctx.db.patch(row._id, { decision: "rejected", blockedAt: now, blockedReason: reason });
    await ctx.db.patch(run._id, {
      status: "music_audition_rejected", musicAuditionState: "rejected", error: reason,
      finishedAt: now, heartbeatAt: now, ...clearExecutionLeasePatch(),
    });
    return { kind: "rejected", reused: false };
  },
});
