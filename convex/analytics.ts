import type { QueryCtx } from "./_generated/server";
import { mutation, query } from "./studioFunctions";
import { v } from "convex/values";
import { observedVideoReleaseProvenanceFromRecord } from "../src/lib/videoReleaseProvenanceIntegrity";
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
    const planBatches = await ctx.db
      .query("planBatches")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    // Plan batches never create run rows, so adding their idempotent batch total
    // exposes real planner spend without double-counting pipeline cost.
    const planningCost = planBatches.reduce((sum, batch) => sum + batch.actualCostUsd, 0);
    const totalCost = runs.reduce((sum, r) => sum + (r.costTotal ?? 0), 0) + planningCost;
    const videoCount = runs.filter((r) => Boolean(r.youtubeVideoId)).length;

    return {
      totalSubscribers,
      totalViews,
      totalCost,
      planningCost,
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
        const planBatches = await ctx.db
          .query("planBatches")
          .withIndex("by_channel", (q) => q.eq("channelId", ch._id))
          .collect();
        const planningCost = planBatches
          .filter((batch) => batch.ownerId === args.ownerId)
          .reduce((sum, batch) => sum + batch.actualCostUsd, 0);
        const costTotal = runs.reduce((s, r) => s + (r.costTotal ?? 0), 0) + planningCost;
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
          planningCost,
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

/**
 * Per-video snapshots with the release mapping that was present at ingestion
 * time. `observedReleaseProvenance: null` is an honest historical/unlinked
 * state, not a failed quality or outcome assessment.
 */
export const videoSnapshotProvenance = query({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    youtubeVideoId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 30;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 180) {
      throw new Error("analytics.videoSnapshotProvenance: limit must be 1..180");
    }
    const rows = await ctx.db
      .query("videoAnalytics")
      .withIndex("by_video", (q) => q.eq("youtubeVideoId", args.youtubeVideoId))
      .order("desc")
      .take(limit);
    return rows
      .filter((row) => row.ownerId === args.ownerId && row.channelId === args.channelId)
      .map((row) => ({
        youtubeVideoId: row.youtubeVideoId,
        snapshotAt: row.snapshotAt,
        source: row.source ?? null,
        metricDefinitionVersion: row.metricDefinitionVersion ?? null,
        confidence: row.confidence ?? null,
        views: row.views,
        likes: row.likes,
        comments: row.comments,
        watchTimeHours: row.watchTimeHours ?? null,
        estimatedRevenueUsd: row.estimatedRevenueUsd ?? null,
        ctr: row.ctr ?? null,
        rpm: row.rpm ?? null,
        observedReleaseProvenance: row.observedReleaseProvenance ?? null,
      }));
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
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    ingestionId: v.id("analyticsIngestions"),
    source: v.union(
      v.literal("youtube_data_api"),
      v.literal("youtube_analytics_api"),
    ),
    metricDefinitionVersion: v.string(),
    windowStart: v.optional(v.string()),
    windowEnd: v.optional(v.string()),
    confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
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
    const expected = process.env.INTERNAL_QUERY_SECRET;
    if (!expected || args.secret !== expected) {
      throw new Error("analytics.recordVideoSnapshot: invalid internal secret");
    }
    const [channel, connector, ingestion] = await Promise.all([
      ctx.db.get(args.channelId),
      ctx.db.get(args.connectorId),
      ctx.db.get(args.ingestionId),
    ]);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("analytics.recordVideoSnapshot: channel owner mismatch");
    }
    if (
      !connector ||
      connector.ownerId !== args.ownerId ||
      connector.channelId !== args.channelId ||
      (connector.tokenVersion ?? 1) !== args.connectorVersion ||
      (connector.status ?? "active") !== "active"
    ) {
      throw new Error("analytics.recordVideoSnapshot: connector provenance mismatch");
    }
    if (
      !ingestion ||
      ingestion.ownerId !== args.ownerId ||
      ingestion.channelId !== args.channelId ||
      ingestion.connectorId !== args.connectorId ||
      ingestion.connectorVersion !== args.connectorVersion ||
      ingestion.source !== args.source
    ) {
      throw new Error("analytics.recordVideoSnapshot: ingestion provenance mismatch");
    }
    const existing = await ctx.db
      .query("videoAnalytics")
      .withIndex("by_ingestion_video", (q) =>
        q.eq("ingestionId", args.ingestionId).eq("youtubeVideoId", args.youtubeVideoId),
      )
      .unique();
    const releaseProvenance = await ctx.db
      .query("videoReleaseProvenance")
      .withIndex("by_owner_youtube_video", (q) =>
        q.eq("ownerId", args.ownerId).eq("youtubeVideoId", args.youtubeVideoId),
      )
      .unique();
    if (releaseProvenance && releaseProvenance.channelId !== args.channelId) {
      throw new Error("analytics.recordVideoSnapshot: release provenance channel mismatch");
    }
    const doc = {
      ownerId: args.ownerId,
      channelId: args.channelId,
      connectorId: args.connectorId,
      connectorVersion: args.connectorVersion,
      ingestionId: args.ingestionId,
      source: args.source,
      metricDefinitionVersion: args.metricDefinitionVersion,
      windowStart: args.windowStart,
      windowEnd: args.windowEnd,
      confidence: args.confidence,
      youtubeVideoId: args.youtubeVideoId,
      views: args.views,
      likes: args.likes,
      comments: args.comments,
      watchTimeHours: args.watchTimeHours,
      estimatedRevenueUsd: args.estimatedRevenueUsd,
      ctr: args.ctr,
      rpm: args.rpm,
      // Preserve the original observation on a replay. A later retry must not
      // turn release metadata that appeared afterwards into evidence observed
      // at the first snapshot time.
      ...(existing?.observedReleaseProvenance
        ? { observedReleaseProvenance: existing.observedReleaseProvenance }
        : !releaseProvenance
        ? {}
        : {
            observedReleaseProvenance: observedVideoReleaseProvenanceFromRecord(releaseProvenance),
          }),
      snapshotAt: existing?.snapshotAt ?? args.snapshotAt ?? Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, doc);
      return existing._id;
    }
    return await ctx.db.insert("videoAnalytics", doc);
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
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    ingestionId: v.id("analyticsIngestions"),
    source: v.literal("youtube_data_api"),
    metricDefinitionVersion: v.string(),
    confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    date: v.string(),
    totalViews: v.number(),
    totalWatchHours: v.optional(v.number()),
    subscriberCount: v.number(),
    videoCount: v.number(),
    estimatedRevenueUsd: v.optional(v.number()),
  },
  returns: v.id("channelAnalytics"),
  handler: async (ctx, args) => {
    const expected = process.env.INTERNAL_QUERY_SECRET;
    if (!expected || args.secret !== expected) {
      throw new Error("analytics.upsertChannelDay: invalid internal secret");
    }
    const [channel, connector, ingestion] = await Promise.all([
      ctx.db.get(args.channelId),
      ctx.db.get(args.connectorId),
      ctx.db.get(args.ingestionId),
    ]);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("analytics.upsertChannelDay: channel owner mismatch");
    }
    if (
      !connector ||
      connector.ownerId !== args.ownerId ||
      connector.channelId !== args.channelId ||
      (connector.tokenVersion ?? 1) !== args.connectorVersion ||
      (connector.status ?? "active") !== "active" ||
      !ingestion ||
      ingestion.connectorId !== args.connectorId ||
      ingestion.connectorVersion !== args.connectorVersion ||
      ingestion.channelId !== args.channelId
    ) {
      throw new Error("analytics.upsertChannelDay: connector provenance mismatch");
    }
    const sameDay = await ctx.db
      .query("channelAnalytics")
      .withIndex("by_channel_date", (q) =>
        q.eq("channelId", args.channelId).eq("date", args.date),
      )
      .unique();
    // The compound index can return the prior day directly. This avoids a
    // growing `.collect()` of every historical daily rollup on each refresh.
    const prior = await ctx.db
      .query("channelAnalytics")
      .withIndex("by_channel_date", (q) =>
        q.eq("channelId", args.channelId).lt("date", args.date),
      )
      .order("desc")
      .first();
    const subscriberDelta = prior
      ? args.subscriberCount - prior.subscriberCount
      : 0;

    const doc = {
      ownerId: args.ownerId,
      channelId: args.channelId,
      connectorId: args.connectorId,
      connectorVersion: args.connectorVersion,
      ingestionId: args.ingestionId,
      source: args.source,
      metricDefinitionVersion: args.metricDefinitionVersion,
      confidence: args.confidence,
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
