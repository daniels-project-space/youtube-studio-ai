import { mutation, query } from "./_generated/server";
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

export const recordTopic = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    key: v.string(),
  },
  returns: v.id("topicMemory"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("topicMemory", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      key: args.key,
      usedAt: Date.now(),
    });
  },
});
