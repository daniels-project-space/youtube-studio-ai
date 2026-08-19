import { mutation, query } from "./studioFunctions";
import { v } from "convex/values";

/**
 * Daily spend ledger for the automatic Casefile case-research path.
 *
 * `researchCase()` (src/engine/casefileCaseResearcher.ts) is the one place in
 * this system that spends real money BEFORE `run-pipeline` starts, so it is
 * structurally outside every `invocation.budgetUsd` check. These two
 * functions are the counter behind the fleet-wide daily ceiling enforced in
 * `casefileAutoResearchDispatch.ts`.
 *
 * The `day` bucket is supplied by the caller (a UTC "YYYY-MM-DD" key) rather
 * than derived here, so the boundary is deterministic and unit-testable on
 * the TypeScript side instead of depending on Convex's clock.
 */

/** Fleet-wide (all channels for this owner) billable attempts already made in `day`. */
export const countForDay = query({
  args: { ownerId: v.string(), day: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("casefileResearchAttempts")
      .withIndex("by_owner_day", (q) => q.eq("ownerId", args.ownerId).eq("day", args.day))
      .collect();
    return rows.length;
  },
});

/**
 * Records ONE billable attempt. Called before `researchCase()` runs, not
 * after: research that crashes mid-flight has already paid for its
 * Browserbase sessions, so an attempt that is started must always be
 * counted.
 */
export const recordAttempt = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    day: v.string(),
  },
  returns: v.id("casefileResearchAttempts"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("casefileResearchAttempts", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      day: args.day,
      attemptedAt: Date.now(),
    });
  },
});
