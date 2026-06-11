/**
 * Niche-research CORE (competitor-intelligence engine, faithful v1 port).
 *
 * Pure library module — NO Trigger `task()` side effects — so both the
 * `competitor_research` pipeline block and the `refresh-niche-research`
 * Trigger task can import it without instantiating tasks at load time.
 *
 * Mines YouTube Data API v3 for a niche, analyses titles/tags/thumbnails, and
 * writes nicheIntelligence + competitors + seoDatabank to Convex.
 *
 * SOURCE: YouTube Data API v3 ONLY (locked decision — no web search).
 * Graceful degradation: any missing key is logged and that stage is skipped.
 * Freshness guard: skips if data is < 7 days old unless `force`.
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  hasYouTubeDataAccess,
  searchVideoIds,
  fetchVideoDetails,
  type VideoDetail,
} from "@/lib/youtubeData";
import {
  analyzeTitles,
  aggregateCompetitors,
  bestPerformers,
  aggStats,
} from "@/lib/nicheAnalysis";
import {
  hasGeminiKey,
  geminiJson,
  geminiVision,
  parseJsonLoose,
} from "@/lib/gemini";
import { NICHES } from "@/lib/nicheCatalog";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PUBLISHED_AFTER = "2024-01-01T00:00:00Z";

export type Logger = (msg: string, extra?: Record<string, unknown>) => void;

function convexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

function nicheQueries(niche: string): string[] {
  // Prefer the catalog's curated subcategory SEO tags as the search queries. The
  // bare niche label ("Lo-Fi Music") is hijacked on YouTube by tag-spammed,
  // massive-view content from adjacent markets (e.g. regional pop / devotional),
  // which polluted the competitor set and the thumbnail-vision grounding. The
  // subcategory tags ("lofi hip hop", "study music", "lofi radio", "chillhop",
  // "rain sounds", …) surface the ACTUAL channels in the niche.
  const cat = NICHES.find((n) => n.label.toLowerCase() === niche.toLowerCase());
  if (cat) {
    const keyTokens = cat.key.split(/[-\s]/).filter((t) => t.length > 2);
    const allTags = Array.from(new Set(cat.subcategories.flatMap((s) => s.tags)));
    // Prefer tags that CONTAIN the niche's signature token (e.g. "lofi") — the
    // discriminating ones. Bare adjacent terms ("study music", "sleep music",
    // "rain sounds") are dominated on YouTube by kids/sleep-aid + regional-pop
    // mega-channels and pollute the competitor set + thumbnail grounding.
    const specific = allTags.filter((t) => keyTokens.some((k) => t.toLowerCase().includes(k)));
    if (specific.length >= 4) return specific.slice(0, 8);
    // Otherwise QUALIFY each subcategory's primary term with the niche key so the
    // search disambiguates (e.g. "study music" → "lofi study music").
    const qualified = cat.subcategories
      .map((s) => s.tags[0])
      .filter(Boolean)
      .map((t) => (keyTokens.some((k) => t.toLowerCase().includes(k)) ? t : `${cat.key} ${t}`));
    const queries = Array.from(new Set(qualified)).slice(0, 8);
    if (queries.length) return queries;
  }
  return [niche, `best ${niche}`, `${niche} 2024`, `${niche} 2025`];
}

export interface RefreshArgs {
  ownerId: string;
  niche: string;
  channelId?: string;
  force?: boolean;
}

export interface RefreshResult {
  ok: boolean;
  skipped?: "fresh" | "no_youtube_key";
  niche: string;
  videosAnalysed?: number;
  competitorCount?: number;
  databankWritten?: boolean;
  styleGuideSource?: "gemini" | "minimal";
}

export async function refreshNicheResearchCore(
  args: RefreshArgs,
  log: Logger = () => {},
): Promise<RefreshResult> {
  const convex = convexClient();

  if (!args.force) {
    const existing = await convex.query(api.seo.getNiche, {
      ownerId: args.ownerId,
      niche: args.niche,
    });
    if (existing && Date.now() - existing.refreshedAt < WEEK_MS) {
      log(`niche "${args.niche}" is fresh (<7d) — skipping`);
      return { ok: true, skipped: "fresh", niche: args.niche };
    }
  }

  if (!hasYouTubeDataAccess()) {
    log("no YouTube Data access (API key or OAuth) — skipping niche research gracefully");
    return { ok: true, skipped: "no_youtube_key", niche: args.niche };
  }

  // 1. Search + hydrate video details.
  const ids = new Set<string>();
  for (const q of nicheQueries(args.niche)) {
    try {
      for (const id of await searchVideoIds({
        query: q,
        maxResults: 25,
        publishedAfter: PUBLISHED_AFTER,
        relevanceLanguage: "en",
      })) {
        ids.add(id);
      }
    } catch (e) {
      log(`search failed for "${q}": ${e instanceof Error ? e.message : e}`);
    }
  }
  let videos: VideoDetail[] = [];
  try {
    videos = await fetchVideoDetails([...ids]);
  } catch (e) {
    log(`videos.list failed: ${e instanceof Error ? e.message : e}`);
  }
  if (videos.length === 0) {
    log("no competitor videos resolved — aborting research cleanly");
    return { ok: true, niche: args.niche, videosAnalysed: 0 };
  }

  // 2. Aggregate competitors + best performers.
  const competitors = aggregateCompetitors(videos);
  const best = bestPerformers(videos, 50);
  const stats = aggStats(videos);

  // 3. Title / tag analysis.
  const { topTitlePatterns, powerWords, optimalTitleLen, topTags } =
    analyzeTitles(best);

  // 4. Thumbnail style guide (Gemini Vision over ~8 top thumbnails).
  let styleGuide = {
    dominantColors: [] as string[],
    hasTextOverlayPct: 0,
    notes: "minimal guide (no Gemini key or vision call failed)",
  };
  let styleGuideSource: "gemini" | "minimal" = "minimal";
  if (hasGeminiKey()) {
    const thumbUrls = best
      .map((v) => v.thumbnailUrl)
      .filter(Boolean)
      .slice(0, 8);
    if (thumbUrls.length) {
      try {
        const raw = await geminiVision({
          prompt:
            "You are a YouTube thumbnail analyst. Examine these top-performing " +
            `thumbnails for the niche "${args.niche}". AGGREGATE ALL of them into ` +
            "ONE summary (do NOT return a per-image array). Return ONLY a single " +
            'JSON OBJECT: {"dominantColors": ["#hex", ...up to 5 across the set], ' +
            '"hasTextOverlayPct": 0-100 (percent of thumbnails with bold text ' +
            'overlay), "notes": "3-4 sentence style summary — recurring subject, ' +
            'composition, faces vs scenery, contrast, mood; call out anything ' +
            'that looks OFF-NICHE for this topic"}.',
          imageUrls: thumbUrls,
          json: true,
          // 700 truncated mid-JSON (finishReason MAX_TOKENS) once the model
          // described several images → parse failed → silent "minimal" guide.
          maxTokens: 2048,
        });
        const parsed = parseJsonLoose<{
          dominantColors?: string[];
          hasTextOverlayPct?: number;
          notes?: string;
        }>(raw);
        styleGuide = {
          dominantColors: parsed.dominantColors ?? [],
          hasTextOverlayPct: Number(parsed.hasTextOverlayPct) || 0,
          notes: parsed.notes ?? styleGuide.notes,
        };
        styleGuideSource = "gemini";
      } catch (e) {
        log(`gemini vision style guide failed: ${e instanceof Error ? e.message : e}`);
      }
    }
  } else {
    log("GEMINI_API_KEY missing — storing minimal thumbnail style guide");
  }

  // Persist niche intelligence + competitors.
  await convex.mutation(api.seo.upsertNiche, {
    ownerId: args.ownerId,
    niche: args.niche,
    topTitlePatterns,
    powerWords,
    optimalTitleLen,
    topTags,
    avgViewsTop50: stats.avgViewsTop50,
    medianViewsTop50: stats.medianViewsTop50,
    thumbnailStyleGuide: styleGuide,
  });
  await convex.mutation(api.competitors.upsertCompetitors, {
    ownerId: args.ownerId,
    niche: args.niche,
    competitors: competitors.map((c) => ({
      channelName: c.channelName,
      totalViews: c.totalViews,
      videoCount: c.videoCount,
      topVideos: c.topVideos,
    })),
  });

  // 5. SEO databank via Gemini 2.5 Flash (json mode).
  let databankWritten = false;
  if (hasGeminiKey()) {
    const topTitles = best.slice(0, 30).map((v) => v.title);
    const tagSample = topTags.slice(0, 25).map((t) => t.tag);
    try {
      const databank = await geminiJson<{
        titleTemplates?: string[];
        tagClusters?: unknown[];
        thumbnailRules?: string[];
        hookPatterns?: string[];
        competitorGaps?: string[];
      }>({
        prompt:
          "You are an expert YouTube SEO strategist. Given top-performing " +
          `competitor data for the niche "${args.niche}", produce a strategy ` +
          "databank. Return ONLY JSON with keys: titleTemplates (8-10 " +
          "fill-in-the-blank templates using [BRACKETS] for variables), " +
          "tagClusters (array of {name, tags:[...]}), thumbnailRules (array of " +
          "short imperative rules), hookPatterns (array of opening-hook " +
          "formulas), competitorGaps (array of underserved angles competitors " +
          "miss).\n\n" +
          `TOP TITLES:\n${topTitles.join("\n")}\n\n` +
          `COMMON TAGS: ${tagSample.join(", ")}\n` +
          `TITLE PATTERNS: ${topTitlePatterns
            .map((p) => `${p.pattern}(${p.count})`)
            .join(", ")}\n` +
          `POWER WORDS: ${powerWords.map((p) => p.word).join(", ")}`,
        maxTokens: 2048,
      });
      await convex.mutation(api.seo.upsertDatabank, {
        ownerId: args.ownerId,
        niche: args.niche,
        channelId: args.channelId
          ? (args.channelId as Id<"channels">)
          : undefined,
        titleTemplates: databank.titleTemplates ?? [],
        tagClusters: (databank.tagClusters ?? []) as unknown[],
        thumbnailRules: databank.thumbnailRules ?? [],
        hookPatterns: databank.hookPatterns ?? [],
        competitorGaps: databank.competitorGaps ?? [],
      });
      databankWritten = true;
    } catch (e) {
      log(`gemini SEO databank failed: ${e instanceof Error ? e.message : e}`);
    }
  } else {
    log("GEMINI_API_KEY missing — skipping SEO databank synthesis");
  }

  log(
    `niche "${args.niche}" refreshed: ${videos.length} videos, ` +
      `${competitors.length} competitors, databank=${databankWritten}`,
  );
  return {
    ok: true,
    niche: args.niche,
    videosAnalysed: videos.length,
    competitorCount: competitors.length,
    databankWritten,
    styleGuideSource,
  };
}
