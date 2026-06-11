// DRY-RUN the LLM Pipeline Architect against real channel records (no writes).
// Env: vault-hydrated ANTHROPIC/GEMINI keys + NEXT_PUBLIC_CONVEX_URL + CHANNEL
// (name match). Prints the decision report + the resulting block list.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { architectPipeline } from "../src/engine/creative/architect.ts";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://astute-camel-689.convex.cloud");
const wanted = (process.env.CHANNEL ?? "Investory").toLowerCase();

const channels = await convex.query(api.channels.listChannels, { ownerId: "owner_daniel" });
const ch = channels.find((c) => c.name.toLowerCase().includes(wanted));
if (!ch) throw new Error(`channel not found: ${wanted}`);

const familyFromTemplate = (t) => (t === "C" ? "music_loop" : t === "E" ? "sleep" : "narrated_stock");
let competitorCount = 0;
try {
  const comps = await convex.query(api.competitors.listCompetitors, { ownerId: ch.ownerId, niche: ch.identity?.niche ?? "" });
  competitorCount = comps.length;
} catch {}

console.log(`\n=== ARCHITECT DRY RUN: ${ch.name} (${familyFromTemplate(ch.template)}; ${competitorCount} competitors) ===`);
const res = await architectPipeline({
  family: familyFromTemplate(ch.template),
  channelName: ch.name,
  niche: ch.identity?.niche,
  persona: ch.identity?.persona,
  pipeline: ch.pipeline ?? [],
  dna: ch.styleDNA ?? null,
  bible: ch.identity?.creativeBrief ?? null,
  qualityBar: ch.qaRubric ?? null,
  competitorCount,
  log: (m) => console.log(`  [log] ${m}`),
});
if (!res) {
  console.log("ARCHITECT FAILED (floor kept)");
  process.exit(1);
}
console.log(`\nSUMMARY: ${res.report.summary}`);
console.log(`\nAPPLIED (${res.report.applied.length}):`);
for (const a of res.report.applied) console.log(`  ${a.action} ${a.block} ${a.params ? JSON.stringify(a.params) : ""}\n    why: ${a.why}`);
console.log(`\nREJECTED (${res.report.rejected.length}):`);
for (const r of res.report.rejected) console.log(`  ${r.action} ${r.block} — ${r.reason}`);
console.log(`\nANTI-REPETITION:`);
for (const s of res.report.antiRepetition) console.log(`  - ${s}`);
console.log(`\nMISSING CAPABILITIES (module build queue):`);
for (const m of res.report.missingCapabilities) console.log(`  - ${m.name}: ${m.description}\n    would enable: ${m.wouldEnable}`);
console.log(`\nGROUNDING ACTIONS:`);
for (const g of res.report.groundingActions) console.log(`  - ${g}`);
console.log(`\nFINAL PIPELINE (${res.pipeline.length} blocks):`);
for (const e of res.pipeline) console.log(`  ${e.block}${e.params ? " " + JSON.stringify(e.params) : ""}`);
