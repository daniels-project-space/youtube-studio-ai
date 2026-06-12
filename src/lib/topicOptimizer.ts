/**
 * Topic optimizer — THIN WRAPPER over TOPICRAFT (src/lib/topicraft.ts, the
 * golden topic-intel engine). Kept for call-site compatibility (plan-week-ahead,
 * design-channel): it gathers the channel's Convex-side context (done topics,
 * current plan, competitor databank, performance ledger, outlier bank) and
 * delegates selection to craftTopics(). Each returned topic now carries the
 * bet's judged provisional title, thumbnail moment and hook promise — warm
 * starts for metacraft, banana and hookcraft downstream.
 *
 * The legacy multi-fallback engine this replaced survives ONLY as the A/B
 * baseline in scripts/ab/legacyTopicOptimizer.ts.
 */
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { loadPerformanceContext } from "@/lib/performance";
import { craftTopics, loadOutlierBank, type BetType } from "@/lib/topicraft";

export interface OptimizeTopicsOpts {
  convex: ConvexHttpClient;
  ownerId: string;
  channelId: string;
  /** Per-channel R2 key prefix (for the performance ledger). */
  keyPrefix: string;
  count: number;
  identity: {
    niche?: string;
    persona?: string;
    topicPool?: string[];
    bannedWords?: string[];
    requiredCallbacks?: string[];
  };
  channelName?: string;
  /** Extra topics to treat as already-taken (e.g. the current content plan). */
  alsoAvoid?: string[];
  log?: (m: string, x?: Record<string, unknown>) => void;
}

export interface OptimizedTopic {
  topic: string;
  rationale?: string;
  /** Judged 40-70 char provisional title (metacraft warm start). */
  title?: string;
  /** Scene seed for the banana thumbnail brief. */
  thumbnailMoment?: string;
  /** The promise the cold open must confirm (hookcraft seed). */
  hookPromise?: string;
  betType?: BetType;
}

export async function optimizeTopics(opts: OptimizeTopicsOpts): Promise<OptimizedTopic[]> {
  const log = opts.log ?? (() => {});
  const niche = opts.identity.niche ?? "";
  const channelId = opts.channelId as Id<"channels">;

  // Convex-side context (best-effort reads; topicraft itself gates loudly).
  const [done, plan, competitors, nicheIntel, perfCtx] = await Promise.all([
    opts.convex.query(api.topicMemory.listForChannel, { channelId }).catch(() => [] as { key: string }[]),
    opts.convex.query(api.contentPlan.listPlan, { ownerId: opts.ownerId, channelId }).catch(() => [] as { topic: string }[]),
    niche
      ? opts.convex.query(api.competitors.listCompetitors, { ownerId: opts.ownerId, niche }).catch(() => [])
      : Promise.resolve([] as unknown[]),
    niche ? opts.convex.query(api.seo.getNiche, { ownerId: opts.ownerId, niche }).catch(() => null) : Promise.resolve(null),
    loadPerformanceContext(opts.keyPrefix).catch(() => ""),
  ]);

  const competitorTitles = (competitors as { topVideos?: { title: string; views: number }[] }[])
    .flatMap((c) => c.topVideos ?? [])
    .sort((a, b) => b.views - a.views)
    .slice(0, 12);
  const powerWords = ((nicheIntel as { powerWords?: { word: string }[] } | null)?.powerWords ?? [])
    .map((p) => p.word)
    .slice(0, 12);
  const outliers = niche
    ? await loadOutlierBank({
        convex: opts.convex,
        ownerId: opts.ownerId,
        niche,
        query: [niche, ...(opts.identity.topicPool ?? []).slice(0, 2)].filter(Boolean).join(" "),
        log: (m) => log(m),
      })
    : [];

  const { bets } = await craftTopics({
    channelName: opts.channelName,
    niche,
    persona: opts.identity.persona,
    topicPool: opts.identity.topicPool,
    bannedWords: opts.identity.bannedWords,
    count: opts.count,
    avoid: [
      ...(done as { key: string }[]).map((d) => d.key),
      ...(plan as { topic: string }[]).map((p) => p.topic),
      ...(opts.alsoAvoid ?? []),
    ],
    perfContext: perfCtx || undefined,
    competitorTitles,
    outliers,
    powerWords,
    log,
  });

  return bets.map((b) => ({
    topic: b.topic,
    rationale: `${b.angle} [${b.evidence}]`,
    title: b.provisionalTitle,
    thumbnailMoment: b.thumbnailMoment,
    hookPromise: b.hookPromise,
    betType: b.betType,
  }));
}
