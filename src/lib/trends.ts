/**
 * Free trend signals for topic intelligence — what the niche's audience is
 * ACTIVELY discussing this week (Reddit public JSON; no API key, just a UA).
 * Catches topics before YouTube saturation: outliers show what already works
 * on YouTube; Reddit shows what people care about BEFORE creators cover it.
 */
import { createPublicEvidenceCache, normalizeEvidenceKey } from "@/lib/publicEvidenceCache";

const NICHE_SUBS: Record<string, string[]> = {
  finance: ["personalfinance", "investing", "stocks"],
  business: ["Entrepreneur", "smallbusiness", "business"],
  technology: ["technology", "ArtificialInteligence", "gadgets"],
  health: ["health", "nutrition", "loseit"],
  history: ["history", "AskHistorians"],
  education: ["todayilearned", "explainlikeimfive"],
  crime: ["TrueCrime", "UnresolvedMysteries"],
  stories: ["TrueOffMyChest", "nosleep"],
  motivation: ["getdisciplined", "selfimprovement", "Stoicism"],
  science: ["science", "space"],
};

export interface TrendSignal {
  title: string;
  score: number;
  subreddit: string;
}

const trendsCache = createPublicEvidenceCache<TrendSignal[]>();

/** Test/support hook; public trend packets remain short-lived in production. */
export function clearTrendEvidenceCache(): void {
  trendsCache.clear();
}

export async function fetchRedditTrends(
  niche: string,
  log: (m: string) => void = () => {},
): Promise<TrendSignal[]> {
  const key = normalizeEvidenceKey(niche);
  if (!key) return [];
  const subs =
    NICHE_SUBS[key] ??
    Object.entries(NICHE_SUBS).find(([k]) => key.includes(k) || k.includes(key))?.[1] ??
    [key.replace(/[^a-z0-9]/g, "")];
  const selectedSubs = subs.slice(0, 3);
  const cacheKey = `reddit:${key}`;
  const cached = trendsCache.get(cacheKey);
  if (cached) return cached.map((value) => ({ ...value }));
  const pending = trendsCache.getInflight(cacheKey);
  if (pending) return (await pending).map((value) => ({ ...value }));

  const request = (async (): Promise<TrendSignal[]> => {
    let completed = 0;
    try {
      const results = await Promise.all(selectedSubs.map(async (sub): Promise<TrendSignal[]> => {
        try {
          const res = await fetch(`https://www.reddit.com/r/${sub}/top.json?t=week&limit=12`, {
            headers: { "User-Agent": "youtube-studio-ai/1.0 (topic research)" },
          });
          if (!res.ok) return [];
          const j = (await res.json()) as {
            data?: { children?: { data?: { title?: string; score?: number; stickied?: boolean } }[] };
          };
          const signals: TrendSignal[] = [];
          for (const c of j.data?.children ?? []) {
            const d = c.data;
            if (!d?.title || d.stickied || (d.score ?? 0) < 200) continue;
            signals.push({ title: d.title.slice(0, 140), score: d.score ?? 0, subreddit: sub });
          }
          completed++;
          return signals;
        } catch {
          /* one sub failing is fine; the packet is not cached until all finish */
          return [];
        }
      }));
      const top = results.flat().sort((a, b) => b.score - a.score).slice(0, 12);
      if (completed === selectedSubs.length) trendsCache.set(cacheKey, top);
      log(`trends: ${top.length} reddit signal(s) from r/${selectedSubs.join(", r/")}`);
      return top;
    } finally {
      trendsCache.deleteInflight(cacheKey);
      if (completed !== selectedSubs.length) trendsCache.delete(cacheKey);
    }
  })();
  trendsCache.setInflight(cacheKey, request);
  return (await request).map((value) => ({ ...value }));
}
