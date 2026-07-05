/**
 * Discovery demo WITHOUT the vision gate (no API key needed): pick a topic,
 * search YouTube, apply the raw-source heuristic filter, print the ranked
 * candidates the vision gate would then screen.
 *
 *   ./node_modules/.bin/tsx scripts/search-only.ts
 */
import { pickMotivationalTopic, searchCandidates } from "../src/lib/speechSource";

const topic = pickMotivationalTopic({ seedIndex: 1 });
console.log("topic:", topic.theme, "·", topic.speaker);
console.log("query:", topic.query, "\n");
const cands = searchCandidates(topic.query, 10);
console.log(`ranked raw-ish candidates (${cands.length}):`);
for (const c of cands) {
  console.log(`  ${c.id}  ${String(Math.round(c.durationSec / 60)).padStart(4)}m  ${c.title.slice(0, 70)}`);
}
console.log("\n→ the vision gate would screen these top-to-bottom for baked captions / overlays / watermarks and pick the first CLEAN one.");
