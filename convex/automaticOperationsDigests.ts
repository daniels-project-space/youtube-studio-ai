import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import { v } from "convex/values";

export const latest = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("automaticOperationsDigests")
      .withIndex("by_owner_created", (q) => q.eq("ownerId", args.ownerId))
      .order("desc")
      .first();
    return row ? {
      weekStart: row.weekStart,
      weekEnd: row.weekEnd,
      fingerprint: row.fingerprint,
      digest: row.digest,
      createdAt: row.createdAt,
    } : null;
  },
});

export const record = mutation({
  args: {
    ownerId: v.string(),
    weekStart: v.number(),
    weekEnd: v.number(),
    fingerprint: v.string(),
    digest: v.any(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "automatic operations digest write");
    if (!Number.isSafeInteger(args.weekStart) || !Number.isSafeInteger(args.weekEnd) ||
        args.weekEnd < args.weekStart || !Number.isSafeInteger(args.createdAt) ||
        args.weekStart < 0 || args.weekEnd < 0 || args.createdAt < 0 ||
        !/^[a-f0-9]{64}$/.test(args.fingerprint)) {
      throw new Error("automatic operations digest identity is invalid");
    }
    const existing = await ctx.db
      .query("automaticOperationsDigests")
      .withIndex("by_owner_week", (q) => q.eq("ownerId", args.ownerId).eq("weekStart", args.weekStart))
      .first();
    if (existing) {
      if (existing.fingerprint !== args.fingerprint || existing.weekEnd !== args.weekEnd) {
        throw new Error("automatic operations digest changed after snapshot");
      }
      return { reused: true, id: existing._id };
    }
    const id = await ctx.db.insert("automaticOperationsDigests", {
      ownerId: args.ownerId,
      weekStart: args.weekStart,
      weekEnd: args.weekEnd,
      fingerprint: args.fingerprint,
      digest: args.digest,
      createdAt: args.createdAt,
    });
    return { reused: false, id };
  },
});
