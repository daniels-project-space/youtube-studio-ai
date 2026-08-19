/**
 * Deterministic, source-attributed niche-research derivation.
 *
 * This module deliberately works only with the fields already returned by the
 * YouTube Data API v3 `videos.list` call. It must never make a model/provider
 * call or turn unavailable evidence (thumbnail pixels, opening seconds,
 * keyword demand) into a strategy claim.
 */
import type { TagCount, TitlePatternCount } from "@/lib/nicheAnalysis";
import type { VideoDetail } from "@/lib/youtubeData";

export const YOUTUBE_METADATA_SOURCE = "youtube_data_api_v3" as const;

export interface YoutubeMetadataResearchProvenance {
  provider: typeof YOUTUBE_METADATA_SOURCE;
  sampledVideoIds: string[];
  sourceFields: string[];
  videosAnalysed: number;
  topPerformersAnalysed: number;
  limitations: string[];
}

export interface MetadataOnlyThumbnailStyleGuide {
  dominantColors: string[];
  hasTextOverlayPct: null;
  notes: string;
  evidenceSource: "youtube_data_api_v3_metadata";
  visualEvidenceStatus: "metadata_only";
  sampledVideoCount: number;
}

export interface DeterministicSeoDatabank {
  titleTemplates: string[];
  tagClusters: Array<{ name: string; tags: string[] }>;
  /** Empty until actual visual thumbnail evidence is reviewed. */
  thumbnailRules: string[];
  /** Empty until openings/transcripts are measured. */
  hookPatterns: string[];
  /** Empty until demand/search coverage data is measured. */
  competitorGaps: string[];
  sourceAttribution: YoutubeMetadataResearchProvenance;
}

export interface NicheResearchDerivationInput {
  niche: string;
  videos: VideoDetail[];
  topPerformers: VideoDetail[];
  topTitlePatterns: TitlePatternCount[];
  topTags: TagCount[];
}

export interface NicheResearchDerivation {
  thumbnailStyleGuide: MetadataOnlyThumbnailStyleGuide;
  databank: DeterministicSeoDatabank;
}

const TITLE_TEMPLATE_BY_PATTERN: Record<string, string> = {
  how_to: "How to [ACHIEVE OUTCOME]",
  top_n: "Top [NUMBER] [TOPIC]",
  n_best: "[NUMBER] Best [TOPIC]",
  n_ways: "[NUMBER] Ways to [OUTCOME]",
  question: "[QUESTION ABOUT TOPIC]",
  parenthetical: "[TOPIC] ([CONTEXT])",
  year: "[TOPIC] [YEAR]",
  emoji: "[EMOJI] [TOPIC]",
  allcaps: "[EMPHASIS] [TOPIC]",
};

const TAG_TOKEN_STOP_WORDS = new Set([
  "and",
  "for",
  "from",
  "the",
  "this",
  "that",
  "with",
  "your",
  "you",
  "video",
  "videos",
  "youtube",
]);

const LIMITATIONS = [
  "Visual thumbnail pixels were not analysed; palette, overlay-text share, faces, and composition are unmeasured.",
  "Video openings and transcripts were not analysed; hookPatterns is intentionally empty.",
  "Search demand and coverage were not measured; competitorGaps is intentionally empty.",
  "Tags reflect only metadata returned by the YouTube Data API for the sampled videos.",
];

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function observedTitleTemplates(
  patterns: TitlePatternCount[],
  topPerformerCount: number,
): string[] {
  // A single incidental title format in a meaningful sample is not a repeatable
  // pattern. Very small samples retain one occurrence because withholding all
  // evidence would be less honest than describing exactly what was observed.
  const minimumSupport = topPerformerCount >= 10 ? 2 : 1;
  return patterns
    .filter((pattern) => pattern.count >= minimumSupport)
    .map((pattern) => ({
      pattern: pattern.pattern,
      count: pattern.count,
      template: TITLE_TEMPLATE_BY_PATTERN[pattern.pattern],
    }))
    .filter(
      (
        pattern,
      ): pattern is { pattern: string; count: number; template: string } =>
        Boolean(pattern.template),
    )
    .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern))
    .map((pattern) => pattern.template)
    .slice(0, 8);
}

