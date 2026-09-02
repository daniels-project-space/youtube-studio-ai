import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import { canonicalJson } from "../src/lib/canonicalJson";
import { sha256Hex } from "../src/lib/sha256";
import {
  assessThumbnailRefreshEvidence,
  type ThumbnailRefreshAsset,
} from "../src/lib/thumbnailRefreshInventory";
import {
  YOUTUBE_THUMBNAIL_REPLACEMENT_VERSION,
  youtubeThumbnailReplacementDispatchKey,
  youtubeThumbnailReplacementPlanFingerprint,
} from "../src/lib/youtubeThumbnailReplacement";
import { assessLegacyVideoCleanup } from "../src/lib/legacyVideoCleanup";

const MAX_ATTEMPTS = 3;
type DbCtx = Pick<QueryCtx | MutationCtx, "db">;

function assertNow(now: number) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("YouTube thumbnail replacement timestamp is invalid");
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function candidateThumbnail(
  ctx: DbCtx,
  ownerId: string,
  channelId: Id<"channels">,
  candidateRunId: Id<"runs">,
) {
  const thumbnails = (await ctx.db
    .query("assets")
    .withIndex("by_run", (q) => q.eq("runId", candidateRunId))
    .collect())
    .filter((asset) => asset.kind === "thumbnail");
  if (thumbnails.length !== 1) {
    throw new Error("YouTube thumbnail replacement requires exactly one candidate thumbnail");
  }
  const thumbnail = thumbnails[0];
  const assessment = assessThumbnailRefreshEvidence({
    ownerId: thumbnail.ownerId,
    channelId: String(thumbnail.channelId),
    runId: thumbnail.runId ? String(thumbnail.runId) : undefined,
    kind: thumbnail.kind,
    r2Key: thumbnail.r2Key,
    meta: thumbnail.meta,
  } satisfies ThumbnailRefreshAsset);
  const evidence = record(record(thumbnail.meta)?.thumbnailCurrentCandidateEvidence);
  const artifactSha256 = typeof evidence?.artifactSha256 === "string"
    ? evidence.artifactSha256
    : "";
  if (
    thumbnail.ownerId !== ownerId ||
    thumbnail.channelId !== channelId ||
    thumbnail.runId !== candidateRunId ||
    assessment.status !== "current_golden_candidate" ||
    !/^[a-f0-9]{64}$/.test(artifactSha256)
  ) throw new Error("YouTube thumbnail replacement candidate lacks current QA-bound provenance");
  return { thumbnail, artifactSha256 };
}

async function sourceTitle(ctx: DbCtx, runId: Id<"runs">, fallback: string) {
  const stages = await ctx.db
    .query("runStages")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .collect();
  for (const stage of stages) {
    if (stage.block !== "metadata" && stage.block !== "quiz_metadata") continue;
    const title = record(stage.outputs)?.title;
    if (typeof title === "string" && title.trim()) return title.trim();
  }
  return fallback;
}

