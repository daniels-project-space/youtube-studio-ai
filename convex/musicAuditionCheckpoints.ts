import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import {
  createMusicAuditionApproval,
  MusicAuditionCheckpointSchema,
} from "../src/engine/musicAuditionCheckpoint";
import { assertRunExecutionWriteFence } from "../src/lib/runLease";
import { RUN_QUEUE_LEASE_MS } from "../src/lib/runLease";

const MAX_MUSIC_AUDITION_RESUME_ENQUEUE_ATTEMPTS = 2;
const MUSIC_AUDITION_RESUME_QUEUE_LEASE_MS = RUN_QUEUE_LEASE_MS;
type MusicAuditionCtx = MutationCtx | QueryCtx;

function validText(value: unknown, label: string, max = 1_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function validFingerprint(value: unknown, label: string): string {
  const fingerprint = validText(value, label, 80);
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error(`${label} must be sha256`);
  return fingerprint;
}

function clearExecutionLeasePatch() {
  return {
    leaseExpiresAt: undefined, leaseOwner: undefined, leaseRecoveryPending: undefined,
    remoteChildWaitLeaseOwner: undefined, remoteChildWaitExecutionLeaseToken: undefined,
    remoteChildWaitBlockId: undefined, remoteChildWaitDispatchKey: undefined,
    remoteChildWaitUntil: undefined, remoteChildWaitDeadline: undefined,
  };
}

async function ownedRun(
  ctx: MusicAuditionCtx,
  args: { ownerId: string; channelId: Id<"channels">; runId: Id<"runs"> },
) {
  const [channel, run] = await Promise.all([ctx.db.get(args.channelId), ctx.db.get(args.runId)]);
  if (!channel || channel.ownerId !== args.ownerId) throw new Error("music audition channel ownership mismatch");
  if (!run || run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
    throw new Error("music audition run ownership/channel mismatch");
  }
  return run;
}

async function ownedCheckpoint(
  ctx: MusicAuditionCtx,
  ownerId: string,
  checkpointId: Id<"musicAuditionCheckpoints">,
) {
  const row = await ctx.db.get(checkpointId);
  if (!row || row.ownerId !== ownerId) throw new Error("music audition checkpoint not found");
  return row;
}

function musicResumeQueueDeadline(run: { musicAuditionResumeQueueDeadlineAt?: number; musicAuditionResumeQueuedAt?: number }): number | undefined {
  const explicit = run.musicAuditionResumeQueueDeadlineAt;
  if (explicit !== undefined) return Number.isSafeInteger(explicit) && explicit >= 0 ? explicit : undefined;
  const queuedAt = run.musicAuditionResumeQueuedAt;
  if (!Number.isSafeInteger(queuedAt) || (queuedAt as number) < 0) return undefined;
  const deadline = (queuedAt as number) + MUSIC_AUDITION_RESUME_QUEUE_LEASE_MS;
  return Number.isSafeInteger(deadline) ? deadline : undefined;
}

async function assertMusicStageIntegrity(
  ctx: MusicAuditionCtx,
  runId: Id<"runs">,
  checkpoint: ReturnType<typeof MusicAuditionCheckpointSchema.parse>,
): Promise<void> {
  const stages = await ctx.db.query("runStages").withIndex("by_run_block", q => q.eq("runId", runId).eq("block", "music")).take(2);
  if (stages.length !== 1 || stages[0]!.status !== "ok" || !stages[0]!.outputs || typeof stages[0]!.outputs !== "object") {
    throw new Error("music audition continuation requires one completed durable music stage");
  }
  const output = stages[0]!.outputs as Record<string, unknown>;
  if (
    output.musicProvider !== "minimax_music3" ||
    output.channelMusicProgramKey !== checkpoint.channelMusicProgramKey ||
    output.musicRuntimeReceiptKey !== checkpoint.musicRuntimeReceiptKey ||
    output.musicNativeWavKey !== checkpoint.musicNativeWavKey
  ) throw new Error("music audition continuation no longer matches the sealed music stage");
}

async function blockResume(
  ctx: MutationCtx,
  run: Awaited<ReturnType<typeof ownedRun>>,
  row: Awaited<ReturnType<typeof ownedCheckpoint>> | null,
  now: number,
  reason: string,
): Promise<void> {
  if (row && row.decision !== "blocked") {
    await ctx.db.patch(row._id, { decision: "blocked", blockedAt: now, blockedReason: reason });
  }
  await ctx.db.patch(run._id, {
    status: "music_audition_blocked", musicAuditionState: "blocked", musicAuditionResumeState: "blocked",
    musicAuditionResumeUpdatedAt: now, musicAuditionResumeQueueDeadlineAt: undefined,
    musicAuditionResumeLastError: reason, error: reason, finishedAt: now, heartbeatAt: now,
    ...clearExecutionLeasePatch(),
  });
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
        reviewerId: row.reviewerId, approvedAt: row.approvedAt, rejectedAt: row.rejectedAt,
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
        // These stay in the service-to-service response only. The Next route
        // reloads them to build the receipt and strips every locator before
        // replying to the browser.
        channelMusicProgramKey: checkpoint.channelMusicProgramKey,
        musicRuntimeReceiptKey: checkpoint.musicRuntimeReceiptKey,
        checkpointFingerprint: checkpoint.checkpointFingerprint,
        // Complete checkpoint is service-only; the Next route parses it before
        // it creates a receipt and never serializes this into browser state.
        immutableCheckpoint: checkpoint,
      },
    };
  },
});

