// PROOF RUN: distill fresh visual-language playbooks for 4 vastly different
// channels and render one thumbnail each â€” no two may wear the same look.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { acquireReferences, verifyReferences, distillPlaybook, renderCandidate } from "../src/lib/thumbnailLab.ts";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const convex = new ConvexHttpClient("https://astute-camel-689.convex.cloud");
const chs = await convex.query(api.channels.listChannels, { ownerId: "owner_daniel" });
const tmp = join(tmpdir(), "four");
mkdirSync(tmp, { recursive: true });
const log = (m) => console.log(`  ${m}`);

const DRAWN_DNA = {
  recurringSubject: "A single ink-stained hand sketching crosshatched historical figures and scenes onto a whiteboard, drawings alive stroke by stroke",
  setting: "bright whiteboard canvas, warm paper-cream tones, sepia ink linework, burnt-orange accent used sparingly",
  colorGrade: "warm paper-white, sepia/charcoal ink, burnt-orange accent â€” hand-drawn editorial illustration, never photoreal",
  palette: ["#f5efe0", "#2b2620", "#c45a1d", "#6b5d4a"],
  thumbnail: { subject: "dramatic hand-drawn crosshatch illustration of the episode's moment, artist's hand visible mid-sketch", palette: ["#f5efe0", "#2b2620", "#c45a1d"] },
  visualAvoid: ["photorealism", "stock photography", "modern objects", "neon"],
};

const JOBS = [
  { key: "invest", find: "Investory", niche: "Finance", title: "The $50 Trillion Wealth Transfer Has Already Started" },
  { key: "seaside", find: "Seaside", niche: "Lofi", title: "Warm Nights by the Sea ~ sleepy waves, a girl and her cat" },
  { key: "neon", find: "Rainy Neon", niche: "Lofi", title: "Tokyo Rain at 2AM // neon beats to drift away" },
  { key: "drawn", inline: { name: "The Drawn Past", dna: DRAWN_DNA, positioning: "calm curious educator who sketches history into life â€” hand-drawn whiteboard explainers" }, niche: "History", title: "The Map That Redrew Europe Overnight" },
];

const only = process.env.ONLY; for (const job of JOBS.filter((j) => !only || j.key === only)) {
  console.log(`\n=== ${job.key.toUpperCase()} ===`);
  try {
    let name, dna, positioning, channelId;
    if (job.inline) {
      ({ name, dna, positioning } = job.inline);
    } else {
      const ch = chs.find((c) => c.name.includes(job.find));
      if (!ch) { console.log(`SKIP: channel ${job.find} not found`); continue; }
      name = ch.name; dna = ch.styleDNA; channelId = ch._id;
      positioning = ch.identity?.creativeBrief?.positioning ?? ch.identity?.persona ?? "";
    }
    const fresh = await acquireReferences({ channelName: name, positioning, niche: job.niche, log });
    const refs = await verifyReferences({ candidates: fresh, channelName: name, positioning, tmpDir: tmp, log });
    const playbook = await distillPlaybook({ refs, dna, channelName: name, positioning, log });
    if (process.env.FORCE_MODE) playbook.visualLanguage = { ...(playbook.visualLanguage ?? {}), renderMode: process.env.FORCE_MODE };
    console.log(`language: font=${playbook.visualLanguage?.font} treatment=${playbook.visualLanguage?.treatment} accent=${playbook.visualLanguage?.accentColor} energy=${playbook.energy}`);
    console.log(`imageStyle: ${playbook.visualLanguage?.imageStyle}`);
    if (channelId) {
      await convex.mutation(api.channels.updateChannel, { channelId, thumbnailPlaybook: playbook });
    }
    await renderCandidate({
      pattern: playbook.patterns[0], title: job.title, playbook,
      outJpg: join(tmp, `four_${job.key}.jpg`), tmpDir: tmp, idx: 0, log,
    });
    console.log(`OK: four_${job.key}.jpg`);
  } catch (e) {
    console.log(`FAIL ${job.key}: ${e.message}`);
  }
}
