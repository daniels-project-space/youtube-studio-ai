// Run the SCRIPT LAB on a real channel: acquire+verify top competitor videos,
// WATCH their openings, distill the script playbook, persist to the channel.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { acquireReferences } from "../src/lib/thumbnailLab.ts";
import { distillScriptPlaybook } from "../src/lib/scriptLab.ts";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://astute-camel-689.convex.cloud");
const wanted = (process.env.CHANNEL ?? "Investory").toLowerCase();
const channels = await convex.query(api.channels.listChannels, { ownerId: "owner_daniel" });
const ch = channels.find((c) => c.name.toLowerCase().includes(wanted));
if (!ch) throw new Error(`channel not found: ${wanted}`);
const log = (m) => console.log(`  [lab] ${m}`);

const positioning = ch.identity?.creativeBrief?.positioning ?? ch.identity?.persona ?? "";
const refs = await acquireReferences({ channelName: ch.name, positioning, niche: ch.identity?.niche, log });

console.log(`\n=== SCRIPT LAB: ${ch.name} — studying top ${Math.min(3, refs.length)} of ${refs.length} verified-niche videos ===`);
const playbook = await distillScriptPlaybook({
  refs: refs.map((r) => ({ videoId: r.videoId, title: r.title, views: r.views })),
  dna: ch.styleDNA ?? null,
  channelName: ch.name,
  positioning,
  log,
});

console.log("\nSTUDIED:");
playbook.studied.forEach((s) => console.log(`  - "${s.title}" (${s.views.toLocaleString()} views)`));
console.log("\nHOOK RULES:");
playbook.hookRules.forEach((r) => console.log(`  - ${r}`));
console.log("\nOPENING DEVICES (rotated per video):");
playbook.openingDevices.forEach((d) => console.log(`  * ${d.name} — ${d.when}\n    skeleton: ${d.template}`));
console.log("\nRETENTION DEVICES:");
playbook.retentionDevices.forEach((r) => console.log(`  - ${r}`));
console.log("\nVOICE RULES:");
playbook.voiceRules.forEach((r) => console.log(`  - ${r}`));
console.log("\nNEVER:");
playbook.avoid.forEach((r) => console.log(`  - ${r}`));

if (process.env.DRY !== "1") {
  await convex.mutation(api.channels.updateChannel, { channelId: ch._id, scriptPlaybook: playbook });
  console.log("\nSCRIPT PLAYBOOK PERSISTED to channel.scriptPlaybook");
}
