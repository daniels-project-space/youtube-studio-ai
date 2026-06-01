import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Competitor registry (competitor-intelligence engine, faithful v1 port).
 *
 * One row per (ownerId, niche, channelName). Holds a competitor channel's
 * aggregate stats plus its best-performing videos (sorted by views). Mined
 * exclusively from YouTube Data API v3 by `refreshNicheResearch`.
 */

const topVideoValidator = v.object({
  youtubeVideoId: v.string(),
  title: v.string(),
  views: v.number(),
  likes: v.number(),
  comments: v.number(),
  tags: v.array(v.string()),
  thumbnailUrl: v.string(),
  durationSec: v.number(),
  publishedAt: v.string(),
});

/**
 * Replace the full competitor set for a niche. We delete the prior rows for
 * (ownerId, niche) and insert fresh ones so stale competitors never linger.
 */
export const upsertCompetitors = mutation({
  args: {
    ownerId: v.string(),
    niche: v.string(),
    competitors: v.array(
      v.object({
        channelName: v.string(),
        totalViews: v.number(),
        videoCount: v.number(),
        topVideos: v.array(topVideoValidator),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("competitors")
      .withIndex("by_owner_niche", (q) =>
        q.eq("ownerId", args.ownerId).eq("niche", args.niche),
      )
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);

    const now = Date.now();
    for (const c of args.competitors) {
      await ctx.db.insert("competitors", {
        ownerId: args.ownerId,
        niche: args.niche,
        channelName: c.channelName,
        totalViews: c.totalViews,
        videoCount: c.videoCount,
        topVideos: c.topVideos,
        refreshedAt: now,
      });
    }
    return args.competitors.length;
  },
});

export const listCompetitors = query({
  args: { ownerId: v.string(), niche: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("competitors")
      .withIndex("by_owner_niche", (q) =>
        q.eq("ownerId", args.ownerId).eq("niche", args.niche),
      )
      .collect();
  },
});
