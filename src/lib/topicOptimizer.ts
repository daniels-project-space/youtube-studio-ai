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
    /**
     * UNIMPLEMENTED END TO END — kept only because it is a persisted schema
     * field. `bannedWords` is honoured here (topicraft: "NEVER use: ..."); this
     * is its positive twin, the recurring phrases a channel must return to, and
     * nothing anywhere ever puts a string in it. Channel Inception initialises
     * it to `[]`, a re-inception carries `previous.requiredCallbacks ?? []`
     * forward, planWeekAhead passes it here, and no consumer reads it. Wiring
     * the consumer alone would change nothing — it would still be an empty
     * array — so this stays declared and unread ON PURPOSE, and says so.
     * Implementing it means writing the producer first.
     */
    requiredCallbacks?: string[];
    /** Per-channel clickbait dial 0-3; absent falls back to the voice default. */
    clickbaitLevel?: number;
  };
  channelName?: string;
  /** Extra topics to treat as already-taken (e.g. the current content plan). */
  alsoAvoid?: string[];
  /** Disable provider embeddings only when the caller applies a deterministic near-duplicate gate. */
  providerSemanticDedupe?: boolean;
  /** Immutable channel program directive supplied only after route admission. */
  programDirective?: string;
  /** Durable fence invoked by Topicraft immediately before its first paid provider call. */
  beforeProviderSpend?: () => Promise<void>;
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
  // Each of these five was a bare .catch with no log, so an outage looked exactly
  // like an empty result. The first is the one that matters: `done` is the
  // ALREADY-USED topic list, and losing it silently produces a week of bets the
  // channel has already published. topic_select re-checks at run time against a
  // read that has no catch at all — it fails closed — so nothing ships twice;
  // what a silent loss here buys is a plan full of topics that will be refused
  // later, with no clue why.
  //
  // Degrading is still right: a topic slate must not fail because a niche read
  // was slow. It just has to be visible. Same fix competitor_research already
  // had for the same shape.
  const lost: string[] = [];
  const noteLoss = <T,>(what: string, fallback: T) => (error: unknown): T => {
    lost.push(`${what} (${error instanceof Error ? error.message : error})`);
    return fallback;
  };
  const [done, plan, competitors, nicheIntel, perfCtx] = await Promise.all([
    opts.convex.query(api.topicMemory.listForChannel, { channelId })
      .catch(noteLoss("already-used topics — this slate may repeat published work", [] as { key: string }[])),
    opts.convex.query(api.contentPlan.listPlan, { ownerId: opts.ownerId, channelId })
      .catch(noteLoss("the current plan — this slate may duplicate scheduled topics", [] as { topic: string }[])),
    niche
      ? opts.convex.query(api.competitors.listCompetitors, { ownerId: opts.ownerId, niche })
          .catch(noteLoss("competitor evidence", [] as unknown[]))
      : Promise.resolve([] as unknown[]),
    niche
      ? opts.convex.query(api.seo.getNiche, { ownerId: opts.ownerId, niche })
          .catch(noteLoss("niche intel and power words", null))
      : Promise.resolve(null),
    loadPerformanceContext(opts.keyPrefix).catch(noteLoss("performance context", "")),
  ]);
  if (lost.length) {
    log(`optimizeTopics: BET EVIDENCE LOST — ${lost.join("; ")}`);
  }

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

  const { bets, ungated } = await craftTopics({
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
    clickbaitLevel: opts.identity.clickbaitLevel,
    providerSemanticDedupe: opts.providerSemanticDedupe,
    programDirective: opts.programDirective,
    beforeProviderSpend: opts.beforeProviderSpend,
    log,
  });

  // An unjudged slate must not travel silently. This is the topic layer that
  // every later module builds on, so a caller reading only `bets` would have no
  // way to know the quality gate never ran.
  if (ungated) {
    log(
      `optimizeTopics: this slate was NOT quality-gated — topicraft's judge was unreachable and ` +
      `${bets.length} bet(s) were admitted on the deterministic lint alone`,
    );
  }

  return bets.map((b) => ({
    topic: b.topic,
    rationale: `${b.angle} [${b.evidence}]`,
    title: b.provisionalTitle,
    thumbnailMoment: b.thumbnailMoment,
    hookPromise: b.hookPromise,
    betType: b.betType,
  }));
}
