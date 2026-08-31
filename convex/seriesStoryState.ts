import { mutation, query } from "./studioFunctions";
import { v } from "convex/values";
import { mergeSeriesStoryState } from "@/lib/seriesStoryState";

/**
 * Real episodic story-state memory for series/episodic channels (Phase 4).
 *
 * `topic_select`'s SERIES MODE (src/trigger/blocks/lofiBlocks.ts) reads
 * `getForSeries` to ground its continuation LLM call in the real running
 * arc — not just prior episode titles — then writes the updated state back
 * via `recordEpisodeBeat` in the same call. A series with no row yet (first
 * episode, or a channel not using SERIES MODE) is unaffected: callers treat
 * `null` as "no story state" and fall back to today's exact behavior.
 *
 * This is PLOT continuity only (arc summary / plot beats / unresolved
 * threads / entity name+role). Wardrobe or appearance continuity is a
 * separate, non-overlapping concern owned elsewhere.
 */
export const getForSeries = query({
  args: { channelId: v.id("channels"), seriesTitle: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("seriesStoryState")
      .withIndex("by_channel_series", (q) =>
        q.eq("channelId", args.channelId).eq("seriesTitle", args.seriesTitle),
      )
      .collect();
    return rows[0] ?? null;
  },
});

/**
 * Serialized-program continuity is deliberately route-identity keyed.  Do
 * not fall back to the title-keyed legacy state: a renewed route may reuse a
 * human series title while starting a wholly new arc.
 */
export const getForSeriesIdentity = query({
  args: { channelId: v.id("channels"), seriesIdentity: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("seriesStoryState")
      .withIndex("by_channel_series_identity", (q) =>
        q.eq("channelId", args.channelId).eq("seriesIdentity", args.seriesIdentity),
      )
      .unique(),
});

export const recordEpisodeBeat = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    seriesTitle: v.string(),
    episode: v.number(),
    arcSummary: v.optional(v.string()),
    newPlotBeat: v.optional(v.string()),
    unresolvedThreads: v.optional(v.array(v.string())),
    newEntities: v.optional(
      v.array(
        v.object({
          name: v.string(),
          role: v.string(),
        }),
      ),
    ),
  },
  returns: v.id("seriesStoryState"),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("seriesStoryState")
      .withIndex("by_channel_series", (q) =>
        q.eq("channelId", args.channelId).eq("seriesTitle", args.seriesTitle),
      )
      .collect();
    const existingRow = rows[0] ?? null;

    const merged = mergeSeriesStoryState(
      existingRow
        ? {
            arcSummary: existingRow.arcSummary,
            plotBeats: existingRow.plotBeats,
            unresolvedThreads: existingRow.unresolvedThreads,
            entities: existingRow.entities,
            updatedAt: existingRow.updatedAt,
          }
        : null,
      {
        episode: args.episode,
        arcSummary: args.arcSummary,
        newPlotBeat: args.newPlotBeat,
        unresolvedThreads: args.unresolvedThreads,
        newEntities: args.newEntities,
      },
    );

    if (existingRow) {
      await ctx.db.patch(existingRow._id, merged);
      return existingRow._id;
    }
    return await ctx.db.insert("seriesStoryState", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      seriesTitle: args.seriesTitle,
      ...merged,
    });
  },
});
