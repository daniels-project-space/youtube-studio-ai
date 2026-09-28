import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import {
  ASSET_RETENTION_LEASE_MS,
  classifyStudioR2Asset,
  studioR2AssetExpiresAt,
} from "../src/lib/studioR2AssetRetention";

const rowArgs = { ownerId: v.string(), retentionId: v.id("studioR2AssetRetentions"), leaseToken: v.string(), now: v.number() };

function validLease(token: string): boolean { return /^[a-f0-9]{64}$/.test(token); }

async function isProtected(ctx: MutationCtx, row: Doc<"studioR2AssetRetentions">): Promise<boolean> {
  const [asset, run, channel, references, runRetention, library, candidates] = await Promise.all([
    ctx.db.get(row.assetId), ctx.db.get(row.runId), ctx.db.get(row.channelId),
    ctx.db.query("assets").withIndex("by_r2_key", (q) => q.eq("r2Key", row.r2Key)).take(2),
    ctx.db.query("runArtifactRetentions").withIndex("by_run", (q) => q.eq("runId", row.runId)).first(),
    ctx.db.query("studioAssetLibraryEntries").withIndex("by_owner", (q) => q.eq("ownerId", row.ownerId)).take(1001),
    ctx.db.query("studioAssetPromotionCandidates").withIndex("by_owner", (q) => q.eq("ownerId", row.ownerId)).take(1001),
  ]);
  if (!asset || asset.ownerId !== row.ownerId || asset.channelId !== row.channelId ||
      asset.runId !== row.runId || asset.r2Key !== row.r2Key || !run || run.ownerId !== row.ownerId ||
      run.channelId !== row.channelId || !channel || channel.ownerId !== row.ownerId ||
      references.length !== 1 || references[0]._id !== row.assetId ||
      library.length > 1000 || candidates.length > 1000) return true;
  if (classifyStudioR2Asset({ ownerId: row.ownerId, channelSlug: channel.slug,
    runId: row.runId, kind: asset.kind, r2Key: row.r2Key }) !== row.classification) return true;
  if (run.status !== "ok" || !run.finishedAt || run.finishedAt > row.expiresAt) return true;
  if (runRetention && runRetention.status !== "completed") return true;
  // Even deprecated/revoked entries and unapproved candidates retain their
  // referenced bytes until their own lifecycle is explicitly reconciled.
  if (library.some((entry) => (entry.entry as { resource?: { r2Key?: unknown } } | null)?.resource?.r2Key === row.r2Key)) return true;
  if (candidates.some((candidate) => JSON.stringify(candidate.candidate).includes(JSON.stringify(row.r2Key)))) return true;
  return false;
}

/** Bounded owner inventory; this is the only source of due work. */
export const dueInventory = query({
  args: { ownerId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "R2 asset retention inventory");
    const rows = await ctx.db.query("studioR2AssetRetentions")
      .withIndex("by_owner_status_next_check", (q) => q.eq("ownerId", args.ownerId).eq("status", "pending").lte("nextCheckAt", args.now)).take(10);
    const processing = await ctx.db.query("studioR2AssetRetentions")
      .withIndex("by_owner_status_next_check", (q) => q.eq("ownerId", args.ownerId).eq("status", "processing")).take(10);
    const expiredLeases = processing.filter((row) => (row.leaseExpiresAt ?? 0) <= args.now && row.expiresAt <= args.now);
    return { due: rows.length + expiredLeases.length, capped: rows.length === 10 || processing.length === 10 };
  },
});

export const claimDue = mutation({
  args: { ownerId: v.string(), now: v.number(), leaseToken: v.string() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "R2 asset retention claim");
    if (!Number.isSafeInteger(args.now) || !validLease(args.leaseToken)) throw new Error("invalid retention claim");
    const pending = await ctx.db.query("studioR2AssetRetentions")
      .withIndex("by_owner_status_next_check", (q) => q.eq("ownerId", args.ownerId).eq("status", "pending").lte("nextCheckAt", args.now)).take(10);
    const processing = await ctx.db.query("studioR2AssetRetentions")
      .withIndex("by_owner_status_next_check", (q) => q.eq("ownerId", args.ownerId).eq("status", "processing")).take(10);
    for (const row of [...pending, ...processing.filter((entry) => (entry.leaseExpiresAt ?? 0) <= args.now)]) {
      if (row.expiresAt !== studioR2AssetExpiresAt(row.classification, row.createdAt) || row.expiresAt > args.now) continue;
      if (await isProtected(ctx, row)) {
        await ctx.db.patch(row._id, { status: "pending", leaseToken: undefined, leaseExpiresAt: undefined,
          nextCheckAt: args.now + 24 * 60 * 60 * 1_000 });
        continue;
      }
      await ctx.db.patch(row._id, { status: "processing", leaseToken: args.leaseToken,
        leaseExpiresAt: args.now + ASSET_RETENTION_LEASE_MS, attempts: row.attempts + 1 });
      return { retentionId: row._id, r2Key: row.r2Key, leaseToken: args.leaseToken, createdAt: row.createdAt };
    }
    return null;
  },
});

export const authorizeDeletion = mutation({
  args: rowArgs,
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "R2 asset retention deletion authority");
    const row = await ctx.db.get(args.retentionId);
    if (!row || row.ownerId !== args.ownerId || row.status !== "processing" ||
        row.leaseToken !== args.leaseToken || !validLease(args.leaseToken) ||
        !row.leaseExpiresAt || row.leaseExpiresAt <= args.now ||
        row.expiresAt > args.now || row.expiresAt !== studioR2AssetExpiresAt(row.classification, row.createdAt) ||
        await isProtected(ctx, row)) throw new Error("R2 asset retention authority unavailable");
    return { expiresAt: Math.min(row.leaseExpiresAt, args.now + 20_000) };
  },
});

export const complete = mutation({
  args: { ...rowArgs, deletedKey: v.string(), acknowledged: v.boolean() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "R2 asset retention completion");
    const row = await ctx.db.get(args.retentionId);
    if (!args.acknowledged || !row || row.ownerId !== args.ownerId || row.status !== "processing" ||
        row.leaseToken !== args.leaseToken || row.r2Key !== args.deletedKey ||
        !row.leaseExpiresAt || row.leaseExpiresAt <= args.now) throw new Error("R2 deletion acknowledgement or lease missing");
    const asset = await ctx.db.get(row.assetId);
    if (!asset || asset.r2Key !== row.r2Key || asset.ownerId !== row.ownerId || asset.channelId !== row.channelId) {
      throw new Error("R2 asset row changed before completion");
    }
    await ctx.db.delete(row.assetId);
    await ctx.db.patch(row._id, { status: "deleted", deletedAt: args.now,
      leaseToken: undefined, leaseExpiresAt: undefined });
    return true;
  },
});

export const release = mutation({
  args: { ...rowArgs, error: v.string() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "R2 asset retention release");
    const row = await ctx.db.get(args.retentionId);
    if (!row || row.ownerId !== args.ownerId || row.status !== "processing" || row.leaseToken !== args.leaseToken) return false;
    await ctx.db.patch(row._id, { status: "pending", leaseToken: undefined, leaseExpiresAt: undefined,
      nextCheckAt: args.now + 60 * 60 * 1_000 });
    return true;
  },
});