/**
 * Admit an already-stored, server-built quality receipt. This mutation never
 * accepts a program, output digest, measurements, or storage object from a
 * browser; the route derives those from the immutable checkpoint first.
 */
export const approve = mutation({
  args: {
    ownerId: v.string(), checkpointId: v.id("musicAuditionCheckpoints"), reviewerId: v.string(),
    qualityReceiptKey: v.string(), qualityReceiptFingerprint: v.string(), now: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "music audition approval");
    const now = args.now ?? Date.now();
    if (!Number.isSafeInteger(now) || now < 0 || !args.reviewerId.trim()) throw new Error("music audition approval is invalid");
    if (!/^[a-f0-9]{64}$/.test(args.qualityReceiptFingerprint)) throw new Error("music audition quality receipt fingerprint is invalid");
    const row = await ctx.db.get(args.checkpointId);
    if (!row || row.ownerId !== args.ownerId) throw new Error("music audition checkpoint not found");
    const run = await ctx.db.get(row.runId);
    if (!run || run.ownerId !== args.ownerId || run.channelId !== row.channelId) throw new Error("music audition run ownership mismatch");
    const checkpoint = MusicAuditionCheckpointSchema.parse(row.checkpoint);
    const expectedKey = `owner/${args.ownerId}/runs/${String(row.runId)}/audio/music-quality-${args.qualityReceiptFingerprint}.json`;
    if (args.qualityReceiptKey !== expectedKey || args.qualityReceiptKey.includes("..")) {
      throw new Error("music audition quality receipt key is outside the exact owner/run namespace");
    }
    if (row.decision === "approved") {
      if (
        row.qualityReceiptKey !== expectedKey ||
        row.qualityReceiptFingerprint !== args.qualityReceiptFingerprint ||
        row.reviewerId !== args.reviewerId
      ) throw new Error("music audition approval replay does not match the immutable decision");
      // Safe migration/replay repair: an older successful server write may
      // have stored the immutable decision before this continuation outbox
      // existed. Recreate only the absent dispatch state; never alter the
      // approval, receipt, native audio, or reviewer identity.
      if (run.status === "awaiting_music_audition" && run.musicAuditionResumeState === undefined) {
        await ctx.db.patch(run._id, {
          musicAuditionState: "approved", musicAuditionResumeState: "pending",
          musicAuditionResumeAttempts: 0, musicAuditionResumeUpdatedAt: now,
          musicAuditionResumeQueuedAt: undefined, musicAuditionResumeQueueDeadlineAt: undefined,
          musicAuditionResumeTriggerRunId: undefined, musicAuditionResumeLastError: undefined,
          heartbeatAt: now, error: undefined, ...clearExecutionLeasePatch(),
        });
      }
      return { kind: "approved", reused: true, approvalFingerprint: row.approvalFingerprint };
    }
    if (row.decision !== "awaiting" || run.status !== "awaiting_music_audition") {
      throw new Error("music audition checkpoint is no longer awaiting owner approval");
    }
    const approval = createMusicAuditionApproval({
      version: "music-audition-approval/v1",
      checkpointFingerprint: checkpoint.checkpointFingerprint,
      qualityReceiptFingerprint: args.qualityReceiptFingerprint,
      reviewerId: args.reviewerId,
      approvedAt: now,
    });
    await ctx.db.patch(row._id, {
      decision: "approved", reviewerId: args.reviewerId, approvedAt: now,
      qualityReceiptKey: expectedKey, qualityReceiptFingerprint: args.qualityReceiptFingerprint,
      approvalFingerprint: approval.approvalFingerprint,
    });
    await ctx.db.patch(run._id, {
      musicAuditionState: "approved",
      musicAuditionQualityReceiptKey: expectedKey,
      musicAuditionQualityReceiptFingerprint: args.qualityReceiptFingerprint,
      musicAuditionApprovalFingerprint: approval.approvalFingerprint,
      musicAuditionResumeState: "pending",
      musicAuditionResumeAttempts: 0,
      musicAuditionResumeUpdatedAt: now,
      musicAuditionResumeQueuedAt: undefined,
      musicAuditionResumeQueueDeadlineAt: undefined,
      musicAuditionResumeTriggerRunId: undefined,
      musicAuditionResumeLastError: undefined,
      heartbeatAt: now, error: undefined, ...clearExecutionLeasePatch(),
    });
    return { kind: "approved", reused: false, approvalFingerprint: approval.approvalFingerprint };
  },
});

