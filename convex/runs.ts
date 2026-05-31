import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const createRun = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    status: v.optional(v.string()),
  },
  returns: v.id("runs"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("runs", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      status: args.status ?? "queued",
      startedAt: Date.now(),
      costTotal: 0,
    });
  },
});

export const updateRun = mutation({
  args: {
    runId: v.id("runs"),
    status: v.optional(v.string()),
    finishedAt: v.optional(v.number()),
    costTotal: v.optional(v.number()),
    error: v.optional(v.string()),
    videoAssetId: v.optional(v.id("assets")),
    youtubeVideoId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { runId, ...rest } = args;
    const existing = await ctx.db.get(runId);
    if (!existing) throw new Error(`run not found: ${runId}`);
    const patch: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(rest)) {
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch(runId, patch);
    return null;
  },
});

export const getRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.runId);
  },
});

export const listRunsByChannel = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("runs")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .collect();
  },
});

/**
 * Recent runs for an owner, newest first, enriched with the channel name.
 * Powers the minimal dashboard page (read-only).
 */
export const listRecent = query({
  args: { ownerId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    runs.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    const limited = runs.slice(0, args.limit ?? 10);
    return await Promise.all(
      limited.map(async (run) => {
        const channel = await ctx.db.get(run.channelId);
        return {
          _id: run._id,
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          costTotal: run.costTotal,
          youtubeVideoId: run.youtubeVideoId,
          error: run.error,
          channelName: channel?.name ?? "(unknown)",
          channelSlug: channel?.slug ?? "",
        };
      }),
    );
  },
});
