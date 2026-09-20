import { mutation, query } from "./studioFunctions";
import { v } from "convex/values";
import { appendRunLogChunks, readRunLogTail, runLogLineValidator } from "./runLogChunks";

/**
 * Streamed console lines for a run (the runner's `ctx.log` output). Mirrors the
 * `runStages` query/mutation style. The existing sink batches transport; this
 * mutation also packs eligible lines into immutable, non-overlapping chunks.
 */
export const appendRunLogs = mutation({
  args: {
    ownerId: v.string(),
    runId: v.id("runs"),
    lines: v.array(runLogLineValidator),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    return appendRunLogChunks(ctx, args.ownerId, args.runId, args.lines);
  },
});

/**
 * Reactive log feed for a run. Returns the most recent `limit` lines (default
 * 1000) in chronological ascending order — newest-capped but oldest-first — so
 * the LogConsole can append at the bottom and auto-scroll. Ordering is stable
 * on (at, seq), merging the legacy index with disjoint immutable chunks.
 */
export const listRunLogs = query({
  args: {
    runId: v.id("runs"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 1000, 1), 5000);
    return readRunLogTail(ctx, args.runId, limit);
  },
});