/** Prove an outbox envelope against both the immutable owner decision and the
 * current sealed music stage. This is called before a worker can claim a
 * lease, so the worker has no chance to spend on a substituted track. */
export async function assertApprovedMusicAuditionResume(
  ctx: MusicAuditionCtx,
  args: {
    ownerId: string; channelId: Id<"channels">; runId: Id<"runs">;
    checkpointId: Id<"musicAuditionCheckpoints">; checkpointFingerprint: string;
    qualityReceiptFingerprint: string; approvalFingerprint: string; invocationSha256: string;
  },
): Promise<{ qualityReceiptKey: string }> {
  const run = await ownedRun(ctx, args);
  const row = await ownedCheckpoint(ctx, args.ownerId, args.checkpointId);
  const checkpoint = MusicAuditionCheckpointSchema.parse(row.checkpoint);
  if (
    row.channelId !== args.channelId || row.runId !== args.runId || row.decision !== "approved" ||
    checkpoint.checkpointFingerprint !== validFingerprint(args.checkpointFingerprint, "music audition checkpoint fingerprint") ||
    checkpoint.invocationSha256 !== validFingerprint(args.invocationSha256, "music audition invocation fingerprint") ||
    row.qualityReceiptFingerprint !== validFingerprint(args.qualityReceiptFingerprint, "music audition quality receipt fingerprint") ||
    row.approvalFingerprint !== validFingerprint(args.approvalFingerprint, "music audition approval fingerprint") ||
    run.pipelineInvocationSha256 !== checkpoint.invocationSha256 ||
    run.musicAuditionCheckpointId !== row._id ||
    run.musicAuditionCheckpointFingerprint !== checkpoint.checkpointFingerprint ||
    run.musicAuditionQualityReceiptFingerprint !== row.qualityReceiptFingerprint ||
    run.musicAuditionQualityReceiptKey !== row.qualityReceiptKey ||
    run.musicAuditionApprovalFingerprint !== row.approvalFingerprint ||
    !row.qualityReceiptKey ||
    !["pending", "queued", "consumed"].includes(run.musicAuditionResumeState ?? "")
  ) throw new Error("music audition resume does not match its immutable approval receipt");
  await assertMusicStageIntegrity(ctx, args.runId, checkpoint);
  return { qualityReceiptKey: row.qualityReceiptKey };
}

export const listPendingResumes = query({
  args: { ownerId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "music audition continuation recovery");
    const limit = Math.max(1, Math.min(50, Math.floor(args.limit ?? 25)));
    const runs = await ctx.db.query("runs").withIndex("by_owner_music_audition_resume", q =>
      q.eq("ownerId", args.ownerId).eq("musicAuditionResumeState", "pending"),
    ).take(limit * 2);
    const pending: Array<{
      runId: Id<"runs">; channelId: Id<"channels">; invocationSha256: string;
      checkpointId: Id<"musicAuditionCheckpoints">; checkpointFingerprint: string;
      qualityReceiptFingerprint: string; approvalFingerprint: string; attempt: number;
    }> = [];
    for (const run of runs) {
      if (run.status !== "awaiting_music_audition" || run.musicAuditionState !== "approved") continue;
      const attempt = run.musicAuditionResumeAttempts ?? 0;
      if (
        attempt >= MAX_MUSIC_AUDITION_RESUME_ENQUEUE_ATTEMPTS || !run.pipelineInvocationSha256 ||
        !run.musicAuditionCheckpointId || !run.musicAuditionCheckpointFingerprint ||
        !run.musicAuditionQualityReceiptFingerprint || !run.musicAuditionApprovalFingerprint
      ) continue;
      try {
        await assertApprovedMusicAuditionResume(ctx, {
          ownerId: args.ownerId, channelId: run.channelId, runId: run._id,
          checkpointId: run.musicAuditionCheckpointId,
          checkpointFingerprint: run.musicAuditionCheckpointFingerprint,
          qualityReceiptFingerprint: run.musicAuditionQualityReceiptFingerprint,
          approvalFingerprint: run.musicAuditionApprovalFingerprint,
          invocationSha256: run.pipelineInvocationSha256,
        });
      } catch { continue; }
      pending.push({
        runId: run._id, channelId: run.channelId, invocationSha256: run.pipelineInvocationSha256,
        checkpointId: run.musicAuditionCheckpointId, checkpointFingerprint: run.musicAuditionCheckpointFingerprint,
        qualityReceiptFingerprint: run.musicAuditionQualityReceiptFingerprint,
        approvalFingerprint: run.musicAuditionApprovalFingerprint, attempt,
      });
      if (pending.length >= limit) break;
    }
    return pending;
  },
});

