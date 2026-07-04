import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** The upcoming-videos queue for a channel, soonest first. */
export const listPlan = query({
  args: { ownerId: v.string(), channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("contentPlan")
      .withIndex("by_channel_order", (q) => q.eq("channelId", args.channelId))
      .collect();
    return rows
      .filter((r) => r.ownerId === args.ownerId)
      .sort((a, b) => a.order - b.order);
  },
});

/**
 * ALL planned items across the owner's channels, joined with channel name +
 * cadence (drives the Schedule calendar — dates are projected client-side from
 * each channel's cadence + the item order). Soonest-first per channel.
 */
export const listPlanByOwner = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    const rows = (
      await ctx.db
        .query("contentPlan")
        .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
        .collect()
    ).sort((a, b) => a.order - b.order);

    const chCache = new Map<string, { name: string; slug: string; cadence: string; frequency: string; days?: number[] } | null>();
    const getCh = async (id: string) => {
      if (chCache.has(id)) return chCache.get(id)!;
      const ch = await ctx.db.get(id as typeof rows[number]["channelId"]);
      const cadence = ch?.identity?.cadence ?? "weekly";
      const val = ch
        ? {
            name: ch.name,
            slug: ch.slug,
            cadence,
            frequency: ch.schedule?.frequency ?? cadence,
            days: ch.schedule?.days,
          }
        : null;
      chCache.set(id, val);
      return val;
    };

    const out = [];
    for (const r of rows) {
      if (r.status === "used") continue; // already produced
      const ch = await getCh(r.channelId);
      out.push({
        _id: r._id,
        channelId: r.channelId,
        channelName: ch?.name ?? "(unknown)",
        channelSlug: ch?.slug ?? "",
        cadence: ch?.cadence ?? "weekly",
        frequency: ch?.frequency ?? ch?.cadence ?? "weekly",
        days: ch?.days,
        order: r.order,
        topic: r.topic,
        title: r.title,
        thumbnailKey: r.thumbnailKey,
        status: r.status,
        scheduledAt: r.scheduledAt,
      });
    }
    return out;
  },
});

/** Pin (or clear) a planned item's calendar date — drag-to-reschedule / date field. */
export const setScheduledAt = mutation({
  args: { id: v.id("contentPlan"), scheduledAt: v.union(v.number(), v.null()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { scheduledAt: args.scheduledAt ?? undefined });
    return null;
  },
});

/** Append planned topics (status "generating"); the task fills them in. */
export const addItems = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    topics: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("contentPlan")
      .withIndex("by_channel_order", (q) => q.eq("channelId", args.channelId))
      .collect();
    let order = existing.length ? Math.max(...existing.map((r) => r.order)) + 1 : 0;
    const ids = [];
    for (const topic of args.topics) {
      ids.push(
        await ctx.db.insert("contentPlan", {
          ownerId: args.ownerId,
          channelId: args.channelId,
          order: order++,
          topic,
          status: "generating",
          createdAt: Date.now(),
        }),
      );
    }
    return ids;
  },
});

/** Fill in a planned item's generated title/description/thumbnail. */
export const setGenerated = mutation({
  args: {
    id: v.id("contentPlan"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    thumbnailKey: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...patch } = args;
    await ctx.db.patch(id, { ...patch, status: args.status ?? "ready" });
  },
});

export const deleteItem = mutation({
  args: { id: v.id("contentPlan") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

/** Drag-reorder: rewrite `order` to match the given id sequence. */
export const reorder = mutation({
  args: { ids: v.array(v.id("contentPlan")) },
  handler: async (ctx, args) => {
    for (let i = 0; i < args.ids.length; i++) {
      await ctx.db.patch(args.ids[i], { order: i });
    }
  },
});
