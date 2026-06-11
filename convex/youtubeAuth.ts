import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Per-channel YouTube OAuth token store. Each app channel can hold its own
 * refresh token so it uploads to its OWN YouTube channel. Read server-side by
 * the upload_draft block (via ConvexHttpClient); never surfaced to the browser.
 */

/** Upsert the token for a channel (called after the consent → code exchange). */
export const set = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    refreshToken: v.string(),
    ytChannelId: v.optional(v.string()),
    ytTitle: v.optional(v.string()),
    updatedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("youtubeAuth")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        refreshToken: args.refreshToken,
        ytChannelId: args.ytChannelId,
        ytTitle: args.ytTitle,
        updatedAt: args.updatedAt,
      });
    } else {
      await ctx.db.insert("youtubeAuth", args);
    }
    return null;
  },
});

/** The token row for a channel (or null). Server-only consumers. */
export const getForChannel = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("youtubeAuth")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .unique();
  },
});

/** Lightweight link status for the UI (NO token) — which channels are linked. */
export const linkStatus = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("youtubeAuth")
      .collect();
    return rows
      .filter((r) => r.ownerId === args.ownerId)
      .map((r) => ({ channelId: r.channelId, ytTitle: r.ytTitle ?? null, ytChannelId: r.ytChannelId ?? null, updatedAt: r.updatedAt }));
  },
});