export const createPlanShell = mutation({
  args: {
    ownerId: v.string(),
    sourceRunId: v.id("runs"),
    candidateRunId: v.id("runs"),
    youtubeVideoId: v.string(),
    now: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "YouTube thumbnail replacement plan");
    assertNow(args.now);
    const [source, candidate] = await Promise.all([
      ctx.db.get(args.sourceRunId),
      ctx.db.get(args.candidateRunId),
    ]);
    if (
      !source || source.ownerId !== args.ownerId ||
      source.youtubeVideoId !== args.youtubeVideoId ||
      !candidate || candidate.ownerId !== args.ownerId ||
      candidate.channelId !== source.channelId ||
      candidate.thumbnailRefreshSourceRunId !== source._id ||
      candidate.status !== "ok"
    ) throw new Error("YouTube thumbnail replacement source/candidate binding is invalid");
    const channel = await ctx.db.get(source.channelId);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("YouTube thumbnail replacement channel is unavailable");
    }
    const cleanup = assessLegacyVideoCleanup({
      youtubeVideoId: source.youtubeVideoId,
      runStatus: source.status,
      title: await sourceTitle(ctx, source._id, channel.name),
      channelFamily:
        channel.family ??
        channel.contentLane?.family ??
        channel.identity.programBrief?.family,
      releaseEvidenceStatus: source.releaseEvidenceStatus,
    });
    if (cleanup.action !== "keep") {
      throw new Error("Retired legacy videos cannot receive replacement thumbnails");
    }
    const { thumbnail, artifactSha256 } = await candidateThumbnail(
      ctx,
      args.ownerId,
      source.channelId,
      candidate._id,
    );
    const connectors = await ctx.db
      .query("youtubeAuth")
      .withIndex("by_channel", (q) => q.eq("channelId", source.channelId))
      .collect();
    const connector = connectors
      .filter((row) =>
        row.ownerId === args.ownerId &&
        (row.status ?? "active") === "active" &&
        Boolean(row.ytChannelId))
      .sort((left, right) => right._creationTime - left._creationTime)[0];
    if (!connector?.ytChannelId) {
      throw new Error("Reconnect the exact YouTube channel before replacing its thumbnail");
    }
    const identity = {
      ownerId: args.ownerId,
      channelId: String(source.channelId),
      sourceRunId: String(source._id),
      candidateRunId: String(candidate._id),
      youtubeVideoId: args.youtubeVideoId,
      expectedYoutubeChannelId: connector.ytChannelId,
      connectorId: String(connector._id),
      connectorVersion: connector.tokenVersion ?? 1,
      candidateThumbnailKey: thumbnail.r2Key,
      candidateArtifactSha256: artifactSha256,
    } as const;
    const planFingerprint = youtubeThumbnailReplacementPlanFingerprint(identity);
    const existing = await ctx.db
      .query("youtubeThumbnailReplacements")
      .withIndex("by_owner_candidate", (q) => q
        .eq("ownerId", args.ownerId)
        .eq("candidateRunId", candidate._id))
      .unique();
    if (existing) {
      if (existing.planFingerprint !== planFingerprint) {
        throw new Error("YouTube thumbnail replacement identity conflict");
      }
      return { state: "reused", replacementId: existing._id, ...existing };
    }
    const replacementId = await ctx.db.insert("youtubeThumbnailReplacements", {
      ownerId: identity.ownerId,
      channelId: source.channelId,
      sourceRunId: source._id,
      candidateRunId: candidate._id,
      youtubeVideoId: identity.youtubeVideoId,
      connectorId: connector._id,
      connectorVersion: identity.connectorVersion,
      expectedYoutubeChannelId: identity.expectedYoutubeChannelId,
      candidateThumbnailKey: identity.candidateThumbnailKey,
      candidateArtifactSha256: identity.candidateArtifactSha256,
      planFingerprint,
      dispatchKey: "pending-record-id",
      status: "awaiting_approval",
      dispatchAttempts: 0,
      createdAt: args.now,
      updatedAt: args.now,
    });
    const dispatchKey = youtubeThumbnailReplacementDispatchKey({
      replacementId: String(replacementId),
      planFingerprint,
    });
    await ctx.db.patch(replacementId, { dispatchKey });
    return {
      state: "created",
      replacementId,
      channelId: source.channelId,
      sourceRunId: source._id,
      candidateRunId: candidate._id,
      youtubeVideoId: args.youtubeVideoId,
      planFingerprint,
      dispatchKey,
      status: "awaiting_approval",
    };
  },
});

export const claimApproval = mutation({
  args: {
    ownerId: v.string(),
    replacementId: v.id("youtubeThumbnailReplacements"),
    planFingerprint: v.string(),
    approval: v.any(),
    approvalFingerprint: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "YouTube thumbnail replacement approval");
    assertNow(args.now);
    const row = await ctx.db.get(args.replacementId);
    if (!row || row.ownerId !== args.ownerId || row.planFingerprint !== args.planFingerprint) {
      throw new Error("YouTube thumbnail replacement plan changed before approval");
    }
    if (row.approval !== undefined) {
      if (row.approvalFingerprint !== args.approvalFingerprint) {
        throw new Error("YouTube thumbnail replacement approval changed");
      }
      return row;
    }
    if (row.status !== "awaiting_approval") {
      throw new Error("YouTube thumbnail replacement is not awaiting approval");
    }
    await ctx.db.patch(row._id, {
      approval: args.approval,
      approvalFingerprint: args.approvalFingerprint,
      status: "pending",
      lastError: undefined,
      updatedAt: args.now,
    });
    return await ctx.db.get(row._id);
  },
});

export const getDispatch = query({
  args: { ownerId: v.string(), replacementId: v.id("youtubeThumbnailReplacements") },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "YouTube thumbnail replacement dispatch");
    const row = await ctx.db.get(args.replacementId);
    if (!row || row.ownerId !== args.ownerId || !row.approval || !row.approvalFingerprint) return null;
    return {
      version: YOUTUBE_THUMBNAIL_REPLACEMENT_VERSION,
      replacementId: String(row._id),
      ownerId: row.ownerId,
      channelId: String(row.channelId),
      sourceRunId: String(row.sourceRunId),
      candidateRunId: String(row.candidateRunId),
      youtubeVideoId: row.youtubeVideoId,
      expectedYoutubeChannelId: row.expectedYoutubeChannelId,
      connectorId: String(row.connectorId),
      connectorVersion: row.connectorVersion,
      candidateThumbnailKey: row.candidateThumbnailKey,
      candidateArtifactSha256: row.candidateArtifactSha256,
      planFingerprint: row.planFingerprint,
      approval: row.approval,
      approvalFingerprint: row.approvalFingerprint,
      dispatchKey: row.dispatchKey,
      dispatchAttempt: row.dispatchAttempts,
    };
  },
});

