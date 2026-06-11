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
  avgViewPct: number; // audience retention 0..100
  ctr?: number; // thumbnail CTR 0..100 (if available)
  updatedAt: number;
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
 * Compact winners/losers prompt for the Director. Returns "" until there's
 * enough signal (≥4 measured videos) so we never bias on noise.
 */
export async function loadPerformanceContext(
  keyPrefix: string,
  opts: { minViews?: number } = {},
): Promise<string> {
  const ledger = (await loadLedger(keyPrefix)).filter(
    (e) => e.views >= (opts.minViews ?? 50) && e.avgViewPct > 0,
  );
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
