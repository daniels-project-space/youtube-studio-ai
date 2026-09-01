import { v } from "convex/values";

import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import {
  RUN_ARTIFACT_RETENTION_VERSION,
  dueRunArtifactRetentionLease,
  expectedChannelKeyPrefix,
  scheduleRunArtifactRetention,
  validateRunArtifactKeepNames,
  validateRunArtifactRetentionObjectKeys,
} from "../src/lib/runArtifactRetention";

const MAX_CLEANUP_ATTEMPTS = 5;

const releaseMode = v.union(
  v.literal("private_draft"),
  v.literal("scheduled"),
  v.literal("public"),
);

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export const schedule = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    keyPrefix: v.string(),
    certificateKey: v.string(),
    additionalCertificateKeys: v.array(v.string()),
    keepNames: v.array(v.string()),
    releaseMode,
    uploadedAt: v.number(),
    scheduledPublishAt: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "run artifact retention scheduling");
    const [channel, run] = await Promise.all([
      ctx.db.get(args.channelId),
      ctx.db.get(args.runId),
    ]);
    if (
      !channel ||
      channel.ownerId !== args.ownerId ||
      !run ||
      run.ownerId !== args.ownerId ||
      run.channelId !== args.channelId
    ) {
      throw new Error("run artifact retention owner/channel/run mismatch");
    }
    if (
      run.releaseEvidenceStatus !== "release_evidence_recorded" ||
      run.releaseEvidenceCertificateKey !== args.certificateKey
    ) {
      throw new Error("run artifact retention requires the run's exact recorded release certificate");
    }
    const expectedPrefix = expectedChannelKeyPrefix({
      ownerId: args.ownerId,
      channelSlug: channel.slug,
    });
    if (args.keyPrefix !== expectedPrefix) {
      throw new Error("run artifact retention key prefix does not match the owned channel namespace");
    }
    const objectKeys = validateRunArtifactRetentionObjectKeys({
      keyPrefix: args.keyPrefix,
      runId: String(args.runId),
      certificateKey: args.certificateKey,
      additionalCertificateKeys: args.additionalCertificateKeys,
    });
    const keepNames = validateRunArtifactKeepNames(args.keepNames);
    const retention = scheduleRunArtifactRetention({
      releaseMode: args.releaseMode,
      uploadedAt: args.uploadedAt,
      scheduledPublishAt: args.scheduledPublishAt,
    });
    const existing = await ctx.db
      .query("runArtifactRetentions")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .unique();
    if (existing) {
      if (
        existing.version !== RUN_ARTIFACT_RETENTION_VERSION ||
        existing.ownerId !== args.ownerId ||
        existing.channelId !== args.channelId ||
        existing.keyPrefix !== objectKeys.keyPrefix ||
        existing.certificateKey !== objectKeys.certificateKey ||
        !sameStrings(existing.additionalCertificateKeys, objectKeys.additionalCertificateKeys) ||
        !sameStrings(existing.keepNames, keepNames) ||
        existing.releaseMode !== retention.releaseMode ||
        existing.releaseAt !== retention.releaseAt ||
        existing.retainUntil !== retention.retainUntil
      ) {
        throw new Error("run artifact retention replay conflicts with the immutable schedule");
      }
      return existing;
    }
    const id = await ctx.db.insert("runArtifactRetentions", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      runId: args.runId,
      version: RUN_ARTIFACT_RETENTION_VERSION,
      keyPrefix: objectKeys.keyPrefix,
      certificateKey: objectKeys.certificateKey,
      additionalCertificateKeys: objectKeys.additionalCertificateKeys,
      keepNames,
      releaseMode: retention.releaseMode,
      ...(retention.releaseAt === undefined ? {} : { releaseAt: retention.releaseAt }),
      ...(retention.retainUntil === undefined ? {} : { retainUntil: retention.retainUntil }),
      status: retention.status,
      attempts: 0,
      scheduledAt: args.uploadedAt,
      updatedAt: args.uploadedAt,
    });
    return await ctx.db.get(id);
  },
});

export const getForRun = query({
  args: { runId: v.id("runs") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("runArtifactRetentions")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .unique();
    if (!row) return null;
    // Browser projection only. Storage namespaces, certificate locations,
    // lease tokens, and worker errors remain service-private.
    return {
      status: row.status,
      releaseAt: row.releaseAt,
      retainUntil: row.retainUntil,
      scheduledAt: row.scheduledAt,
      completedAt: row.completedAt,
      removedObjects: row.removedObjects,
      retainedObjectCount: row.retainedObjectCount,
    };
  },
});

