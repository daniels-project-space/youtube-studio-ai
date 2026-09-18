/**
 * Per-channel performance ledger (Phase 7 learning loop). The learning task
 * writes it from YouTube Analytics; the creative Directors read it to lean
 * toward what worked. Stored in R2 (no Convex schema change) at
 * `<keyPrefix>learning/performance.json`.
 */
import { getObjectBytes, putObject } from "@/lib/storage";

export interface PerfEntry {
  videoId: string;
  topic: string;
  title: string;
  thumbnailStrategy?: string;
  publishedAt: number;
  views: number;
  /** Raw provider metric; intentionally not used by the ranking score. */
  engagedViews?: number;
  avgViewPct: number; // audience retention 0..100
  ctr?: number; // thumbnail CTR 0..100 (if available)
  /**
   * Raw thumbnail impressions — the denominator behind `ctr`.
   *
   * Without it a rate cannot support a decision, which is precisely why
   * seoReoptimize's attribution admission refuses to act on this ledger.
   */
  thumbnailImpressions?: number;
  /** Metacraft's runner-up, kept so a swap has something to swap TO. */
  titleAlternate?: string;
  /**
   * Up to two receipt-derived candidates for a title-only native Studio test.
   * They are proposals, never results or thumbnail pairings.
   */
  titleAlternates?: string[];
  /**
   * When the CURRENT title went live. Publish time is the default; a rewrite
   * moves it. Observations before this point describe a different title and
   * must not be attributed to the one now showing.
   */
  titleSetAt?: number;
  /** The live A/B this video is in, if any. */
  titleSwap?: {
    from: string;
    to: string;
    baselineCtr: number;
    baselineImpressions: number;
    swappedAt: number;
    /**
     * Legacy entries were sequential title edits, not YouTube's concurrent
     * native A/B tests. They must never become positive training examples for
     * the package selector. A future native ingestion may set `native_ab` once
     * it carries YouTube's own watch-time-share verdict and test receipt.
     */
    method?: "legacy_sequential" | "native_ab";
    outcome?: "variant_won" | "alternate_won" | "original_won" | "inconclusive" | "not_experiment";
    outcomeDetail?: string;
    outcomeAt?: number;
  };
  updatedAt: number;
  /** Exact OAuth/data-ingestion provenance for this outcome. */
  connectorId?: string;
  connectorVersion?: number;
  ingestionId?: string;
  metricDefinitionVersion?: string;
  /** When the SEO re-optimizer last rewrote this video's title/tags (epoch ms). */
  reoptimizedAt?: number;
}

function ledgerKey(keyPrefix: string): string {
  return `${keyPrefix}learning/performance.json`;
}

