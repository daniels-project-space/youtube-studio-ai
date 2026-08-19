/**
 * Niche-research CORE (competitor-intelligence engine, faithful v1 port).
 *
 * Pure library module — NO Trigger `task()` side effects — so both the
 * `competitor_research` pipeline block and the `refresh-niche-research`
 * Trigger task can import it without instantiating tasks at load time.
 *
 * Mines YouTube Data API v3 for a niche, analyses titles/tags and thumbnail
 * metadata availability, and writes nicheIntelligence + competitors +
 * seoDatabank to Convex.
 *
 * SOURCE: YouTube Data API v3 ONLY (locked decision — no web search).
 * Graceful degradation: any missing key is logged and that stage is skipped.
 * Freshness guard: skips if data is < 7 days old unless `force`.
 */
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
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
import { deriveNicheResearchFromYouTubeMetadata } from "@/lib/nicheResearchDerivation";
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
  styleGuideSource?: "youtube_data_api_v3_metadata";
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

  // 4. Derive only evidence that the already-collected YouTube metadata can
  // support. Visual thumbnail characteristics, opening hooks, and demand gaps
  // stay explicitly unavailable until their respective evidence exists.
  const derivation = deriveNicheResearchFromYouTubeMetadata({
    niche: args.niche,
    videos,
    topPerformers: best,
    topTitlePatterns,
    topTags,
  });
  const styleGuide = derivation.thumbnailStyleGuide;
  const styleGuideSource = "youtube_data_api_v3_metadata" as const;

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

  // 5. Persist the deterministic metadata databank. Its empty fields are
  // deliberate evidence boundaries, not a silent fallback.
  const databank = derivation.databank;
  let databankWritten = false;
  try {
    await convex.mutation(api.seo.upsertDatabank, {
      ownerId: args.ownerId,
      niche: args.niche,
      channelId: args.channelId
        ? (args.channelId as Id<"channels">)
        : undefined,
      titleTemplates: databank.titleTemplates,
      tagClusters: databank.tagClusters,
      thumbnailRules: databank.thumbnailRules,
      hookPatterns: databank.hookPatterns,
      competitorGaps: databank.competitorGaps,
      sourceAttribution: databank.sourceAttribution,
    });
    databankWritten = true;
  } catch (e) {
    log(`deterministic SEO databank write failed: ${e instanceof Error ? e.message : e}`);
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
