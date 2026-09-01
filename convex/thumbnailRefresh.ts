import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import {
  assessThumbnailRefreshEvidence,
  type ThumbnailRefreshAsset,
} from "../src/lib/thumbnailRefreshInventory";
import { assessThumbnailRefreshReplay } from "../src/lib/thumbnailRefreshReplay";
import { normalizeReleaseEvidenceStatus } from "../src/lib/releaseEvidenceStatus";
import { RUN_QUEUE_LEASE_MS } from "../src/lib/runLease";
import {
  THUMBNAIL_REFRESH_DISPATCH_VERSION,
  THUMBNAIL_REFRESH_MAXIMUM_COST_USD,
  thumbnailRefreshDispatchKey,
} from "../src/lib/thumbnailRefreshCandidate";
import { assessLegacyVideoCleanup } from "../src/lib/legacyVideoCleanup";

const MAX_DISPATCH_ATTEMPTS = 3;
type DbCtx = Pick<QueryCtx | MutationCtx, "db">;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

async function replayForRun(
  ctx: DbCtx,
  ownerId: string,
  run: {
    _id: Id<"runs">;
    channelId: Id<"channels">;
    pipelineInvocationSnapshot?: unknown;
    pipelineInvocationSha256?: string;
  },
) {
  const stages = await ctx.db
    .query("runStages")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .collect();
  return {
    stages,
    replay: assessThumbnailRefreshReplay({
      ownerId,
      channelId: String(run.channelId),
      runId: String(run._id),
      pipelineInvocationSnapshot: run.pipelineInvocationSnapshot,
      pipelineInvocationSha256: run.pipelineInvocationSha256,
      stages: stages.map((stage) => ({ block: stage.block, outputs: stage.outputs })),
    }),
  };
}

async function assertFinishedSource(
  ctx: DbCtx,
  run: { _id: Id<"runs">; status: string; youtubeVideoId?: string },
) {
  const assets = await ctx.db
    .query("assets")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .collect();
  const video = assets.find((asset) => asset.kind === "video");
  if (!run.youtubeVideoId && (!video || run.status === "failed")) {
    throw new Error("thumbnail refresh source is not a retained finished video");
  }
  return assets;
}

function assertNow(now: number) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("thumbnail refresh timestamp is invalid");
  }
}

/**
 * Read-only inventory for the first, safe stage of a legacy thumbnail refresh.
 *
 * It neither creates a candidate nor records an owner acceptance. The only
 * decision it makes is whether the persisted thumbnail has an exact, run-bound
 * current-Golden provenance marker. Release-evidence status is returned as
 * adjacent context only; a final-master certificate never upgrades thumbnail
 * provenance.
 */
