/**
 * Outlier bank — per-niche cached breakout-video scans (topicraft's
 * quota-immune demand signal). Live YouTube search quota dies daily; the bank
 * makes the hot path (topic_select / plan-week-ahead) read cached scans and
 * refresh at most weekly, the same doctrine as the SEO databank.
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const outlierValidator = v.object({
  title: v.string(),
  channelTitle: v.string(),
  views: v.number(),
  subs: v.number(),
  score: v.number(),
  videoId: v.string(),
  publishedAt: v.string(),
  durationSec: v.number(),
});

export const getBank = query({
  args: { ownerId: v.string(), niche: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("outlierBank")
      .withIndex("by_owner_niche", (q) => q.eq("ownerId", args.ownerId).eq("niche", args.niche))
      .first();
  },
});

export const upsertBank = mutation({
  args: { ownerId: v.string(), niche: v.string(), outliers: v.array(outlierValidator) },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("outlierBank")
      .withIndex("by_owner_niche", (q) => q.eq("ownerId", args.ownerId).eq("niche", args.niche))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { outliers: args.outliers, fetchedAt: Date.now() });
      return existing._id;
    }
    return await ctx.db.insert("outlierBank", { ...args, fetchedAt: Date.now() });
  },
});