export async function loadLedger(keyPrefix: string): Promise<PerfEntry[]> {
  try {
    const bytes = await getObjectBytes(ledgerKey(keyPrefix));
    const arr = JSON.parse(Buffer.from(bytes).toString("utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function saveLedger(keyPrefix: string, entries: PerfEntry[]): Promise<void> {
  await putObject(
    ledgerKey(keyPrefix),
    Buffer.from(JSON.stringify(entries.slice(-300)), "utf8"),
    { contentType: "application/json" },
  );
}

const score = (e: PerfEntry) => e.avgViewPct * 0.7 + (e.ctr ?? 0) * 0.3;

/**
 * Which job the caller is being judged on.
 *
 * "blended" weights retention at 0.7 and CTR at 0.3 — reasonable for the
 * Director, who is responsible for the whole video. It is the wrong lens for a
 * TITLE. A title's only job is earning the click; retention is the script's.
 * Under the blended score a strong title on a weak video was listed as a WEAK
 * performer, teaching the title generator to avoid a title that worked, while a
 * flat title on a gripping video was held up as the model.
 */
export type PerformanceLens = "blended" | "ctr";

/**
 * A title-learning example needs enough of the exact impression denominator
 * behind its CTR to be useful.  A rate without that denominator is still
 * useful for a human dashboard, but it is not evidence we should feed back
 * into the generator as a winning or losing title pattern.
 *
 * Keep this aligned with the native-title-test noise floor: both paths are
 * trying to learn from a packaging decision rather than a handful of early
 * subscriber impressions.
 */
export const MIN_TITLE_LEARNING_IMPRESSIONS = 2_000;

/**
 * Select title-learning evidence without conflating an unmeasured CTR with a
 * poor one.  Exported so the admission rule is directly testable without R2.
 */
export function titlePerformanceEntries(
  entries: readonly PerfEntry[],
  minImpressions = MIN_TITLE_LEARNING_IMPRESSIONS,
): PerfEntry[] {
  return entries.filter((entry) =>
    typeof entry.ctr === "number" && Number.isFinite(entry.ctr) && entry.ctr > 0 &&
    typeof entry.thumbnailImpressions === "number" &&
    Number.isFinite(entry.thumbnailImpressions) &&
    entry.thumbnailImpressions >= minImpressions,
  );
}

/**
 * Compact winners/losers prompt. Returns "" until there's enough signal
 * (≥4 measured videos) so we never bias on noise.
 */
export async function loadPerformanceContext(
  keyPrefix: string,
  opts: {
    minViews?: number;
    connectorId?: string;
    connectorVersion?: number;
    lens?: PerformanceLens;
  } = {},
): Promise<string> {
  const lens = opts.lens ?? "blended";
  const ledger = (await loadLedger(keyPrefix)).filter(
    (e) =>
      e.views >= (opts.minViews ?? 50) &&
      e.avgViewPct > 0 &&
      (opts.connectorId === undefined || e.connectorId === opts.connectorId) &&
      (opts.connectorVersion === undefined ||
        e.connectorVersion === opts.connectorVersion),
  );

  if (lens === "ctr") {
    // A missing CTR is unknown, not zero. More importantly, a CTR with no raw
    // impression denominator is not title-learning evidence: a 12% result on
    // 50 impressions must not outweigh a 5% result on 50,000. The analytics
    // ingestion already persists both values together; this keeps the title
    // prompt from learning a pattern until that evidence exists at scale.
    const measured = titlePerformanceEntries(ledger);
    if (measured.length < 4) return "";
    const sorted = [...measured].sort((a, b) => (b.ctr ?? 0) - (a.ctr ?? 0));
    const fmt = (e: PerfEntry) =>
      `"${e.title}" (CTR ${(e.ctr ?? 0).toFixed(1)}% across ${e.thumbnailImpressions!.toLocaleString()} impressions)`;
    return (
      `TITLE PERFORMANCE on this channel — CLICK-THROUGH ONLY, because that is what a title controls. ` +
      `Retention is deliberately excluded: it measures the script, not the title. ` +
      `Only titles with at least ${MIN_TITLE_LEARNING_IMPRESSIONS.toLocaleString()} raw thumbnail impressions are included.\n` +
      `HIGHEST click-through:\n${sorted.slice(0, 3).map(fmt).join("\n")}\n` +
      `LOWEST click-through:\n${sorted.slice(-3).reverse().map(fmt).join("\n")}`
    );
  }

  if (ledger.length < 4) return "";
  const sorted = [...ledger].sort((a, b) => score(b) - score(a));
  const top = sorted.slice(0, 3);
  const bottom = sorted.slice(-3).reverse();
  const fmt = (e: PerfEntry) =>
    `"${e.title}" (retention ${e.avgViewPct.toFixed(0)}%${e.ctr ? `, CTR ${e.ctr.toFixed(1)}%` : ""})`;
  return (
    `PAST PERFORMANCE on this channel — lean toward what worked, avoid what didn't:\n` +
    `TOP performers:\n${top.map(fmt).join("\n")}\n` +
    `WEAK performers:\n${bottom.map(fmt).join("\n")}`
  );
}
