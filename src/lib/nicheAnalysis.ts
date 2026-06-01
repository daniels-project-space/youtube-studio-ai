/**
 * Title / tag / aggregate analysis for competitor research (v1 port of
 * legacy autostudio `_analyze_titles` + competitor aggregation). Pure
 * functions — no network, no secrets — so they're trivially testable and
 * never crash a build.
 */
import type { VideoDetail } from "@/lib/youtubeData";

export interface TitlePatternCount {
  pattern: string;
  count: number;
}
export interface WordCount {
  word: string;
  count: number;
}
export interface TagCount {
  tag: string;
  count: number;
}

/** A curated YouTube "power words" lexicon (ported from legacy). */
const POWER_WORDS = [
  "best",
  "top",
  "ultimate",
  "secret",
  "proven",
  "easy",
  "fast",
  "free",
  "new",
  "amazing",
  "insane",
  "perfect",
  "essential",
  "complete",
  "guide",
  "hack",
  "tips",
  "tricks",
  "mistakes",
  "review",
  "vs",
  "honest",
  "real",
  "truth",
  "why",
  "how",
  "everything",
  "deep",
  "calm",
  "relaxing",
  "cozy",
  "aesthetic",
];

const median = (nums: number[]): number => {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

/**
 * Regex-count recurring title patterns + power words + optimal length + top
 * tags across a set of competitor videos.
 */
export function analyzeTitles(videos: VideoDetail[]): {
  topTitlePatterns: TitlePatternCount[];
  powerWords: WordCount[];
  optimalTitleLen: number;
  topTags: TagCount[];
} {
  const titles = videos.map((v) => v.title).filter(Boolean);

  const patterns: Record<string, RegExp> = {
    how_to: /\bhow\s+to\b/i,
    top_n: /\btop\s+\d+\b/i,
    n_best: /\b\d+\s+best\b/i,
    n_ways: /\b\d+\s+ways\b/i,
    emoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u,
    allcaps: /\b[A-Z]{3,}\b/,
    year: /\b202[4-9]\b/,
    question: /\?/,
    parenthetical: /\([^)]+\)/,
  };

  const topTitlePatterns: TitlePatternCount[] = Object.entries(patterns)
    .map(([name, re]) => ({
      pattern: name,
      count: titles.filter((t) => re.test(t)).length,
    }))
    .filter((p) => p.count > 0)
    .sort((a, b) => b.count - a.count);

  const wordCounts = new Map<string, number>();
  for (const t of titles) {
    const lower = t.toLowerCase();
    for (const w of POWER_WORDS) {
      const re = new RegExp(`\\b${w}\\b`, "i");
      if (re.test(lower)) wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
    }
  }
  const powerWords: WordCount[] = [...wordCounts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count);

  const optimalTitleLen = median(titles.map((t) => t.length));

  const tagCounts = new Map<string, number>();
  for (const v of videos) {
    for (const tag of v.tags) {
      const k = tag.toLowerCase().trim();
      if (k) tagCounts.set(k, (tagCounts.get(k) ?? 0) + 1);
    }
  }
  const topTags: TagCount[] = [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);

  return { topTitlePatterns, powerWords, optimalTitleLen, topTags };
}

export interface CompetitorAgg {
  channelName: string;
  totalViews: number;
  videoCount: number;
  topVideos: {
    youtubeVideoId: string;
    title: string;
    views: number;
    likes: number;
    comments: number;
    tags: string[];
    thumbnailUrl: string;
    durationSec: number;
    publishedAt: string;
  }[];
}

/** Aggregate videos into competitor channels, keeping top videos per channel. */
export function aggregateCompetitors(
  videos: VideoDetail[],
  topPerChannel = 10,
): CompetitorAgg[] {
  const byChannel = new Map<string, VideoDetail[]>();
  for (const v of videos) {
    const arr = byChannel.get(v.channelTitle) ?? [];
    arr.push(v);
    byChannel.set(v.channelTitle, arr);
  }
  const out: CompetitorAgg[] = [];
  for (const [channelName, vids] of byChannel) {
    const sorted = [...vids].sort((a, b) => b.views - a.views);
    out.push({
      channelName,
      totalViews: vids.reduce((s, v) => s + v.views, 0),
      videoCount: vids.length,
      topVideos: sorted.slice(0, topPerChannel).map((v) => ({
        youtubeVideoId: v.youtubeVideoId,
        title: v.title,
        views: v.views,
        likes: v.likes,
        comments: v.comments,
        tags: v.tags,
        thumbnailUrl: v.thumbnailUrl,
        durationSec: v.durationSec,
        publishedAt: v.publishedAt,
      })),
    });
  }
  return out.sort((a, b) => b.totalViews - a.totalViews);
}

/** Top videos across all competitors, by views desc. */
export function bestPerformers(
  videos: VideoDetail[],
  limit = 50,
): VideoDetail[] {
  return [...videos].sort((a, b) => b.views - a.views).slice(0, limit);
}

export const aggStats = (videos: VideoDetail[]) => {
  const top = bestPerformers(videos, 50).map((v) => v.views);
  const avg = top.length ? Math.round(top.reduce((s, n) => s + n, 0) / top.length) : 0;
  return { avgViewsTop50: avg, medianViewsTop50: median(top) };
};
