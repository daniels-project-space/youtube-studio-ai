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

/**
 * The token row for a channel (or null). Server-only consumers.
 *
 * SECURITY: this returns a refreshToken, and Convex queries are publicly
 * callable — so it is gated behind INTERNAL_QUERY_SECRET. When that env var is
 * set on the deployment, callers MUST pass the matching `secret` or the query
 * throws (fail closed). When the env var is unset (dev / not yet provisioned),
 * legacy callers keep working; provision the secret in Convex + Trigger, then
 * update all call sites to pass `process.env.INTERNAL_QUERY_SECRET ?? ""`.
 */
export const getForChannel = query({
  args: { channelId: v.id("channels"), secret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const expected = process.env.INTERNAL_QUERY_SECRET;
    if (expected && args.secret !== expected) {
      throw new Error("getForChannel: invalid internal secret");
    }
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
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    return rows.map((r) => ({ channelId: r.channelId, ytTitle: r.ytTitle ?? null, ytChannelId: r.ytChannelId ?? null, updatedAt: r.updatedAt }));
  },
});
