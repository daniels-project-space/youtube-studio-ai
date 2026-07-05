/**
 * Validate sourcing + resolution gate (metadata only, no downloads/vision):
 * confirm HD originals rank top and low-res re-uploads are dropped.
 *   node --env-file=.env.local --import tsx scripts/test-discovery.ts
 */
import { resolveSourceQueries, dumpCandidates } from "../src/lib/speechSource";

const THEME = "not giving up";
const SPEAKERS = ["Denzel Washington", "Matthew McConaughey", "Arnold Schwarzenegger", "Will Smith"];

async function main() {
  for (const sp of SPEAKERS) {
    console.log(`\n========== ${sp} — "${THEME}" ==========`);
    const queries = await resolveSourceQueries(sp, THEME, (m) => console.log("· " + m));
    const cands = dumpCandidates(queries, sp, 5, (m) => console.log(m));
    console.log(`  TOP 6 (HD originals should lead; <720p dropped):`);
    cands.slice(0, 6).forEach((c, i) => {
      console.log(`  ${i + 1}. [score ${c.score}] ${c.maxHeight}p ${Math.round(c.durationSec / 60)}m  [${c.channel}]`);
      console.log(`        ${c.title.slice(0, 72)}`);
    });
    if (!cands.length) console.log("  (no HD raw candidates)");
  }
}
main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
