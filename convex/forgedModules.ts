/** Module Forge persistence — architect-authored module specs. */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("forgedModules")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
  },
});

export const getByBlock = query({
  args: { ownerId: v.string(), blockId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("forgedModules")
      .withIndex("by_owner_block", (q) => q.eq("ownerId", args.ownerId).eq("blockId", args.blockId))
      .first();
  },
});

export const save = mutation({
  args: {
    ownerId: v.string(),
    blockId: v.string(),
    spec: v.any(),
    status: v.string(),
    forChannelId: v.optional(v.string()),
    capability: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("forgedModules")
      .withIndex("by_owner_block", (q) => q.eq("ownerId", args.ownerId).eq("blockId", args.blockId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { spec: args.spec, status: args.status, capability: args.capability });
      return existing._id;
    }
    return await ctx.db.insert("forgedModules", args);
  },
});

export const setStatus = mutation({
  args: { ownerId: v.string(), blockId: v.string(), status: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("forgedModules")
      .withIndex("by_owner_block", (q) => q.eq("ownerId", args.ownerId).eq("blockId", args.blockId))
      .first();
    if (row) await ctx.db.patch(row._id, { status: args.status });
  },
});