export const listInventory = query({
  args: {
    ownerId: v.string(),
    channelId: v.optional(v.id("channels")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 200, 300));
    const source = args.channelId
      ? ctx.db
          .query("runs")
          .withIndex("by_channel", (q) => q.eq("channelId", args.channelId!))
          .order("desc")
      : ctx.db
          .query("runs")
          .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
          .order("desc");

    const channels = new Map<string, { name: string; slug: string; family?: string } | null>();
    const channelFor = async (channelId: Id<"channels">) => {
      const cacheKey = String(channelId);
      if (channels.has(cacheKey)) return channels.get(cacheKey)!;
      const channel = await ctx.db.get(channelId);
      const value = channel
        ? {
            name: channel.name,
            slug: channel.slug,
            family:
              channel.family ??
              channel.contentLane?.family ??
              channel.identity.programBrief?.family,
          }
        : null;
      channels.set(cacheKey, value);
      return value;
    };

    const rows: Array<Record<string, unknown>> = [];
    const candidates = new Map<string, Record<string, unknown>>();
    for await (const run of source) {
      if (rows.length >= limit) break;
      if (run.ownerId !== args.ownerId) continue;

      // Candidate runs are newer than their source and travel through the
      // same owner/channel index. Capture the latest candidate projection,
      // then keep it out of the finished-video inventory itself.
      if (run.thumbnailRefreshSourceRunId) {
        const sourceId = String(run.thumbnailRefreshSourceRunId);
        if (!candidates.has(sourceId)) candidates.set(sourceId, run as unknown as Record<string, unknown>);
        continue;
      }

      const assets = await ctx.db
        .query("assets")
        .withIndex("by_run", (q) => q.eq("runId", run._id))
        .collect();
      const videoAsset = assets.find((asset) => asset.kind === "video");
      const isFinished = Boolean(run.youtubeVideoId) ||
        (Boolean(videoAsset) && run.status !== "failed");
      if (!isFinished) continue;

      // Keep selection aligned with the Studio's existing video query. This
      // inventory reports provenance for the thumbnail users currently see;
      // it does not choose a newer asset or silently replace anything.
      const thumbnail = assets.find((asset) => asset.kind === "thumbnail");
      const assessment = assessThumbnailRefreshEvidence(
        thumbnail
          ? {
              ownerId: thumbnail.ownerId,
              channelId: String(thumbnail.channelId),
              runId: thumbnail.runId ? String(thumbnail.runId) : undefined,
              kind: thumbnail.kind,
              r2Key: thumbnail.r2Key,
              meta: thumbnail.meta,
            } satisfies ThumbnailRefreshAsset
          : null,
      );

      const [channel, replayInput] = await Promise.all([
        channelFor(run.channelId),
        replayForRun(ctx, args.ownerId, run),
      ]);
      const stages = replayInput.stages;
      const metadataStage = stages.find((stage) => stage.block === "metadata" || stage.block === "quiz_metadata");
      const metadata = record(metadataStage?.outputs);
      const thumbnailMeta = record(thumbnail?.meta);
      const title =
        text(metadata?.title) ??
        text(thumbnailMeta?.thumbnailTitle) ??
        text(thumbnailMeta?.title) ??
        channel?.name ??
        "Untitled video";

      const replay = replayInput.replay;
      const cleanup = assessLegacyVideoCleanup({
        youtubeVideoId: run.youtubeVideoId,
        runStatus: run.status,
        title,
        channelFamily: channel?.family,
        releaseEvidenceStatus: run.releaseEvidenceStatus,
      });
      const retirement = cleanup.action === "retire" && run.youtubeVideoId
        ? await ctx.db
            .query("youtubeVideoRetirements")
            .withIndex("by_owner_video", (q) => q
              .eq("ownerId", args.ownerId)
              .eq("youtubeVideoId", run.youtubeVideoId!))
            .unique()
        : null;
      const candidate = candidates.get(String(run._id));
      const candidateAssets = candidate
        ? await ctx.db
            .query("assets")
            .withIndex("by_run", (q) => q.eq("runId", candidate._id as Id<"runs">))
            .collect()
        : [];
      const candidateThumbnail = candidateAssets.find((asset) => asset.kind === "thumbnail");

      rows.push({
        runId: run._id,
        channelId: run.channelId,
        channelName: channel?.name ?? "(unknown)",
        channelSlug: channel?.slug ?? "",
        title,
        createdAt: run.startedAt ?? run._creationTime,
        status: run.status,
        youtubeVideoId: run.youtubeVideoId,
        thumbnailKey: thumbnail?.r2Key ?? null,
        thumbnailEvidenceStatus: assessment.status,
        refreshAction: assessment.action,
        evidenceReason: assessment.reason,
        // Deliberately adjacent rather than part of `assessment`: release
        // proof is evidence for the video master, never a thumbnail upgrade.
        releaseEvidenceStatus: normalizeReleaseEvidenceStatus(run.releaseEvidenceStatus),
        // A legacy thumbnail may be regenerated only from the same frozen
        // package/route/style inputs. Never use the current channel config to
        // make a deceptive "refresh" for a historic video.
        thumbnailReplayStatus: replay.status,
        thumbnailReplayReason: replay.reason,
        legacyCleanupAction: cleanup.action,
        legacyCleanupReason: cleanup.reason,
        legacyCleanupExplanation: cleanup.explanation,
        ...(retirement ? {
          retirementId: String(retirement._id),
          retirementStatus: retirement.status,
          retirementError: retirement.lastError,
          retirementReceiptFingerprint: retirement.deletionReceiptFingerprint,
        } : {}),
        ...(candidate ? {
          candidateRunId: String(candidate._id),
          candidateStatus: candidate.status,
          candidateDispatchState: candidate.thumbnailRefreshDispatchState,
          candidateDispatchLastError: candidate.thumbnailRefreshDispatchLastError,
          candidateCostTotal: candidate.costTotal,
          candidateThumbnailKey: candidateThumbnail?.r2Key ?? null,
        } : {}),
      });
    }

    rows.sort((left, right) => Number(right.createdAt) - Number(left.createdAt));
    return rows;
  },
});