export const markResumeQueued = mutation({
  args: {
    ownerId: v.string(), channelId: v.id("channels"), runId: v.id("runs"), checkpointId: v.id("musicAuditionCheckpoints"),
    checkpointFingerprint: v.string(), qualityReceiptFingerprint: v.string(), approvalFingerprint: v.string(),
    triggerRunId: v.string(), queuedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "music audition continuation enqueue receipt");
    if (!Number.isSafeInteger(args.queuedAt) || args.queuedAt < 0) throw new Error("music audition queue timestamp is invalid");
    const run = await ownedRun(ctx, args);
    if (run.musicAuditionResumeState === "consumed") return { state: "consumed" as const, reused: true };
    if (run.musicAuditionResumeState === "queued") return { state: "queued" as const, reused: true };
    if (run.status !== "awaiting_music_audition" || run.musicAuditionResumeState !== "pending") throw new Error("music audition continuation is not pending");
    await assertApprovedMusicAuditionResume(ctx, { ...args, invocationSha256: run.pipelineInvocationSha256 ?? "" });
    const attempts = (run.musicAuditionResumeAttempts ?? 0) + 1;
    if (attempts > MAX_MUSIC_AUDITION_RESUME_ENQUEUE_ATTEMPTS) {
      await blockResume(ctx, run, await ownedCheckpoint(ctx, args.ownerId, args.checkpointId), args.queuedAt, "music audition continuation exceeded bounded delivery attempts");
      return { state: "blocked" as const, attempts };
    }
    const deadline = args.queuedAt + MUSIC_AUDITION_RESUME_QUEUE_LEASE_MS;
    if (!Number.isSafeInteger(deadline)) throw new Error("music audition queue deadline is invalid");
    await ctx.db.patch(run._id, {
      musicAuditionResumeState: "queued", musicAuditionResumeAttempts: attempts, musicAuditionResumeUpdatedAt: args.queuedAt,
      musicAuditionResumeQueuedAt: args.queuedAt, musicAuditionResumeQueueDeadlineAt: deadline,
      musicAuditionResumeTriggerRunId: validText(args.triggerRunId, "music audition Trigger run id", 300), musicAuditionResumeLastError: undefined,
    });
    return { state: "queued" as const, reused: false };
  },
});

export const recordResumeEnqueueFailure = mutation({
  args: {
    ownerId: v.string(), channelId: v.id("channels"), runId: v.id("runs"), checkpointId: v.id("musicAuditionCheckpoints"),
    checkpointFingerprint: v.string(), qualityReceiptFingerprint: v.string(), approvalFingerprint: v.string(), error: v.string(), failedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "music audition continuation enqueue failure");
    const run = await ownedRun(ctx, args);
    const row = await ownedCheckpoint(ctx, args.ownerId, args.checkpointId);
    const error = validText(args.error, "music audition continuation error");
    await assertApprovedMusicAuditionResume(ctx, { ...args, invocationSha256: run.pipelineInvocationSha256 ?? "" });
    if (run.musicAuditionResumeState === "consumed" || run.musicAuditionResumeState === "queued") return { state: run.musicAuditionResumeState, reused: true };
    const attempts = (run.musicAuditionResumeAttempts ?? 0) + 1;
    if (attempts >= MAX_MUSIC_AUDITION_RESUME_ENQUEUE_ATTEMPTS) {
      await blockResume(ctx, run, row, args.failedAt, `music audition continuation could not be enqueued after ${attempts} bounded attempts: ${error}`);
      return { state: "blocked" as const, attempts };
    }
    await ctx.db.patch(run._id, {
      musicAuditionResumeState: "pending", musicAuditionResumeAttempts: attempts, musicAuditionResumeUpdatedAt: args.failedAt,
      musicAuditionResumeQueuedAt: undefined, musicAuditionResumeQueueDeadlineAt: undefined,
      musicAuditionResumeTriggerRunId: undefined, musicAuditionResumeLastError: error,
    });
    return { state: "pending" as const, attempts };
  },
});

