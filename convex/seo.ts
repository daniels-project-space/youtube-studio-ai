import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * SEO / niche-intelligence store (competitor-intelligence engine, v1 port).
 *
 *   nicheIntelligence — title/tag/thumbnail signals mined from YouTube Data API
 *                       v3 + Gemini Vision (one row per ownerId+niche).
 *   seoDatabank       — Gemini-synthesised strategy (title templates, hooks,
 *                       gaps) derived from the competitor corpus.
 *
 * `viewEstimate` ports the legacy overlap-weighted view predictor verbatim.
 */

const thumbnailStyleGuideValidator = v.object({
  dominantColors: v.array(v.string()),
  hasTextOverlayPct: v.number(),
  notes: v.string(),
});

/** Upsert (replace) the mined niche-intelligence row for (ownerId, niche). */
export const upsertNiche = mutation({
  args: {
    ownerId: v.string(),
    niche: v.string(),
    topTitlePatterns: v.array(v.any()),
    powerWords: v.array(v.any()),
    optimalTitleLen: v.number(),
    topTags: v.array(v.any()),
    avgViewsTop50: v.number(),
    medianViewsTop50: v.number(),
    thumbnailStyleGuide: thumbnailStyleGuideValidator,
  },
  returns: v.id("nicheIntelligence"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("nicheIntelligence")
      .withIndex("by_owner_niche", (q) =>
        q.eq("ownerId", args.ownerId).eq("niche", args.niche),
      )
      .unique();
    const doc = {
      ownerId: args.ownerId,
      niche: args.niche,
      topTitlePatterns: args.topTitlePatterns,
      powerWords: args.powerWords,
      optimalTitleLen: args.optimalTitleLen,
      topTags: args.topTags,
      avgViewsTop50: args.avgViewsTop50,
      medianViewsTop50: args.medianViewsTop50,
      thumbnailStyleGuide: args.thumbnailStyleGuide,
      refreshedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, doc);
      return existing._id;
    }
    return await ctx.db.insert("nicheIntelligence", doc);
  },
});

export const getNiche = query({
  args: { ownerId: v.string(), niche: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("nicheIntelligence")
      .withIndex("by_owner_niche", (q) =>
        q.eq("ownerId", args.ownerId).eq("niche", args.niche),
      )
      .unique();
  },
});

/** Upsert (replace) the derived SEO databank for (ownerId, niche). */
export const upsertDatabank = mutation({
  args: {
    ownerId: v.string(),
    niche: v.string(),
    channelId: v.optional(v.id("channels")),
    titleTemplates: v.array(v.string()),
    tagClusters: v.array(v.any()),
    thumbnailRules: v.array(v.string()),
    hookPatterns: v.array(v.string()),
    competitorGaps: v.array(v.string()),
  },
  returns: v.id("seoDatabank"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("seoDatabank")
      .withIndex("by_owner_niche", (q) =>
        q.eq("ownerId", args.ownerId).eq("niche", args.niche),
      )
      .unique();
    const doc = {
      ownerId: args.ownerId,
      niche: args.niche,
      channelId: args.channelId,
      titleTemplates: args.titleTemplates,
      tagClusters: args.tagClusters,
      thumbnailRules: args.thumbnailRules,
      hookPatterns: args.hookPatterns,
      competitorGaps: args.competitorGaps,
      refreshedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, doc);
      return existing._id;
    }
    return await ctx.db.insert("seoDatabank", doc);
  },
});

export const getDatabank = query({
  args: { ownerId: v.string(), niche: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("seoDatabank")
      .withIndex("by_owner_niche", (q) =>
        q.eq("ownerId", args.ownerId).eq("niche", args.niche),
      )
      .unique();
  },
});

/**
 * Overlap-weighted view predictor (ported verbatim from legacy autostudio).
 *
 *   overlap = |myTags ∩ competitorVideo.tags| (case-insensitive)
 *   keep videos with overlap > 0; sort desc; take top 20.
 *   if ≥3 matches:  estimate = Σ(views·overlap) / Σ(overlap)
 *   else:           fall back to niche median (or avg) views of the top 50.
 */
export const viewEstimate = query({
  args: {
    ownerId: v.string(),
    niche: v.string(),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const myTags = new Set(
      args.tags.map((t) => t.toLowerCase().trim()).filter(Boolean),
    );

    const niche = await ctx.db
      .query("nicheIntelligence")
      .withIndex("by_owner_niche", (q) =>
        q.eq("ownerId", args.ownerId).eq("niche", args.niche),
      )
      .unique();
    const fallback =
      (niche?.medianViewsTop50 || niche?.avgViewsTop50 || 0) as number;

    if (myTags.size === 0) {
      return { estimatedViews: fallback, source: "niche_fallback" as const };
    }

    const competitorRows = await ctx.db
      .query("competitors")
      .withIndex("by_owner_niche", (q) =>
        q.eq("ownerId", args.ownerId).eq("niche", args.niche),
      )
      .collect();

    const scored: { views: number; overlap: number }[] = [];
    for (const row of competitorRows) {
      for (const vid of row.topVideos) {
        let overlap = 0;
        for (const t of vid.tags) {
          if (myTags.has(t.toLowerCase().trim())) overlap++;
        }
        if (overlap > 0) scored.push({ views: vid.views, overlap });
      }
    }

    scored.sort((a, b) => b.overlap - a.overlap);
    const top = scored.slice(0, 20);

    if (top.length >= 3) {
      let num = 0;
      let den = 0;
      for (const s of top) {
        num += s.views * s.overlap;
        den += s.overlap;
      }
      const estimate = den > 0 ? Math.round(num / den) : fallback;
      return {
        estimatedViews: estimate,
        source: "tag_overlap" as const,
        matches: top.length,
      };
    }

    return {
      estimatedViews: fallback,
      source: "niche_fallback" as const,
      matches: top.length,
    };
  },
});