/**
 * Allocate one idempotent no-video candidate run for the exact frozen source
 * replay. This mutation is service-only: a browser can express intent through
 * the authenticated API, but cannot manufacture replay material or an outbox.
 */
export const createCandidateShell = mutation({
  args: {
    ownerId: v.string(),
    sourceRunId: v.id("runs"),
    now: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "thumbnail refresh candidate shell");
    assertNow(args.now);
    const source = await ctx.db.get(args.sourceRunId);
    if (!source || source.ownerId !== args.ownerId || source.thumbnailRefreshSourceRunId) {
      throw new Error("thumbnail refresh source is not owned by this operator");
    }
    await assertFinishedSource(ctx, source);
    const { replay } = await replayForRun(ctx, args.ownerId, source);
    if (replay.status !== "ready_for_thumbnail_only") {
      throw new Error(replay.reason);
    }
    const replayFingerprint = replay.material.replayFingerprint;
    const dispatchKey = thumbnailRefreshDispatchKey({
      ownerId: args.ownerId,
      sourceRunId: String(source._id),
      replayFingerprint,
    });
    const existing = await ctx.db
      .query("runs")
      .withIndex("by_owner_thumbnail_refresh_source", (q) => q
        .eq("ownerId", args.ownerId)
        .eq("thumbnailRefreshSourceRunId", source._id)
        .eq("thumbnailRefreshReplayFingerprint", replayFingerprint))
      .unique();
    if (existing) {
      if (existing.channelId !== source.channelId || existing.thumbnailRefreshDispatchKey !== dispatchKey) {
        throw new Error("thumbnail refresh candidate identity conflict");
      }
      return {
        state: "reused",
        candidateRunId: existing._id,
        channelId: existing.channelId,
        sourceRunId: source._id,
        replayFingerprint,
        candidateStatus: existing.status,
        dispatchState: existing.thumbnailRefreshDispatchState,
      };
    }
    const candidateRunId = await ctx.db.insert("runs", {
      ownerId: args.ownerId,
      channelId: source.channelId,
      status: "queued",
      startedAt: args.now,
      costTotal: 0,
      releaseEvidenceStatus: "not_ready",
      releaseEvidenceUpdatedAt: args.now,
      heartbeatAt: args.now,
      selfHealGeneration: 0,
      leaseExpiresAt: args.now + RUN_QUEUE_LEASE_MS,
      thumbnailRefreshSourceRunId: source._id,
      thumbnailRefreshReplayFingerprint: replayFingerprint,
      thumbnailRefreshDispatchKey: dispatchKey,
      thumbnailRefreshDispatchState: "awaiting_approval",
      thumbnailRefreshDispatchAttempts: 0,
      thumbnailRefreshDispatchUpdatedAt: args.now,
    });
    return {
      state: "created",
      candidateRunId,
      channelId: source.channelId,
      sourceRunId: source._id,
      replayFingerprint,
      candidateStatus: "queued",
      dispatchState: "awaiting_approval",
    };
  },
});