export const claimDue = mutation({
  args: {
    ownerId: v.string(),
    now: v.number(),
    leaseToken: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "run artifact retention cleanup claim");
    const lease = dueRunArtifactRetentionLease({ now: args.now, token: args.leaseToken });
    const pending = await ctx.db
      .query("runArtifactRetentions")
      .withIndex("by_owner_status_retain_until", (q) => q
        .eq("ownerId", args.ownerId)
        .eq("status", "pending")
        .lte("retainUntil", args.now))
      .take(20);
    let row: (typeof pending)[number] | null = null;
    for (const candidate of pending) {
      if (candidate.attempts < MAX_CLEANUP_ATTEMPTS) {
        row = candidate;
        break;
      }
      await ctx.db.patch(candidate._id, {
        status: "blocked",
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        lastError: candidate.lastError ?? "artifact retention cleanup exhausted its retry budget",
        updatedAt: args.now,
      });
    }
    if (!row) {
      const processing = await ctx.db
        .query("runArtifactRetentions")
        .withIndex("by_owner_status_retain_until", (q) => q
          .eq("ownerId", args.ownerId)
          .eq("status", "processing")
          .lte("retainUntil", args.now))
        .take(20);
      for (const candidate of processing) {
        if (candidate.leaseExpiresAt === undefined || candidate.leaseExpiresAt > args.now) continue;
        if (candidate.attempts < MAX_CLEANUP_ATTEMPTS) {
          row = candidate;
          break;
        }
        await ctx.db.patch(candidate._id, {
          status: "blocked",
          leaseToken: undefined,
          leaseExpiresAt: undefined,
          lastError: candidate.lastError ?? "artifact retention cleanup exhausted its retry budget",
          updatedAt: args.now,
        });
      }
    }
    if (!row) return null;
    await ctx.db.patch(row._id, {
      status: "processing",
      attempts: row.attempts + 1,
      leaseToken: lease.leaseToken,
      leaseExpiresAt: lease.leaseExpiresAt,
      lastError: undefined,
      updatedAt: args.now,
    });
    return await ctx.db.get(row._id);
  },
});

export const complete = mutation({
  args: {
    ownerId: v.string(),
    retentionId: v.id("runArtifactRetentions"),
    leaseToken: v.string(),
    completedAt: v.number(),
    removedObjects: v.number(),
    retainedObjectCount: v.number(),
    retainedReleaseEvidence: v.array(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "run artifact retention cleanup completion");
    const row = await ctx.db.get(args.retentionId);
    if (
      !row ||
      row.ownerId !== args.ownerId ||
      row.status !== "processing" ||
      row.leaseToken !== args.leaseToken ||
      (row.leaseExpiresAt ?? -1) < args.completedAt
    ) {
      throw new Error("run artifact retention completion lease is missing, expired, or mismatched");
    }
    if (
      !Number.isSafeInteger(args.removedObjects) ||
      args.removedObjects < 0 ||
      !Number.isSafeInteger(args.retainedObjectCount) ||
      args.retainedObjectCount < 0
    ) {
      throw new Error("run artifact retention cleanup counts are invalid");
    }
    await ctx.db.patch(row._id, {
      status: "completed",
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      completedAt: args.completedAt,
      removedObjects: args.removedObjects,
      retainedObjectCount: args.retainedObjectCount,
      retainedReleaseEvidence: [...new Set(args.retainedReleaseEvidence)].sort(),
      lastError: undefined,
      updatedAt: args.completedAt,
    });
    return await ctx.db.get(row._id);
  },
});

export const fail = mutation({
  args: {
    ownerId: v.string(),
    retentionId: v.id("runArtifactRetentions"),
    leaseToken: v.string(),
    failedAt: v.number(),
    error: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "run artifact retention cleanup failure");
    const row = await ctx.db.get(args.retentionId);
    if (
      !row ||
      row.ownerId !== args.ownerId ||
      row.status !== "processing" ||
      row.leaseToken !== args.leaseToken
    ) {
      throw new Error("run artifact retention failure lease is missing or mismatched");
    }
    await ctx.db.patch(row._id, {
      status: row.attempts >= MAX_CLEANUP_ATTEMPTS ? "blocked" : "pending",
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      lastError: args.error.slice(0, 1_000),
      updatedAt: args.failedAt,
    });
    return await ctx.db.get(row._id);
  },
});
