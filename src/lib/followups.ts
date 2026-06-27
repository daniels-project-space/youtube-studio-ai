/**
 * Performance-driven FOLLOW-UP detection — the "capitalise on a winner" layer.
 *
 * Canonical already biases the Director toward what worked (loadPerformanceContext)
 * and mines COMPETITOR breakouts (outliers.ts), but nothing turns the channel's OWN
 * over-performers into scheduled sequels. This does: given the channel's performance
 * ledger, it flags videos that beat the channel's normal view count and emits a
 * follow-up seed (one-off deep-dive/variation, or — when a CLUSTER of similar winners
 * proves a replicable format — a confirmed series to seriesize).
 *
 * Pure + deterministic (no I/O, no Date) so it is cheap to test. It only SURFACES
 * candidates with a generation seed; the concrete sequel topic is authored downstream
 * by the LLM (plan-week-ahead). Reuses the canonical PerfEntry ledger.
 */
import type { PerfEntry } from "@/lib/performance";

export interface FollowupCandidate {
  fromVideoId: string;
  fromTitle: string;
  fromTopic: string;
  /** views ÷ the channel's rolling baseline. */
  outlierScore: number;
  /** audience retention 0..100. */
  retention: number;
  /** part of a ≥clusterMin cluster of similar winners → a replicable FORMAT, not luck. */
  confirmed: boolean;
  /** heuristic seed; the LLM refines into the actual sequel/series. */
  kind: "sequel" | "deep_dive" | "variation";
  seed: string;
}

export interface FollowupOpts {
  /** Minimum outlier multiplier to count as a winner. Default 2 (ViewStats green). */
  minMultiplier?: number;
  /** Ignore implausible external-boost spikes. Default 20. */
  maxMultiplier?: number;
  /** Retention floor (0..100) — a high-views/low-retention hit is a packaging fluke, not a format. */
  retentionFloor?: number;
  /** How many recent videos define the rolling baseline. Default 12. */
  baselineWindow?: number;
  /** Cluster size that confirms a replicable FORMAT (seriesize). Default 3. */
  clusterMin?: number;
  /** Floor on the baseline so a tiny new channel doesn't manufacture 50x scores. Default 50. */
  baselineFloor?: number;
}

const STOP = new Set("the a an of to in on for and or is are how why what when who with your you this that".split(" "));
const tokens = (s: string) =>
  new Set(
    s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)),
  );
const overlap = (a: Set<string>, b: Set<string>) => {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
};
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Detect performance-driven follow-up candidates from the channel's own ledger.
 * Outlier score = views ÷ rolling baseline (median of the recent window). A single
 * winner earns a one-off follow-up; a CLUSTER of ≥clusterMin similar winners is a
 * confirmed format worth seriesizing. Pure: the LLM later decides the actual arc.
 */
export function detectFollowups(ledger: PerfEntry[], opts: FollowupOpts = {}): FollowupCandidate[] {
  const minMult = opts.minMultiplier ?? 2;
  const maxMult = opts.maxMultiplier ?? 20;
  const retFloor = opts.retentionFloor ?? 45;
  const win = opts.baselineWindow ?? 12;
  const clusterMin = opts.clusterMin ?? 3;
  const floor = opts.baselineFloor ?? 50;

  const measured = ledger.filter((e) => e.views > 0 && e.avgViewPct > 0);
  if (measured.length < 4) return []; // not enough signal — never sequel on noise

  const recent = [...measured].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, win);
  // Baseline = the channel's NORMAL view count: median of the lower ~70% of the
  // recent window, so a handful of outliers can't inflate the very bar meant to
  // detect them (a naive median-of-all hides a cluster of winners behind itself).
  const normalViews = recent
    .map((e) => e.views)
    .sort((a, b) => a - b)
    .slice(0, Math.max(1, Math.ceil(recent.length * 0.7)));
  const baseline = Math.max(floor, median(normalViews));

  const winners = measured
    .map((e) => ({ e, score: e.views / baseline }))
    .filter(({ e, score }) => score >= minMult && score < maxMult && e.avgViewPct >= retFloor)
    .sort((a, b) => b.score - a.score);

  return winners.map(({ e, score }) => {
    const tk = tokens(`${e.topic} ${e.title}`);
    const clusterSize = winners.filter((w) => overlap(tokens(`${w.e.topic} ${w.e.title}`), tk) >= 2).length;
    const confirmed = clusterSize >= clusterMin;
    const kind: FollowupCandidate["kind"] = confirmed ? "sequel" : e.avgViewPct >= 60 ? "deep_dive" : "variation";
    const seed =
      kind === "sequel"
        ? `Seriesize the winning format behind "${e.title}" (${clusterSize} similar hits) — a new entry in that format, fresh subject.`
        : kind === "deep_dive"
          ? `A deeper-dive follow-up to the over-performer "${e.title}" (${score.toFixed(1)}x, ${e.avgViewPct.toFixed(0)}% retention) — go one level further on "${e.topic}".`
          : `A fresh variation on the over-performer "${e.title}" (${score.toFixed(1)}x) — same proven angle, new subject.`;
    return {
      fromVideoId: e.videoId,
      fromTitle: e.title,
      fromTopic: e.topic,
      outlierScore: Number(score.toFixed(2)),
      retention: e.avgViewPct,
      confirmed,
      kind,
      seed,
    };
  });
}
