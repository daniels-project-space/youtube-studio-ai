/** Read tombstones of deleted channels (compact structural prints). */
import { query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("channelArchives")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
  },
});