export const getExecution = query({
  args: { ownerId: v.string(), replacementId: v.id("youtubeThumbnailReplacements") },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "YouTube thumbnail replacement execution");
    const row = await ctx.db.get(args.replacementId);
    if (!row || row.ownerId !== args.ownerId) return null;
    const [source, candidate] = await Promise.all([
      ctx.db.get(row.sourceRunId),
      ctx.db.get(row.candidateRunId),
    ]);
    if (
      !source || source.ownerId !== row.ownerId || source.channelId !== row.channelId ||
      source.youtubeVideoId !== row.youtubeVideoId ||
      !candidate || candidate.ownerId !== row.ownerId || candidate.channelId !== row.channelId ||
      candidate.thumbnailRefreshSourceRunId !== source._id || candidate.status !== "ok"
    ) throw new Error("YouTube thumbnail replacement execution binding changed");
    const { thumbnail, artifactSha256 } = await candidateThumbnail(
      ctx,
      row.ownerId,
      row.channelId,
      row.candidateRunId,
    );
    if (
      thumbnail.r2Key !== row.candidateThumbnailKey ||
      artifactSha256 !== row.candidateArtifactSha256
    ) throw new Error("YouTube thumbnail replacement candidate bytes changed");
    return row;
  },
});

export const markQueued = mutation({
  args: {
    ownerId: v.string(),
    replacementId: v.id("youtubeThumbnailReplacements"),
    triggerRunId: v.string(),
    attempt: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "YouTube thumbnail replacement queue");
    assertNow(args.now);
    const row = await ctx.db.get(args.replacementId);
    if (!row || row.ownerId !== args.ownerId) throw new Error("YouTube thumbnail replacement is unavailable");
    if (row.status === "applied") return row;
    if (row.status !== "pending" || args.attempt !== row.dispatchAttempts + 1) {
      throw new Error("YouTube thumbnail replacement queue attempt is stale");
    }
    await ctx.db.patch(row._id, {
      status: "queued",
      dispatchAttempts: args.attempt,
      dispatchTriggerRunId: args.triggerRunId,
      lastError: undefined,
      updatedAt: args.now,
    });
    return await ctx.db.get(row._id);
  },
});

export const recordFailure = mutation({
  args: {
    ownerId: v.string(),
    replacementId: v.id("youtubeThumbnailReplacements"),
    attempt: v.number(),
    error: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "YouTube thumbnail replacement failure");
    assertNow(args.now);
    const row = await ctx.db.get(args.replacementId);
    if (!row || row.ownerId !== args.ownerId) throw new Error("YouTube thumbnail replacement is unavailable");
    if (row.status === "applied") return row;
    const attempt = Math.max(row.dispatchAttempts, args.attempt);
    await ctx.db.patch(row._id, {
      status: attempt >= MAX_ATTEMPTS ? "blocked" : "pending",
      dispatchAttempts: attempt,
      lastError: args.error.trim().slice(0, 500),
      updatedAt: args.now,
    });
    return await ctx.db.get(row._id);
  },
});

export const completeApplication = mutation({
  args: {
    ownerId: v.string(),
    replacementId: v.id("youtubeThumbnailReplacements"),
    planFingerprint: v.string(),
    providerKind: v.string(),
    providerItemCount: v.number(),
    appliedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "YouTube thumbnail replacement completion");
    assertNow(args.appliedAt);
    const row = await ctx.db.get(args.replacementId);
    if (!row || row.ownerId !== args.ownerId || row.planFingerprint !== args.planFingerprint) {
      throw new Error("YouTube thumbnail replacement completion binding changed");
    }
    const applicationReceiptFingerprint = sha256Hex(canonicalJson({
      version: "youtube-thumbnail-replacement-receipt/v1",
      replacementId: String(row._id),
      planFingerprint: row.planFingerprint,
      youtubeVideoId: row.youtubeVideoId,
      candidateArtifactSha256: row.candidateArtifactSha256,
      providerKind: args.providerKind,
      providerItemCount: args.providerItemCount,
      appliedAt: args.appliedAt,
    }));
    if (row.status === "applied") return row;
    await ctx.db.patch(row._id, {
      status: "applied",
      providerKind: args.providerKind,
      providerItemCount: args.providerItemCount,
      appliedAt: args.appliedAt,
      applicationReceiptFingerprint,
      lastError: undefined,
      updatedAt: args.appliedAt,
    });
    return await ctx.db.get(row._id);
  },
});