function tagTokens(tag: string): string[] {
  return uniqueNonEmpty(
    tag
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && !TAG_TOKEN_STOP_WORDS.has(token)),
  );
}

function observedTagClusters(
  topTags: TagCount[],
): Array<{ name: string; tags: string[] }> {
  const tags = topTags
    .map((entry) => ({ tag: entry.tag.trim(), count: entry.count }))
    .filter((entry) => entry.tag && entry.count > 0)
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  if (tags.length === 0) return [];

  const tagsByToken = new Map<string, string[]>();
  for (const entry of tags) {
    for (const token of tagTokens(entry.tag)) {
      const matching = tagsByToken.get(token) ?? [];
      matching.push(entry.tag);
      tagsByToken.set(token, matching);
    }
  }

  const candidates: Array<{ token: string; tags: string[] }> = [
    ...tagsByToken.entries(),
  ]
    .map(([token, matching]) => ({ token, tags: uniqueNonEmpty(matching) }))
    .filter((group) => group.tags.length >= 2)
    .sort(
      (a, b) => b.tags.length - a.tags.length || a.token.localeCompare(b.token),
    );

  const used = new Set<string>();
  const clusters: Array<{ name: string; tags: string[] }> = [];
  for (const group of candidates) {
    const unused = group.tags.filter((tag) => !used.has(tag)).slice(0, 12);
    if (unused.length < 2) continue;
    unused.forEach((tag) => used.add(tag));
    clusters.push({
      name: `Observed tag family: ${group.token}`,
      tags: unused,
    });
    if (clusters.length === 4) break;
  }

  const remaining = tags
    .map((entry) => entry.tag)
    .filter((tag) => !used.has(tag))
    .slice(0, 20);
  if (remaining.length > 0) {
    clusters.push({ name: "Other observed YouTube tags", tags: remaining });
  }

  return clusters;
}

function provenance(
  input: NicheResearchDerivationInput,
): YoutubeMetadataResearchProvenance {
  return {
    provider: YOUTUBE_METADATA_SOURCE,
    sampledVideoIds: uniqueNonEmpty(
      input.topPerformers.map((video) => video.youtubeVideoId),
    ).slice(0, 50),
    sourceFields: [
      "snippet.title",
      "snippet.tags",
      "snippet.thumbnails",
      "snippet.publishedAt",
      "statistics.viewCount",
      "statistics.likeCount",
      "statistics.commentCount",
      "contentDetails.duration",
    ],
    videosAnalysed: input.videos.length,
    topPerformersAnalysed: input.topPerformers.length,
    limitations: [...LIMITATIONS],
  };
}

/**
 * Derive only claims that YouTube metadata can support. In particular,
 * thumbnail visual characteristics, narrative hooks, and demand gaps remain
 * unavailable rather than being guessed from titles or tags.
 */
export function deriveNicheResearchFromYouTubeMetadata(
  input: NicheResearchDerivationInput,
): NicheResearchDerivation {
  const source = provenance(input);
  const thumbnailUrls = input.topPerformers.filter((video) =>
    video.thumbnailUrl.trim(),
  ).length;
  const sampleCount = input.topPerformers.length;
  const sampleDescription = `${sampleCount} top-performing YouTube Data API v3 records`;

  return {
    thumbnailStyleGuide: {
      dominantColors: [],
      hasTextOverlayPct: null,
      notes:
        `Metadata-only guide from ${sampleDescription} for "${input.niche}" ` +
        `(${thumbnailUrls} records included a thumbnail URL). Colors, text overlay, faces, composition, and mood were not measured; no visual thumbnail rule is inferred.`,
      evidenceSource: "youtube_data_api_v3_metadata",
      visualEvidenceStatus: "metadata_only",
      sampledVideoCount: sampleCount,
    },
    databank: {
      titleTemplates: observedTitleTemplates(
        input.topTitlePatterns,
        sampleCount,
      ),
      tagClusters: observedTagClusters(input.topTags),
      thumbnailRules: [],
      hookPatterns: [],
      competitorGaps: [],
      sourceAttribution: source,
    },
  };
}