export const claimCandidateApproval = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    sourceRunId: v.id("runs"),
    candidateRunId: v.id("runs"),
    replayFingerprint: v.string(),
    maximumCostUsd: v.number(),
    approval: v.any(),
    approvalFingerprint: v.string(),
    now: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "thumbnail refresh owner approval claim");
    assertNow(args.now);
    if (
      !/^[a-f0-9]{64}$/.test(args.replayFingerprint) ||
      !/^[a-f0-9]{64}$/.test(args.approvalFingerprint) ||
      !Number.isFinite(args.maximumCostUsd) ||
      args.maximumCostUsd <= 0 ||
      args.maximumCostUsd > THUMBNAIL_REFRESH_MAXIMUM_COST_USD
    ) {
      throw new Error("thumbnail refresh owner approval claim is invalid");
    }
    const run = await ctx.db.get(args.candidateRunId);
    if (
      !run ||
      run.ownerId !== args.ownerId ||
      run.channelId !== args.channelId ||
      run.thumbnailRefreshSourceRunId !== args.sourceRunId ||
      run.thumbnailRefreshReplayFingerprint !== args.replayFingerprint
    ) {
      throw new Error("thumbnail refresh candidate approval identity mismatch");
    }
    if (run.thumbnailRefreshApproval !== undefined) {
      if (
        run.thumbnailRefreshApprovalFingerprint !== args.approvalFingerprint ||
        run.thumbnailRefreshMaximumCostUsd !== args.maximumCostUsd
      ) {
        throw new Error("thumbnail refresh candidate is already bound to different authority");
      }
      return run;
    }
    if (run.thumbnailRefreshDispatchState !== "awaiting_approval") {
      throw new Error("thumbnail refresh candidate is not awaiting owner approval");
    }
    await ctx.db.patch(run._id, {
      thumbnailRefreshMaximumCostUsd: args.maximumCostUsd,
      thumbnailRefreshApproval: args.approval,
      thumbnailRefreshApprovalFingerprint: args.approvalFingerprint,
      thumbnailRefreshDispatchState: "pending",
      thumbnailRefreshDispatchUpdatedAt: args.now,
      thumbnailRefreshDispatchLastError: undefined,
    });
    return await ctx.db.get(run._id);
  },
});

export const getCandidateDispatch = query({
  args: { ownerId: v.string(), candidateRunId: v.id("runs") },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "thumbnail refresh dispatch read");
    const run = await ctx.db.get(args.candidateRunId);
    if (!run || run.ownerId !== args.ownerId) return null;
    if (
      !run.thumbnailRefreshSourceRunId ||
      !run.thumbnailRefreshReplayFingerprint ||
      !run.thumbnailRefreshDispatchKey ||
      !run.thumbnailRefreshMaximumCostUsd ||
      !run.thumbnailRefreshApproval ||
      !run.thumbnailRefreshApprovalFingerprint
    ) return null;
    return {
      version: THUMBNAIL_REFRESH_DISPATCH_VERSION,
      ownerId: run.ownerId,
      channelId: String(run.channelId),
      sourceRunId: String(run.thumbnailRefreshSourceRunId),
      candidateRunId: String(run._id),
      replayFingerprint: run.thumbnailRefreshReplayFingerprint,
      maximumCostUsd: run.thumbnailRefreshMaximumCostUsd,
      approval: run.thumbnailRefreshApproval,
      approvalFingerprint: run.thumbnailRefreshApprovalFingerprint,
      dispatchKey: run.thumbnailRefreshDispatchKey,
      dispatchAttempt: run.thumbnailRefreshDispatchAttempts ?? 0,
    };
  },
});

