import { mutation, query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

/**
 * Analytics store (Tranche 5). Two write-paths, fed by the `stats-refresh`
 * Trigger task (src/trigger/statsRefresh.ts):
 *
 *   videoAnalytics   — per-video point-in-time snapshots (recordVideoSnapshot).
 *   channelAnalytics — per-channel daily rollup (upsertChannelDay), idempotent
 *                      on (channelId, date) with a computed subscriberDelta vs
 *                      the previous day.
 *
 * Reactive read-queries drive the Analytics page graphs/cards. They tolerate an
 * empty store (no snapshots yet) — every list/sum degrades to 0 / [], so the UI
 * renders clean empty states until the stats task has run at least once.
 */

// ----------------------------- Queries -----------------------------

/**
 * Daily channelAnalytics rows for one channel, ascending by date, optionally
 * windowed to the most-recent `days`. Drives the per-channel trend charts.
 */
export const channelTrend = query({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("channelAnalytics")
      .withIndex("by_channel_date", (q) => q.eq("channelId", args.channelId))
      .collect();
    // Tenancy guard + chronological order.
    const owned = rows
      .filter((r) => r.ownerId === args.ownerId)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (args.days && args.days > 0) return owned.slice(-args.days);
    return owned;
  },
});

/**
 * Global rollup across all of the owner's channels:
 *   - totalSubscribers — Σ latest subscriberCount per channel
 *   - totalViews       — Σ latest totalViews per channel
 *   - totalCost        — Σ runs.costTotal (the real spend, from the runs table)
 *   - videoCount       — # runs that produced a youtubeVideoId
 *   - channelCount     — # channels
 */
export const overview = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();

    let totalSubscribers = 0;
    let totalViews = 0;
    for (const ch of channels) {
      const latest = await latestChannelDay(ctx, ch._id);
      if (latest) {
        totalSubscribers += latest.subscriberCount;
        totalViews += latest.totalViews;
      }
    }

    const runs = await ctx.db
      .query("runs")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    const totalCost = runs.reduce((sum, r) => sum + (r.costTotal ?? 0), 0);
    const videoCount = runs.filter((r) => Boolean(r.youtubeVideoId)).length;

    return {
      totalSubscribers,
      totalViews,
      totalCost,
      videoCount,
      channelCount: channels.length,
    };
  },
});

/**
 * Per-channel rollup for the comparison view (one entry per channel):
 *   { channelId, name, slug, niche, subscriberCount (latest), totalViews
 *     (latest), videoCount (runs w/ a youtubeVideoId), costTotal (Σ runs) }.
 */
export const channelSummary = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();

    return await Promise.all(
      channels.map(async (ch) => {
        const latest = await latestChannelDay(ctx, ch._id);
        const runs = await ctx.db
          .query("runs")
          .withIndex("by_channel", (q) => q.eq("channelId", ch._id))
          .collect();
        const costTotal = runs.reduce((s, r) => s + (r.costTotal ?? 0), 0);
        const videoCount = runs.filter((r) => Boolean(r.youtubeVideoId)).length;
        return {
          channelId: ch._id,
          name: ch.name,
          slug: ch.slug,
          niche: ch.identity?.niche ?? null,
          subscriberCount: latest?.subscriberCount ?? 0,
          totalViews: latest?.totalViews ?? 0,
          videoCount,
          costTotal,
        };
      }),
    );
  },
});

/**
 * Owner-wide daily analytics rows across ALL channels, joined with channel name.
 * Drives the main-overview growth charts (subscriber growth, monetization
 * progress, estimated revenue). Sorted by date asc.
 */
