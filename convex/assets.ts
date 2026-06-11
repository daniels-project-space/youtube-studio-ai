import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

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
