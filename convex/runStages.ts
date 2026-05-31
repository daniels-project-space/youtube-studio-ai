import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Upsert a per-block stage row for a run. Keyed by (runId, block) so the
 * runner can transition a stage queued -> running -> ok|failed idempotently.
 */
export const upsertRunStage = mutation({
  args: {
    ownerId: v.string(),
    runId: v.id("runs"),
    block: v.string(),
    status: v.string(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    cost: v.optional(v.number()),
    inputs: v.optional(v.any()),
    outputs: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  returns: v.id("runStages"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("runStages")
      .withIndex("by_run_block", (q) =>
        q.eq("runId", args.runId).eq("block", args.block),
      )
      .unique();

    if (existing) {
      const patch: Record<string, unknown> = { status: args.status };
      if (args.startedAt !== undefined) patch.startedAt = args.startedAt;
      if (args.finishedAt !== undefined) patch.finishedAt = args.finishedAt;
      if (args.cost !== undefined) patch.cost = args.cost;
      if (args.inputs !== undefined) patch.inputs = args.inputs;
      if (args.outputs !== undefined) patch.outputs = args.outputs;
      if (args.error !== undefined) patch.error = args.error;
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("runStages", {
      ownerId: args.ownerId,
      runId: args.runId,
      block: args.block,
      status: args.status,
      startedAt: args.startedAt,
      finishedAt: args.finishedAt,
      cost: args.cost ?? 0,
      inputs: args.inputs,
      outputs: args.outputs,
      error: args.error,
    });
  },
});

export const listRunStages = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("runStages")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
  },
});
