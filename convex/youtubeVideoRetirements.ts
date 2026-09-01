import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import { canonicalJson } from "../src/lib/canonicalJson";
import {
  assessLegacyVideoCleanup,
  LEGACY_VIDEO_RETIREMENT_REASONS,
} from "../src/lib/legacyVideoCleanup";
import { sha256Hex } from "../src/lib/sha256";
import {
  YOUTUBE_VIDEO_RETIREMENT_VERSION,
  youtubeVideoRetirementDispatchKey,
  youtubeVideoRetirementPlanFingerprint,
} from "../src/lib/youtubeVideoRetirement";

const MAX_ATTEMPTS = 3;

function assertNow(now: number) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("YouTube retirement timestamp is invalid");
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function titleForRun(ctx: Pick<MutationCtx, "db">, runId: Id<"runs">, fallback: string) {
  const stages = await ctx.db
    .query("runStages")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .collect();
  const metadata = record(stages.find((stage) =>
    stage.block === "metadata" || stage.block === "quiz_metadata")?.outputs);
  return text(metadata?.title) ?? fallback;
}

export const createPlanShell = mutation({
  args: {
    ownerId: v.string(),
    runId: v.id("runs"),
    youtubeVideoId: v.string(),
    reason: v.union(
      v.literal("failed_run_uploaded"),
      v.literal("channel_identity_mismatch"),
      v.literal("unqualified_family_legacy"),
    ),
    now: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "YouTube video retirement plan");
    assertNow(args.now);
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.ownerId !== args.ownerId ||
      run.youtubeVideoId !== args.youtubeVideoId
    ) {
      throw new Error("YouTube retirement run/video binding changed");
    }
    const channel = await ctx.db.get(run.channelId);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("YouTube retirement channel is unavailable");
    }
    const title = await titleForRun(ctx, run._id, channel.name);
    const assessment = assessLegacyVideoCleanup({
      youtubeVideoId: run.youtubeVideoId,
      runStatus: run.status,
      title,
      channelFamily:
        channel.family ??
        channel.contentLane?.family ??
        channel.identity.programBrief?.family,
      releaseEvidenceStatus: run.releaseEvidenceStatus,
    });
    if (assessment.action !== "retire" || assessment.reason !== args.reason) {
      throw new Error("This retained video is not an evidence-backed legacy retirement candidate");
    }
    if (!LEGACY_VIDEO_RETIREMENT_REASONS.includes(args.reason)) {
      throw new Error("YouTube retirement reason is invalid");
    }
    const connectors = await ctx.db
      .query("youtubeAuth")
      .withIndex("by_channel", (q) => q.eq("channelId", run.channelId))
      .collect();
    const connector = connectors
      .filter((candidate) =>
        candidate.ownerId === args.ownerId &&
        (candidate.status ?? "active") === "active" &&
        Boolean(candidate.ytChannelId))
      .sort((left, right) => right._creationTime - left._creationTime)[0];
    if (!connector?.ytChannelId) {
      throw new Error("Reconnect the exact YouTube channel before retiring this video");
    }
    const connectorVersion = connector.tokenVersion ?? 1;
    const identity = {
      ownerId: args.ownerId,
      channelId: String(run.channelId),
      runId: String(run._id),
      youtubeVideoId: args.youtubeVideoId,
      expectedYoutubeChannelId: connector.ytChannelId,
      connectorId: String(connector._id),
      connectorVersion,
      reason: args.reason,
    } as const;
    const planFingerprint = youtubeVideoRetirementPlanFingerprint(identity);
    const existing = await ctx.db
      .query("youtubeVideoRetirements")
      .withIndex("by_owner_video", (q) =>
        q.eq("ownerId", args.ownerId).eq("youtubeVideoId", args.youtubeVideoId))
      .unique();
    if (existing) {
      if (
        existing.runId !== run._id ||
        existing.channelId !== run.channelId ||
        existing.planFingerprint !== planFingerprint
      ) {
        throw new Error("YouTube retirement identity conflict");
      }
      return {
        state: "reused",
        retirementId: existing._id,
        channelId: existing.channelId,
        runId: existing.runId,
        youtubeVideoId: existing.youtubeVideoId,
        reason: existing.reason,
        planFingerprint: existing.planFingerprint,
        dispatchKey: existing.dispatchKey,
        status: existing.status,
      };
    }
    const retirementId = await ctx.db.insert("youtubeVideoRetirements", {
      ownerId: args.ownerId,
      channelId: run.channelId,
      runId: run._id,
      youtubeVideoId: args.youtubeVideoId,
      reason: args.reason,
      connectorId: connector._id,
      connectorVersion,
      expectedYoutubeChannelId: connector.ytChannelId,
      planFingerprint,
      // The record id is not known until insertion. Freeze the durable global
      // key immediately afterwards; no external work can see this shell yet.
      dispatchKey: "pending-record-id",
      status: "awaiting_approval",
      dispatchAttempts: 0,
      createdAt: args.now,
      updatedAt: args.now,
    });
    const dispatchKey = youtubeVideoRetirementDispatchKey({
      retirementId: String(retirementId),
      planFingerprint,
    });
    await ctx.db.patch(retirementId, { dispatchKey });
    return {
      state: "created",
      retirementId,
      channelId: run.channelId,
      runId: run._id,
      youtubeVideoId: args.youtubeVideoId,
      reason: args.reason,
      planFingerprint,
      dispatchKey,
      status: "awaiting_approval",
    };
  },
});

