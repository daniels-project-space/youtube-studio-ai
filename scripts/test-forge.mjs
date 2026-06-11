// Live test: author a forged module for a REAL missing capability from the
// whiteboard channel's architect report, validate, and persist it.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { authorForgedModule } from "../src/engine/forge/forge.ts";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://astute-camel-689.convex.cloud");
const channels = await convex.query(api.channels.listChannels, { ownerId: "owner_daniel" });
const ch = channels.find((c) => c.name.includes("Drawn"));
const cap = ch.architectReport.missingCapabilities.find((m) => m.name === (process.env.CAP ?? "era_matched_title_annotation"))
  ?? ch.architectReport.missingCapabilities[0];
console.log(`FORGING: ${cap.name} — ${cap.description.slice(0, 120)}…`);

const res = await authorForgedModule({
  capability: cap,
  channelName: ch.name,
  niche: ch.identity?.niche,
  dna: ch.styleDNA ?? null,
  log: (m) => console.log(`  [forge] ${m}`),
});
if ("error" in res) { console.log(`FORGE REFUSED/FAILED: ${res.error}`); process.exit(1); }

console.log(`\n=== AUTHORED MODULE: ${res.spec.id} ===`);
console.log(`label: ${res.spec.label}`);
console.log(`whenToUse: ${res.spec.whenToUse}`);
console.log(`consumes: ${res.spec.consumes.join(", ")} | anchorAfter: ${res.spec.anchorAfter.join(", ")} | ceiling $${res.spec.maxCostUsd}`);
console.log(`params: ${res.spec.params.map((p) => `${p.key}(${p.min}-${p.max}=${p.default})`).join(", ") || "none"}`);
console.log(`steps:`);
res.spec.steps.forEach((s, i) => console.log(`  ${i}. ${s.op}${s.op === "foreach" ? ` over ${s.overFrom} ×≤${s.max} → [${s.steps.map((x) => x.op).join(",")}]` : ""}${s.op === "remotion" ? ` (${s.comp})` : ""}`));

if (process.env.DRY !== "1") {
  await convex.mutation(api.forgedModules.save, {
    ownerId: "owner_daniel", blockId: res.spec.id, spec: res.spec,
    status: "active", forChannelId: ch._id, capability: cap.name,
  });
  console.log(`\nPERSISTED as active forged module (fleet-wide).`);
}