export const listPendingCandidateDispatches = query({
  args: { ownerId: v.string(), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "thumbnail refresh pending dispatch list");
    const limit = Math.max(1, Math.min(25, Math.floor(args.limit ?? 10)));
    const rows = await ctx.db
      .query("runs")
      .withIndex("by_owner_thumbnail_refresh_dispatch", (q) => q
        .eq("ownerId", args.ownerId)
        .eq("thumbnailRefreshDispatchState", "pending"))
      .take(limit);
    return rows.map((run) => ({ candidateRunId: run._id }));
  },
});

export const reapExpiredCandidateDispatches = mutation({
  args: { ownerId: v.string(), now: v.number(), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "thumbnail refresh queued dispatch recovery");
    assertNow(args.now);
    const limit = Math.max(1, Math.min(25, Math.floor(args.limit ?? 10)));
    const expired = await ctx.db
      .query("runs")
      .withIndex("by_owner_thumbnail_refresh_dispatch", (q) => q
        .eq("ownerId", args.ownerId)
        .eq("thumbnailRefreshDispatchState", "queued")
        .lte("thumbnailRefreshDispatchQueueDeadlineAt", args.now))
      .take(limit);
    let requeued = 0;
    let blocked = 0;
    for (const run of expired) {
      const attempts = run.thumbnailRefreshDispatchAttempts ?? 0;
      if (attempts >= MAX_DISPATCH_ATTEMPTS) {
        const error = "thumbnail refresh candidate delivery exhausted before the worker claimed it";
        await ctx.db.patch(run._id, {
          status: "failed",
          finishedAt: args.now,
          error,
          leaseExpiresAt: undefined,
          thumbnailRefreshDispatchState: "blocked",
          thumbnailRefreshDispatchUpdatedAt: args.now,
          thumbnailRefreshDispatchQueueDeadlineAt: undefined,
          thumbnailRefreshDispatchLastError: error,
        });
        blocked++;
      } else {
        await ctx.db.patch(run._id, {
          thumbnailRefreshDispatchState: "pending",
          thumbnailRefreshDispatchUpdatedAt: args.now,
          thumbnailRefreshDispatchQueueDeadlineAt: undefined,
          thumbnailRefreshDispatchLastError: "queued delivery was not claimed before its bounded deadline",
        });
        requeued++;
      }
    }
    return { checked: expired.length, requeued, blocked };
  },
});

export const markCandidateDispatchQueued = mutation({
  args: {
    ownerId: v.string(),
    candidateRunId: v.id("runs"),
    triggerRunId: v.string(),
    attempt: v.number(),
    now: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "thumbnail refresh queue acknowledgement");
    assertNow(args.now);
    const run = await ctx.db.get(args.candidateRunId);
    if (!run || run.ownerId !== args.ownerId) throw new Error("thumbnail refresh candidate not found");
    if (run.thumbnailRefreshDispatchState === "consumed") return run;
    const current = run.thumbnailRefreshDispatchAttempts ?? 0;
    if (run.thumbnailRefreshDispatchState === "queued" && args.attempt <= current) return run;
    if (
      run.thumbnailRefreshDispatchState !== "pending" ||
      !Number.isSafeInteger(args.attempt) ||
      args.attempt !== current + 1 ||
      !args.triggerRunId.trim()
    ) throw new Error("thumbnail refresh queue acknowledgement is stale or invalid");
    await ctx.db.patch(run._id, {
      thumbnailRefreshDispatchState: "queued",
      thumbnailRefreshDispatchAttempts: args.attempt,
      thumbnailRefreshDispatchUpdatedAt: args.now,
      thumbnailRefreshDispatchQueuedAt: args.now,
      thumbnailRefreshDispatchQueueDeadlineAt: args.now + RUN_QUEUE_LEASE_MS,
      thumbnailRefreshDispatchTriggerRunId: args.triggerRunId,
      thumbnailRefreshDispatchLastError: undefined,
    });
    return await ctx.db.get(run._id);
  },
});