export const claimApproval = mutation({
  args: {
    ownerId: v.string(),
    retirementId: v.id("youtubeVideoRetirements"),
    planFingerprint: v.string(),
    approval: v.any(),
    approvalFingerprint: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "YouTube video retirement approval");
    assertNow(args.now);
    const row = await ctx.db.get(args.retirementId);
    if (
      !row ||
      row.ownerId !== args.ownerId ||
      row.planFingerprint !== args.planFingerprint
    ) throw new Error("YouTube retirement plan changed before approval");
    if (row.approval !== undefined) {
      if (row.approvalFingerprint !== args.approvalFingerprint) {
        throw new Error("YouTube retirement approval changed");
      }
      return row;
    }
    if (row.status !== "awaiting_approval") {
      throw new Error("YouTube retirement is not awaiting approval");
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
  args: {
    ownerId: v.string(),
    retirementId: v.id("youtubeVideoRetirements"),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "YouTube video retirement dispatch");
    const row = await ctx.db.get(args.retirementId);
    if (
      !row ||
      row.ownerId !== args.ownerId ||
      !row.approval ||
      !row.approvalFingerprint
    ) return null;
    return {
      version: YOUTUBE_VIDEO_RETIREMENT_VERSION,
      retirementId: String(row._id),
      ownerId: row.ownerId,
      channelId: String(row.channelId),
      runId: String(row.runId),
      youtubeVideoId: row.youtubeVideoId,
      expectedYoutubeChannelId: row.expectedYoutubeChannelId,
      connectorId: String(row.connectorId),
      connectorVersion: row.connectorVersion,
      reason: row.reason,
      planFingerprint: row.planFingerprint,
      approval: row.approval,
      approvalFingerprint: row.approvalFingerprint,
      dispatchKey: row.dispatchKey,
      dispatchAttempt: row.dispatchAttempts,
    };
  },
});

export const getExecution = query({
  args: {
    ownerId: v.string(),
    retirementId: v.id("youtubeVideoRetirements"),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "YouTube video retirement execution");
    const row = await ctx.db.get(args.retirementId);
    if (!row || row.ownerId !== args.ownerId) return null;
    const run = await ctx.db.get(row.runId);
    if (
      !run ||
      run.ownerId !== row.ownerId ||
      run.channelId !== row.channelId ||
      run.youtubeVideoId !== row.youtubeVideoId
    ) throw new Error("YouTube retirement source binding changed");
    return row;
  },
});

export const markQueued = mutation({
  args: {
    ownerId: v.string(),
    retirementId: v.id("youtubeVideoRetirements"),
    triggerRunId: v.string(),
    attempt: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "YouTube video retirement queue");
    assertNow(args.now);
    const row = await ctx.db.get(args.retirementId);
    if (!row || row.ownerId !== args.ownerId) throw new Error("YouTube retirement is unavailable");
    if (row.status === "deleted") return row;
    if (
      row.status !== "pending" ||
      args.attempt !== row.dispatchAttempts + 1
    ) throw new Error("YouTube retirement queue attempt is stale");
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
    retirementId: v.id("youtubeVideoRetirements"),
    attempt: v.number(),
    error: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "YouTube video retirement failure");
    assertNow(args.now);
    const row = await ctx.db.get(args.retirementId);
    if (!row || row.ownerId !== args.ownerId) throw new Error("YouTube retirement is unavailable");
    if (row.status === "deleted") return row;
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

export const completeDeletion = mutation({
  args: {
    ownerId: v.string(),
    retirementId: v.id("youtubeVideoRetirements"),
    planFingerprint: v.string(),
    providerVideoChannelId: v.optional(v.string()),
    providerPrivacyStatus: v.optional(v.string()),
    providerOutcome: v.union(v.literal("deleted"), v.literal("already_absent")),
    absenceVerifiedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "YouTube video retirement completion");
    assertNow(args.absenceVerifiedAt);
    const row = await ctx.db.get(args.retirementId);
    if (
      !row ||
      row.ownerId !== args.ownerId ||
      row.planFingerprint !== args.planFingerprint
    ) throw new Error("YouTube retirement completion binding changed");
    if (
      args.providerVideoChannelId !== undefined &&
      args.providerVideoChannelId !== row.expectedYoutubeChannelId
    ) throw new Error("YouTube retirement provider owner changed");
    const deletionReceiptFingerprint = sha256Hex(canonicalJson({
      version: "youtube-video-retirement-receipt/v1",
      retirementId: String(row._id),
      planFingerprint: row.planFingerprint,
      youtubeVideoId: row.youtubeVideoId,
      providerVideoChannelId: args.providerVideoChannelId ?? null,
      providerPrivacyStatus: args.providerPrivacyStatus ?? null,
      providerOutcome: args.providerOutcome,
      absenceVerifiedAt: args.absenceVerifiedAt,
    }));
    if (row.status === "deleted") return row;
    await ctx.db.patch(row._id, {
      status: "deleted",
      providerVideoChannelId: args.providerVideoChannelId,
      providerPrivacyStatus: args.providerPrivacyStatus,
      providerOutcome: args.providerOutcome,
      absenceVerifiedAt: args.absenceVerifiedAt,
      deletionReceiptFingerprint,
      lastError: undefined,
      updatedAt: args.absenceVerifiedAt,
    });
    return await ctx.db.get(row._id);
  },
});
