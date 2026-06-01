import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Streamed console lines for a run (the runner's `ctx.log` output). Mirrors the
 * `runStages` query/mutation style. `appendRunLogs` is a BATCH insert — the
 * runLogSink buffers lines and flushes many at once, so the run is never
 * blocked on one mutation per line.
 */
export const appendRunLogs = mutation({
  args: {
    ownerId: v.string(),
    runId: v.id("runs"),
    lines: v.array(
      v.object({
        block: v.optional(v.string()),
        level: v.string(),
        message: v.string(),
        at: v.number(),
        seq: v.optional(v.number()),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    for (const line of args.lines) {
      await ctx.db.insert("runLogs", {
        ownerId: args.ownerId,
        runId: args.runId,
        block: line.block,
        level: line.level,
        message: line.message,
        at: line.at,
        seq: line.seq,
      });
    }
    return args.lines.length;
  },
});

/**
 * Reactive log feed for a run. Returns the most recent `limit` lines (default
 * 1000) in chronological ascending order — newest-capped but oldest-first — so
 * the LogConsole can append at the bottom and auto-scroll. Ordering is stable
 * on (at, seq) via the `by_run_seq` index.
 */
export const listRunLogs = query({
  args: {
    runId: v.id("runs"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 1000, 1), 5000);
    // Pull newest-first off the ordered index, cap, then reverse to asc so the
    // console reads top→bottom oldest→newest.
    const newestFirst = await ctx.db
      .query("runLogs")
      .withIndex("by_run_seq", (q) => q.eq("runId", args.runId))
      .order("desc")
      .take(limit);
    return newestFirst.reverse();
  },
});
