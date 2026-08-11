import { mutation, query } from "./studioFunctions";
import { v } from "convex/values";

/**
 * Project-wide "current goal" record (see schema.ts `projectGoals`). This is
 * intentionally NOT per-owner scoped — there is one project and one active
 * goal at a time. `getCurrentGoal` returns the most recently updated row so
 * both automation and Daniel can check what the project is working toward.
 */
export const getCurrentGoal = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("projectGoals")
      .withIndex("by_updatedAt")
      .order("desc")
      .first();
  },
});

export const setGoal = mutation({
  args: {
    statement: v.string(),
    priorities: v.array(v.string()),
    setBy: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("projectGoals", {
      statement: args.statement,
      priorities: args.priorities,
      setBy: args.setBy,
      updatedAt: Date.now(),
    });
  },
});
