/**
 * Free trend signals for topic intelligence — what the niche's audience is
 * ACTIVELY discussing this week (Reddit public JSON; no API key, just a UA).
 * Catches topics before YouTube saturation: outliers show what already works
 * on YouTube; Reddit shows what people care about BEFORE creators cover it.
 */

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

export async function fetchRedditTrends(
  niche: string,
  log: (m: string) => void = () => {},
): Promise<TrendSignal[]> {
  const key = niche.toLowerCase();
  const subs =
    NICHE_SUBS[key] ??
    Object.entries(NICHE_SUBS).find(([k]) => key.includes(k) || k.includes(key))?.[1] ??
    [key.replace(/[^a-z0-9]/g, "")];
  const out: TrendSignal[] = [];
  for (const sub of subs.slice(0, 3)) {
    try {
      const res = await fetch(`https://www.reddit.com/r/${sub}/top.json?t=week&limit=12`, {
        headers: { "User-Agent": "youtube-studio-ai/1.0 (topic research)" },
      });
      if (!res.ok) continue;
      const j = (await res.json()) as {
        data?: { children?: { data?: { title?: string; score?: number; stickied?: boolean } }[] };
      };
      for (const c of j.data?.children ?? []) {
        const d = c.data;
        if (!d?.title || d.stickied || (d.score ?? 0) < 200) continue;
        out.push({ title: d.title.slice(0, 140), score: d.score ?? 0, subreddit: sub });
      }
    } catch {
      /* one sub failing is fine */
    }
  }
  out.sort((a, b) => b.score - a.score);
  const top = out.slice(0, 12);
  log(`trends: ${top.length} reddit signal(s) from r/${subs.slice(0, 3).join(", r/")}`);
  return top;
}
