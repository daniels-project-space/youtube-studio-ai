import { mutation, query } from "./studioFunctions";
import { query as publicQuery } from "./_generated/server";
import { v } from "convex/values";
import { evaluateConvexAuthProbeIdentity } from "../src/lib/convexAuthProbe";
import {
  decidePipelineInvocationClaim,
  normalizePipelineInvocationSnapshot,
  type PipelineInvocationSnapshot,
} from "../src/lib/pipelineInvocationSnapshot";
import {
  completedPublishContinuationPatch,
  requireExactBoundPublishIntent,
} from "./publishContinuationState";

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
    status: v.optional(v.string()),
  },
  returns: v.id("runs"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("runs", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      status: args.status ?? "queued",
      startedAt: Date.now(),
      costTotal: 0,
    });
  },
});

/**
 * Atomically installs the exact pre-provider invocation once. A replay may
 * only present the byte-equivalent normalized snapshot. Legacy runs with any
 * execution evidence fail closed because their original inputs are unknowable.
 */
export const claimInvocationSnapshot = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    snapshot: v.any(),
    sha256: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`run not found: ${args.runId}`);
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
    intentId: v.id("publishIntents"),
    artifactId: v.string(),
    youtubeVideoId: v.string(),
    preparedAt: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (!args.youtubeVideoId.trim() || !Number.isFinite(args.preparedAt) || args.preparedAt < 0) {
      throw new Error("publish continuation upload identity/timestamp is invalid");
    }
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`publish continuation run not found: ${args.runId}`);
    if (run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
      throw new Error("publish continuation run ownership/channel mismatch");
    }
    if (
      run.publishContinuationState === "completed" &&
      run.publishContinuationIntentId === args.intentId &&
      run.publishContinuationArtifactId === args.artifactId &&
      run.publishContinuationVideoId === args.youtubeVideoId &&
      run.youtubeVideoId === args.youtubeVideoId
    ) {
      return run;
    }
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
    intentId: v.id("publishIntents"),
    artifactId: v.string(),
    youtubeVideoId: v.string(),
    triggerRunId: v.string(),
    queuedAt: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`publish continuation run not found: ${args.runId}`);
    if (run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
      throw new Error("publish continuation queue ownership/channel mismatch");
    }
    if (
      run.publishContinuationState === "completed" &&
      run.publishContinuationIntentId === args.intentId &&
      run.publishContinuationArtifactId === args.artifactId &&
      run.publishContinuationVideoId === args.youtubeVideoId
    ) {
      return run;
    }
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
      run.youtubeVideoId !== args.youtubeVideoId ||
      !["pending", "queued"].includes(run.publishContinuationState ?? "")
    ) {
      throw new Error("publish continuation queue outbox identity/state mismatch");
    }
    if (!args.triggerRunId.trim() || !Number.isFinite(args.queuedAt) || args.queuedAt < 0) {
      throw new Error("publish continuation queue receipt is invalid");
    }
    await ctx.db.patch(args.runId, {
      publishContinuationState: "queued",
      publishContinuationAttempts: (run.publishContinuationAttempts ?? 0) + 1,
      publishContinuationUpdatedAt: args.queuedAt,
      publishContinuationQueuedAt: args.queuedAt,
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
    intentId: v.id("publishIntents"),
    artifactId: v.string(),
    youtubeVideoId: v.string(),
    error: v.string(),
    failedAt: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`publish continuation run not found: ${args.runId}`);
    if (run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
      throw new Error("publish continuation failure ownership/channel mismatch");
    }
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
    await ctx.db.patch(args.runId, {
      publishContinuationState: "pending",
      publishContinuationAttempts: (run.publishContinuationAttempts ?? 0) + 1,
      publishContinuationUpdatedAt: args.failedAt,
      publishContinuationLastError: args.error.slice(0, 1_000),
    });
    return await ctx.db.get(args.runId);
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
    finishedAt: v.number(),
    costTotal: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.finishedAt) || !Number.isFinite(args.costTotal) || args.costTotal < 0) {
      throw new Error("run completion values are invalid");
    }
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`run not found: ${args.runId}`);
    if (run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
      throw new Error("run completion ownership/channel mismatch");
    }
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { runId, ...rest } = args;
    const existing = await ctx.db.get(runId);
    if (!existing) throw new Error(`run not found: ${runId}`);
    const patch: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(rest)) {
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch(runId, patch);
    return null;
  },
});

export const getRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.runId);
  },
});

export const listRunsByChannel = query({
  args: { channelId: v.id("channels"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const source = ctx.db
      .query("runs")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .order("desc");
    return args.limit ? await source.take(Math.min(500, Math.max(1, args.limit))) : await source.collect();
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
    const active = runs.filter(
      (r) => r.status === "queued" || r.status === "running",
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
    // Index desc ≈ startedAt desc (startedAt is stamped at insert) — take the
    // page directly instead of collecting every owner run then slicing.
    const limited = await ctx.db
      .query("runs")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .order("desc")
      .take(args.limit ?? 10);
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
          channelName: channel?.name ?? "(unknown)",
          channelSlug: channel?.slug ?? "",
        };
      }),
    );
  },
});
