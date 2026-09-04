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
    outcome?: "alternate_won" | "original_won" | "inconclusive";
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
    // A missing CTR is unknown, not zero. `ctr ?? 0` ranked unmeasured videos
    // as the worst on the channel, so absent data was taught as failure.
    const measured = ledger.filter((e) => typeof e.ctr === "number" && e.ctr > 0);
    if (measured.length < 4) return "";
    const sorted = [...measured].sort((a, b) => (b.ctr ?? 0) - (a.ctr ?? 0));
    const fmt = (e: PerfEntry) => `"${e.title}" (CTR ${(e.ctr ?? 0).toFixed(1)}%)`;
    return (
      `TITLE PERFORMANCE on this channel — CLICK-THROUGH ONLY, because that is what a title controls. ` +
      `Retention is deliberately excluded: it measures the script, not the title.\n` +
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
