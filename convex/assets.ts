import { mutation, query } from "./studioFunctions";
import { v } from "convex/values";
import { classifyStudioR2Asset, studioR2AssetExpiresAt, STUDIO_R2_ASSET_RETENTION_VERSION } from "../src/lib/studioR2AssetRetention";

/**
 * Media artifact registry. Bytes live in R2; rows here index them by r2Key and
 * `kind` (keyframe|clip|upscaled|music|video|thumbnail) for a run.
 */
export const recordAsset = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.optional(v.id("runs")),
    kind: v.string(),
    r2Key: v.string(),
    meta: v.optional(v.any()),
  },
  returns: v.id("assets"),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    const run = args.runId ? await ctx.db.get(args.runId) : null;
    if (!channel || channel.ownerId !== args.ownerId ||
        (args.runId && (!run || run.ownerId !== args.ownerId || run.channelId !== args.channelId))) {
      throw new Error("asset owner, channel, and run must match");
    }
    const existingAssets = await ctx.db.query("assets")
      .withIndex("by_r2_key", (q) => q.eq("r2Key", args.r2Key)).take(2);
    if (existingAssets.length) {
      const prior = existingAssets[0];
      if (existingAssets.length !== 1 || prior.ownerId !== args.ownerId ||
          prior.channelId !== args.channelId || prior.runId !== args.runId || prior.kind !== args.kind) {
        throw new Error("asset key already belongs to another indexed object");
      }
      return prior._id;
    }
    const keyRetentions = await ctx.db.query("studioR2AssetRetentions")
      .withIndex("by_owner_key", (q) => q.eq("ownerId", args.ownerId).eq("r2Key", args.r2Key)).take(1);
    if (keyRetentions.length) {
      throw new Error("asset key is under retention cleanup");
    }
    const assetId = await ctx.db.insert("assets", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      runId: args.runId,
      kind: args.kind,
      r2Key: args.r2Key,
      meta: args.meta,
    });
    const classification = classifyStudioR2Asset({
      ownerId: args.ownerId, channelSlug: channel.slug, runId: args.runId,
      kind: args.kind, r2Key: args.r2Key,
    });
    if (classification && args.runId) {
      const createdAt = Date.now();
      await ctx.db.insert("studioR2AssetRetentions", {
        version: STUDIO_R2_ASSET_RETENTION_VERSION,
        ownerId: args.ownerId, channelId: args.channelId, runId: args.runId,
        assetId, r2Key: args.r2Key, classification,
        createdAt, expiresAt: studioR2AssetExpiresAt(classification, createdAt),
        nextCheckAt: studioR2AssetExpiresAt(classification, createdAt),
        status: "pending", attempts: 0,
      });
    }
    return assetId;
  },
});

export const listForRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("assets")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
  },
});

/**
 * Delete a run's asset rows EXCEPT the given kinds (default keeps the finished
 * video + its thumbnail). Used by the `cleanup` block after upload so the library
 * holds only the final video — the intermediate audio/captions rows are removed
 * alongside their R2 objects.
 */
export const pruneRun = mutation({
  args: { runId: v.id("runs"), keepKinds: v.optional(v.array(v.string())) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const keep = new Set(args.keepKinds ?? ["video", "thumbnail"]);
    const rows = await ctx.db
      .query("assets")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    let removed = 0;
    for (const r of rows) {
      if (!keep.has(r.kind)) {
        await ctx.db.delete(r._id);
        removed++;
      }
    }
    return removed;
  },
});
