import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  deriveNicheResearchFromYouTubeMetadata,
  YOUTUBE_METADATA_SOURCE,
} from "@/lib/nicheResearchDerivation";
import type { VideoDetail } from "@/lib/youtubeData";

const video = (index: number): VideoDetail => ({
  youtubeVideoId: `video-${index}`,
  title: `How to solve case ${index}`,
  channelId: `channel-${index % 3}`,
  channelTitle: `Channel ${index % 3}`,
  views: 100_000 - index,
  likes: 1_000,
  comments: 100,
  tags: ["true crime", "crime documentary"],
  thumbnailUrl: index === 11 ? "" : `https://img.example/${index}.jpg`,
  durationSec: 600,
  publishedAt: "2026-01-01T00:00:00Z",
});

const topPerformers = Array.from({ length: 12 }, (_, index) => video(index));
const input = {
  niche: "True Crime",
  videos: [...topPerformers, video(12)],
  topPerformers,
  topTitlePatterns: [
    { pattern: "how_to", count: 6 },
    { pattern: "top_n", count: 4 },
    { pattern: "question", count: 1 },
    { pattern: "unknown_format", count: 10 },
  ],
  topTags: [
    { tag: "true crime", count: 12 },
    { tag: "crime documentary", count: 9 },
    { tag: "unsolved crime", count: 7 },
    { tag: "cold case", count: 5 },
    { tag: "narrative investigation", count: 3 },
  ],
};

const first = deriveNicheResearchFromYouTubeMetadata(input);
const second = deriveNicheResearchFromYouTubeMetadata(input);

assert.deepEqual(first, second, "metadata derivation must be deterministic");
assert.deepEqual(first.databank.titleTemplates, [
  "How to [ACHIEVE OUTCOME]",
  "Top [NUMBER] [TOPIC]",
]);
assert.ok(
  first.databank.tagClusters.some(
    (cluster) =>
      cluster.name === "Observed tag family: crime" &&
      cluster.tags.includes("true crime") &&
      cluster.tags.includes("unsolved crime"),
  ),
  "repeated metadata tokens should form an observed tag family",
);
assert.deepEqual(first.databank.thumbnailRules, []);
assert.deepEqual(first.databank.hookPatterns, []);
assert.deepEqual(first.databank.competitorGaps, []);

assert.deepEqual(first.thumbnailStyleGuide.dominantColors, []);
assert.equal(first.thumbnailStyleGuide.hasTextOverlayPct, null);
assert.equal(first.thumbnailStyleGuide.visualEvidenceStatus, "metadata_only");
assert.match(first.thumbnailStyleGuide.notes, /not measured/i);
assert.equal(first.thumbnailStyleGuide.sampledVideoCount, 12);

assert.equal(
  first.databank.sourceAttribution.provider,
  YOUTUBE_METADATA_SOURCE,
);
assert.equal(first.databank.sourceAttribution.videosAnalysed, 13);
assert.equal(first.databank.sourceAttribution.topPerformersAnalysed, 12);
assert.deepEqual(
  first.databank.sourceAttribution.sampledVideoIds,
  topPerformers.map((v) => v.youtubeVideoId),
);
assert.ok(
  first.databank.sourceAttribution.limitations.some((limitation) =>
    /hookPatterns is intentionally empty/i.test(limitation),
  ),
);

const smallSample = deriveNicheResearchFromYouTubeMetadata({
  ...input,
  topPerformers: [topPerformers[0]],
  topTitlePatterns: [{ pattern: "question", count: 1 }],
});
assert.deepEqual(
  smallSample.databank.titleTemplates,
  ["[QUESTION ABOUT TOPIC]"],
  "a one-video sample may report its one observed structure without inventing a fallback",
);

const nicheResearchPath = fileURLToPath(
  new URL("../nicheResearch.ts", import.meta.url),
);
const nicheResearchSource = readFileSync(nicheResearchPath, "utf8");
assert.doesNotMatch(
  nicheResearchSource,
  /@\/lib\/gemini|geminiJson|visionUrls/,
);

console.log("niche research deterministic derivation tests passed");
