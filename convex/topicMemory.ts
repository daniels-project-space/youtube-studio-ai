import { mutation, query } from "./studioFunctions";
import { v } from "convex/values";

/**
 * Topic dedup memory for a channel. `topic_select` queries recent keys to avoid
 * repeating a topic, then records the chosen one.
 */
export const listForChannel = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("topicMemory")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .collect();
  },
});

/**
 * Bounded owner-wide memory used by the automatic weekly planner. Channel
 * memory still owns the per-channel no-repeat rule; this projection adds a
 * lightweight cross-channel guard so the same topic is not bought twice in a
 * weekly wave just because two channels planned concurrently.
 */
export const listForOwner = query({
  args: { ownerId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(500, Math.max(1, Math.floor(args.limit ?? 250)));
    return await ctx.db
      .query("topicMemory")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .order("desc")
      .take(limit);
  },
});

export const recordTopic = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    key: v.string(),
  },
  returns: v.id("topicMemory"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("topicMemory")
      .withIndex("by_channel_key", (q) => q.eq("channelId", args.channelId).eq("key", args.key))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("topicMemory", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      key: args.key,
      usedAt: Date.now(),
    });
  },
});