export const recordCandidateDispatchFailure = mutation({
  args: {
    ownerId: v.string(),
    candidateRunId: v.id("runs"),
    attempt: v.number(),
    error: v.string(),
    now: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "thumbnail refresh enqueue failure");
    assertNow(args.now);
    const run = await ctx.db.get(args.candidateRunId);
    if (!run || run.ownerId !== args.ownerId) throw new Error("thumbnail refresh candidate not found");
    if (["queued", "consumed", "blocked"].includes(run.thumbnailRefreshDispatchState ?? "")) return run;
    const current = run.thumbnailRefreshDispatchAttempts ?? 0;
    if (run.thumbnailRefreshDispatchState !== "pending" || args.attempt !== current + 1) {
      return run;
    }
    const error = args.error.trim().slice(0, 1_000) || "thumbnail refresh Trigger enqueue failed";
    const blocked = args.attempt >= MAX_DISPATCH_ATTEMPTS;
    await ctx.db.patch(run._id, {
      ...(blocked ? { status: "failed", finishedAt: args.now, leaseExpiresAt: undefined } : {}),
      thumbnailRefreshDispatchState: blocked ? "blocked" : "pending",
      thumbnailRefreshDispatchAttempts: args.attempt,
      thumbnailRefreshDispatchUpdatedAt: args.now,
      thumbnailRefreshDispatchQueueDeadlineAt: undefined,
      thumbnailRefreshDispatchLastError: error,
      ...(blocked ? { error } : {}),
    });
    return await ctx.db.get(run._id);
  },
});

export const consumeCandidateDispatch = mutation({
  args: { ownerId: v.string(), candidateRunId: v.id("runs"), now: v.number() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "thumbnail refresh dispatch consumption");
    assertNow(args.now);
    const run = await ctx.db.get(args.candidateRunId);
    if (!run || run.ownerId !== args.ownerId) throw new Error("thumbnail refresh candidate not found");
    if (run.thumbnailRefreshDispatchState === "consumed") return run;
    if (!run.thumbnailRefreshApproval || !["pending", "queued"].includes(run.thumbnailRefreshDispatchState ?? "")) {
      throw new Error("thumbnail refresh candidate has no consumable owner-approved dispatch");
    }
    await ctx.db.patch(run._id, {
      thumbnailRefreshDispatchState: "consumed",
      thumbnailRefreshDispatchUpdatedAt: args.now,
      thumbnailRefreshDispatchQueueDeadlineAt: undefined,
      thumbnailRefreshDispatchLastError: undefined,
    });
    return await ctx.db.get(run._id);
  },
});

export const getCandidateExecution = query({
  args: { ownerId: v.string(), candidateRunId: v.id("runs") },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "thumbnail refresh execution reload");
    const candidate = await ctx.db.get(args.candidateRunId);
    if (!candidate || candidate.ownerId !== args.ownerId || !candidate.thumbnailRefreshSourceRunId) return null;
    const source = await ctx.db.get(candidate.thumbnailRefreshSourceRunId);
    if (!source || source.ownerId !== args.ownerId || source.channelId !== candidate.channelId) {
      throw new Error("thumbnail refresh source/candidate binding is invalid");
    }
    await assertFinishedSource(ctx, source);
    const { replay } = await replayForRun(ctx, args.ownerId, source);
    if (
      replay.status !== "ready_for_thumbnail_only" ||
      replay.material.replayFingerprint !== candidate.thumbnailRefreshReplayFingerprint
    ) {
      throw new Error("thumbnail refresh source replay is no longer byte-identical to the candidate claim");
    }
    const channel = await ctx.db.get(candidate.channelId);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("thumbnail refresh channel is unavailable");
    }
    return { candidate, source, channelSlug: channel.slug, material: replay.material };
  },
});
