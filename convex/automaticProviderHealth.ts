import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import { v } from "convex/values";
import { nextProviderCircuitState } from "../src/lib/automaticOperations";

export const listForOwner = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "automatic provider health read");
    return await ctx.db.query("automaticProviderHealth")
      .withIndex("by_owner_updated", (q) => q.eq("ownerId", args.ownerId))
      .order("desc")
      .collect();
  },
});

export const recordOutcome = mutation({
  args: {
    ownerId: v.string(),
    provider: v.string(),
    outcome: v.union(v.literal("success"), v.literal("failure")),
    now: v.number(),
  },
  returns: v.object({ status: v.union(v.literal("closed"), v.literal("open"), v.literal("half_open")), consecutiveFailures: v.number(), nextProbeAt: v.optional(v.number()) }),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "automatic provider health write");
    if (!args.provider.trim() || !Number.isSafeInteger(args.now) || args.now < 0) {
      throw new Error("automatic provider health input is invalid");
    }
    const existing = await ctx.db.query("automaticProviderHealth")
      .withIndex("by_owner_provider", (q) => q.eq("ownerId", args.ownerId).eq("provider", args.provider))
      .unique();
    const next = nextProviderCircuitState({
      previous: existing ? {
        status: existing.status,
        consecutiveFailures: existing.consecutiveFailures,
        ...(existing.openedAt === undefined ? {} : { openedAt: existing.openedAt }),
        ...(existing.nextProbeAt === undefined ? {} : { nextProbeAt: existing.nextProbeAt }),
      } : undefined,
      outcome: args.outcome,
      now: args.now,
    });
    const row = {
      ownerId: args.ownerId,
      provider: args.provider,
      status: next.status,
      consecutiveFailures: next.consecutiveFailures,
      ...(next.openedAt === undefined ? {} : { openedAt: next.openedAt }),
      ...(next.nextProbeAt === undefined ? {} : { nextProbeAt: next.nextProbeAt }),
      updatedAt: args.now,
    };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("automaticProviderHealth", row);
    return { status: next.status, consecutiveFailures: next.consecutiveFailures, ...(next.nextProbeAt === undefined ? {} : { nextProbeAt: next.nextProbeAt }) };
  },
});
