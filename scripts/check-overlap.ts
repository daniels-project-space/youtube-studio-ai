/**
 * Detect quote-card ↔ chapter-card overlaps for a finished run, from its
 * persisted chapterPlan + quoteOverlays. Verifies the no-overlap rule.
 *
 *   NEXT_PUBLIC_CONVEX_URL=https://astute-camel-689.convex.cloud \
 *   npx tsx scripts/check-overlap.ts <runId> [introSec=5] [gapSec=3]
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

function cardWindows(plan: { kind: string; durSec: number; heading?: string }[], introSec: number) {
  const out: { start: number; end: number; heading?: string }[] = [];
  let t = introSec;
  for (const w of plan) {
    if (w.kind === "card") out.push({ start: t, end: t + w.durSec, heading: w.heading });
    t += w.durSec;
  }
  return out;
}

async function main() {
  const runId = process.argv[2];
  const introSec = Number(process.argv[3] ?? 5);
  const gap = Number(process.argv[4] ?? 3);
  if (!runId) throw new Error("usage: check-overlap.ts <runId> [introSec] [gapSec]");
  const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const st = (await c.query(api.runStages.listRunStages, { runId: runId as Id<"runs"> })) as Array<{ block: string; outputs?: any }>;
  const plan = st.find((s) => s.block === "narration_tts")?.outputs?.chapterPlan ?? [];
  const quotes = st.find((s) => s.block === "quote_overlays")?.outputs?.quoteOverlays ?? [];
  const cards = cardWindows(plan, introSec);

  console.log(`chapter cards: ${cards.length}, quote cards: ${quotes.length}, gap=${gap}s`);
  let clashes = 0;
  for (const q of quotes) {
    const qs = q.startSec, qe = q.startSec + q.durSec;
    for (const w of cards) {
      // overlap (or within gap) test
      if (qe > w.start - gap && qs < w.end + gap) {
        clashes++;
        const overlap = Math.max(0, Math.min(qe, w.end) - Math.max(qs, w.start));
        console.log(
          `CLASH: quote [${qs.toFixed(1)}-${qe.toFixed(1)}] "${(q.text || "").slice(0, 32)}" ↔ ` +
          `card [${w.start.toFixed(1)}-${w.end.toFixed(1)}] "${w.heading}" ` +
          `(overlap ${overlap.toFixed(1)}s)`,
        );
      }
    }
  }
  console.log(clashes === 0 ? "✓ no quote/chapter overlaps" : `✗ ${clashes} clash(es) detected`);
}
main().catch((e) => { console.error("FAIL:", e instanceof Error ? e.message : e); process.exit(1); });