export const ownerTrends = query({
  args: { ownerId: v.string(), days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    const out: Array<{
      date: string; channelId: string; channelName: string;
      subscriberCount: number; subscriberDelta: number; totalViews: number;
      totalWatchHours: number; estimatedRevenueUsd: number;
    }> = [];
    // Per-channel window: newest `days` rows straight off the (channelId, date)
    // index instead of collecting each channel's full history. 365-day cap
    // bounds the unwindowed call.
    const window = args.days && args.days > 0 ? args.days : 365;
    for (const ch of channels) {
      const sliced = (
        await ctx.db
          .query("channelAnalytics")
          .withIndex("by_channel_date", (q) => q.eq("channelId", ch._id))
          .order("desc")
          .take(window)
      )
        .filter((r) => r.ownerId === args.ownerId)
        .reverse(); // back to date asc
      for (const r of sliced) {
        out.push({
          date: r.date,
          channelId: ch._id,
          channelName: ch.name,
          subscriberCount: r.subscriberCount,
          subscriberDelta: r.subscriberDelta,
          totalViews: r.totalViews,
          totalWatchHours: r.totalWatchHours ?? 0,
          estimatedRevenueUsd: r.estimatedRevenueUsd ?? 0,
        });
      }
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  },
});

/** Latest (most recent date) channelAnalytics row for a channel, or null. */
async function latestChannelDay(ctx: QueryCtx, channelId: Id<"channels">) {
  // Index is (channelId, date) and date is YYYY-MM-DD, so desc-first IS the
  // latest day — no need to collect the channel's entire history.
  return await ctx.db
    .query("channelAnalytics")
    .withIndex("by_channel_date", (q) => q.eq("channelId", channelId))
    .order("desc")
    .first();
}

// ---------------------------- Mutations ----------------------------

/** Insert one per-video snapshot row (append-only). Used by stats-refresh. */
export const recordVideoSnapshot = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    youtubeVideoId: v.string(),
    views: v.number(),
    likes: v.number(),
    comments: v.number(),
    watchTimeHours: v.optional(v.number()),
    estimatedRevenueUsd: v.optional(v.number()),
    ctr: v.optional(v.number()),
    rpm: v.optional(v.number()),
    snapshotAt: v.optional(v.number()),
  },
  returns: v.id("videoAnalytics"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("videoAnalytics", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      youtubeVideoId: args.youtubeVideoId,
      views: args.views,
      likes: args.likes,
      comments: args.comments,
      watchTimeHours: args.watchTimeHours,
      estimatedRevenueUsd: args.estimatedRevenueUsd,
      ctr: args.ctr,
      rpm: args.rpm,
      snapshotAt: args.snapshotAt ?? Date.now(),
    });
  },
});

/**
 * Idempotent per-channel daily rollup. Keyed on (channelId, date): a re-run for
 * the same UTC day patches the existing row instead of appending. subscriberDelta
 * is computed vs the most-recent PRIOR day's subscriberCount (0 on first ever
 * row, so day-one shows no spurious delta).
 */
export const upsertChannelDay = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    date: v.string(),
    totalViews: v.number(),
    totalWatchHours: v.optional(v.number()),
    subscriberCount: v.number(),
    videoCount: v.number(),
    estimatedRevenueUsd: v.optional(v.number()),
  },
  returns: v.id("channelAnalytics"),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("channelAnalytics")
      .withIndex("by_channel_date", (q) => q.eq("channelId", args.channelId))
      .collect();

    const sameDay = rows.find((r) => r.date === args.date);
    // Most-recent prior day strictly before `date`, for the subscriber delta.
    const prior = rows
      .filter((r) => r.date < args.date)
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const subscriberDelta = prior
      ? args.subscriberCount - prior.subscriberCount
      : 0;

    const doc = {
      ownerId: args.ownerId,
      channelId: args.channelId,
      date: args.date,
      totalViews: args.totalViews,
      totalWatchHours: args.totalWatchHours,
      subscriberCount: args.subscriberCount,
      subscriberDelta,
      videoCount: args.videoCount,
      estimatedRevenueUsd: args.estimatedRevenueUsd,
    };

    if (sameDay) {
      await ctx.db.patch(sameDay._id, doc);
      return sameDay._id;
    }
    return await ctx.db.insert("channelAnalytics", doc);
  },
});
