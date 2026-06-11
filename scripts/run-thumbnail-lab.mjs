// Run the THUMBNAIL LAB end-to-end on a real channel (local, writes playbook
// to the channel unless DRY=1). Saves all artifacts to %TEMP%/thumblab.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { acquireReferences, verifyReferences, distillPlaybook, renderCandidate, judgeTournament } from "../src/lib/thumbnailLab.ts";
import { mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://astute-camel-689.convex.cloud");
const wanted = (process.env.CHANNEL ?? "Investory").toLowerCase();
const channels = await convex.query(api.channels.listChannels, { ownerId: "owner_daniel" });
const ch = channels.find((c) => c.name.toLowerCase().includes(wanted));
if (!ch) throw new Error(`channel not found: ${wanted}`);

const tmp = join(tmpdir(), "thumblab");
mkdirSync(tmp, { recursive: true });
const log = (m) => console.log(`  [lab] ${m}`);

// Evidence: FRESH positioning-true acquisition first (the scraped catalog pool
// verified 0/12 — pollution), with the scraped pool as backfill.
const positioning = ch.identity?.creativeBrief?.positioning ?? ch.identity?.persona ?? "";
const fresh = await acquireReferences({
  channelName: ch.name,
  positioning,
  niche: ch.identity?.niche,
  log,
});
const comps = await convex.query(api.competitors.listCompetitors, { ownerId: ch.ownerId, niche: ch.identity?.niche ?? "" });
const scraped = comps
  .flatMap((c) => c.topVideos ?? [])
  .filter((v) => v.thumbnailUrl)
  .map((v) => ({ url: v.thumbnailUrl, views: v.views ?? 0 }));
const candidates = [...fresh, ...scraped.slice(0, 6)];
console.log(`\n=== THUMBNAIL LAB: ${ch.name} — ${fresh.length} fresh + ${Math.min(6, scraped.length)} scraped reference candidates ===`);

const refs = await verifyReferences({
  candidates,
  channelName: ch.name,
  positioning: ch.identity?.creativeBrief?.positioning ?? ch.identity?.persona ?? "",
  tmpDir: tmp,
  log,
});
console.log("\nVERIFIED REFERENCES:");
refs.forEach((r, i) => console.log(`  ${i + 1}. craft ${r.craft}/10, ${r.views.toLocaleString()} views — ${r.why}`));

const playbook = await distillPlaybook({
  refs,
  dna: ch.styleDNA ?? null,
  channelName: ch.name,
  positioning: ch.identity?.creativeBrief?.positioning ?? "",
  log,
});
console.log("\nPLAYBOOK RULES:");
playbook.rules.forEach((r) => console.log(`  - ${r}`));
console.log("AVOID:");
playbook.avoid.forEach((r) => console.log(`  - ${r}`));
console.log("PATTERNS:");
playbook.patterns.forEach((p) => console.log(`  * ${p.name} — when: ${p.when}`));

// Tournament on a real planned title.
const plan = await convex.query(api.contentPlan.listPlan, { ownerId: ch.ownerId, channelId: ch._id });
const title = process.env.TITLE ?? plan[0]?.title ?? plan[0]?.topic ?? "How Compound Returns Actually Work";
console.log(`\nTOURNAMENT for: "${title}"`);

const rendered = [];
for (let i = 0; i < playbook.patterns.length; i++) {
  try {
    const out = join(tmp, `candidate_${i + 1}.jpg`);
    await renderCandidate({
      pattern: playbook.patterns[i],
      title,
      playbook,
      outJpg: out,
      tmpDir: tmp,
      idx: i,
      log,
    });
    rendered.push({ path: out, pattern: playbook.patterns[i].name });
  } catch (e) {
    console.log(`  candidate ${i + 1} (${playbook.patterns[i].name}) FAILED: ${e.message}`);
  }
}
if (rendered.length < 2) throw new Error("fewer than 2 candidates rendered — no tournament");

const result = await judgeTournament({ candidates: rendered, refs, title, tmpDir: tmp, log });
console.log(`\nTOURNAMENT VERDICT: winner = #${result.winnerIdx + 1} (${rendered[result.winnerIdx].pattern})`);
console.log(`why: ${result.judgeWhy}`);
result.candidates.forEach((c, i) =>
  console.log(`  #${i + 1} ${c.pattern}: ${c.clickScore}/10, beats ${c.beatsRefs} refs — ${c.notes}`),
);
copyFileSync(rendered[result.winnerIdx].path, join(tmp, "winner.jpg"));

if (process.env.DRY !== "1") {
  await convex.mutation(api.channels.updateChannel, {
    channelId: ch._id,
    thumbnailPlaybook: { ...playbook, lastTournament: { title, winnerPattern: rendered[result.winnerIdx].pattern, judgeWhy: result.judgeWhy, at: Date.now() } },
  });
  console.log("\nPLAYBOOK PERSISTED to channel.thumbnailPlaybook");
}
console.log(`\nartifacts: ${tmp}\\candidate_1..${rendered.length}.jpg + winner.jpg`);
