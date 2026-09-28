import { mutation, query } from "./studioFunctions";
import { v } from "convex/values";
import { isManagedRetentionKey } from "../src/lib/r2AssetRetention";
import { projectReleasedOrdinaryAssets } from "../src/lib/ordinaryAssetProjection";

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
    if (isManagedRetentionKey(args.r2Key)) {
      if (!args.runId) throw new Error("managed R2 asset requires its exact run");
      const [run, channel] = await Promise.all([ctx.db.get(args.runId), ctx.db.get(args.channelId)]);
      if (!run || !channel || run.ownerId !== args.ownerId || run.channelId !== args.channelId ||
          channel.ownerId !== args.ownerId ||
          !args.r2Key.startsWith(`owner/${args.ownerId}/channel/${channel.slug}/runs/${args.runId}/`)) {
        throw new Error("managed R2 asset owner, channel, or run is mismatched");
      }
      const [write, references] = await Promise.all([
        ctx.db.query("r2ImmutableWrites")
          .withIndex("by_owner_key", (q) => q.eq("ownerId", args.ownerId).eq("r2Key", args.r2Key)).unique(),
        ctx.db.query("assets").withIndex("by_r2_key", (q) => q.eq("r2Key", args.r2Key)).collect(),
      ]);
      if (!write || write.status !== "finished" || write.runId !== args.runId ||
          write.channelId !== args.channelId ||
          references.some((row) => row.ownerId !== args.ownerId || row.channelId !== args.channelId || row.runId !== args.runId)) {
        throw new Error("managed R2 asset is unwritten or referenced by another run");
      }
    }
    return await ctx.db.insert("assets", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      runId: args.runId,
      kind: args.kind,
      r2Key: args.r2Key,
      meta: args.meta,
    });
  },
});

export const listForRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    // These two actual Lo-Fi reader families switch only after a verified
    // source→copy receipt. The stored source rows and every other reference
    // remain intact. Expired copies are never projected back to readers.
    const copies = await ctx.db.query("releasedOrdinaryAssets")
      .withIndex("by_run", (q) => q.eq("runId", args.runId)).collect();
    return projectReleasedOrdinaryAssets(assets, copies, Date.now());
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