export const reapExpiredQueuedResumes = mutation({
  args: { ownerId: v.string(), now: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "music audition queued continuation recovery");
    if (!Number.isSafeInteger(args.now) || args.now < 0) throw new Error("music audition recovery timestamp is invalid");
    const limit = Math.max(1, Math.min(50, Math.floor(args.limit ?? 25)));
    const rows = await ctx.db.query("runs").withIndex("by_owner_music_audition_resume_queue_deadline", q =>
      q.eq("ownerId", args.ownerId).eq("musicAuditionResumeState", "queued"),
    ).take(limit * 2);
    let requeued = 0; let blocked = 0;
    for (const run of rows) {
      const deadline = musicResumeQueueDeadline(run);
      if (deadline !== undefined && deadline > args.now) continue;
      const row = run.musicAuditionCheckpointId ? await ownedCheckpoint(ctx, args.ownerId, run.musicAuditionCheckpointId).catch(() => null) : null;
      if (
        run.status !== "awaiting_music_audition" || run.musicAuditionState !== "approved" || !row ||
        !run.musicAuditionCheckpointFingerprint || !run.musicAuditionQualityReceiptFingerprint ||
        !run.musicAuditionApprovalFingerprint || !run.pipelineInvocationSha256 ||
        (run.musicAuditionResumeAttempts ?? 0) >= MAX_MUSIC_AUDITION_RESUME_ENQUEUE_ATTEMPTS
      ) {
        await blockResume(ctx, run, row, args.now, "music audition queued continuation cannot be safely reissued; manual reconciliation is required");
        blocked++; continue;
      }
      try {
        await assertApprovedMusicAuditionResume(ctx, {
          ownerId: args.ownerId, channelId: run.channelId, runId: run._id, checkpointId: row._id,
          checkpointFingerprint: run.musicAuditionCheckpointFingerprint,
          qualityReceiptFingerprint: run.musicAuditionQualityReceiptFingerprint,
          approvalFingerprint: run.musicAuditionApprovalFingerprint, invocationSha256: run.pipelineInvocationSha256,
        });
      } catch (error) {
        await blockResume(ctx, run, row, args.now, `music audition queued continuation integrity check failed: ${error instanceof Error ? error.message : String(error)}`);
        blocked++; continue;
      }
      await ctx.db.patch(run._id, {
        musicAuditionResumeState: "pending", musicAuditionResumeUpdatedAt: args.now,
        musicAuditionResumeQueuedAt: undefined, musicAuditionResumeQueueDeadlineAt: undefined,
        musicAuditionResumeTriggerRunId: undefined,
        musicAuditionResumeLastError: "accepted Trigger delivery expired before execution claim; reissuing exact immutable receipt",
      });
      requeued++;
    }
    return { requeued, blocked };
  },
});

export async function terminalizeMusicAuditionResumeForLease(
  ctx: MutationCtx,
  args: { ownerId: string; channelId: Id<"channels">; runId: Id<"runs">; reason: string; now: number },
): Promise<void> {
  const run = await ownedRun(ctx, args);
  const row = run.musicAuditionCheckpointId ? await ownedCheckpoint(ctx, args.ownerId, run.musicAuditionCheckpointId).catch(() => null) : null;
  await blockResume(ctx, run, row, args.now, args.reason);
}

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
    await ctx.db.patch(row._id, {
      decision: "rejected", reviewerId: args.reviewerId, rejectedAt: now,
      blockedAt: now, blockedReason: reason,
    });
    await ctx.db.patch(run._id, {
      status: "music_audition_rejected", musicAuditionState: "rejected", error: reason,
      musicAuditionResumeState: "blocked", musicAuditionResumeUpdatedAt: now,
      musicAuditionResumeQueueDeadlineAt: undefined, musicAuditionResumeLastError: reason,
      finishedAt: now, heartbeatAt: now, ...clearExecutionLeasePatch(),
    });
    return { kind: "rejected", reused: false };
  },
});
