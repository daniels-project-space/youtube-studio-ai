// Render 3 thumbnails for a DELETED channel from its tombstone archive:
// archived DNA → fresh playbook distill → 3 pattern renders.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { acquireReferences, verifyReferences, distillPlaybook, renderCandidate } from "../src/lib/thumbnailLab.ts";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

void ConvexHttpClient; void api;
// Reconstructed from the channel's inception DNA (read before deletion).
const arc = { name: "The Drawn Past" };
const dna = {
  recurringSubject:
    "A single ink-stained hand sketching crosshatched historical figures and scenes directly onto a clean whiteboard, drawings coming alive stroke by stroke",
  setting: "a bright whiteboard canvas with warm paper-cream tones, sepia ink linework, one bold accent color (burnt orange) used sparingly",
  colorGrade: "warm paper-white background, sepia/charcoal ink lines, burnt-orange accent — hand-drawn editorial illustration, never photoreal",
  palette: ["#f5efe0", "#2b2620", "#c45a1d", "#6b5d4a"],
  thumbnail: { subject: "a dramatic hand-drawn crosshatch illustration of the episode's historical moment, mid-sketch with the artist's hand visible", palette: ["#f5efe0", "#2b2620", "#c45a1d"] },
  visualAvoid: ["photorealism", "stock photography", "modern objects", "neon colors"],
};
const positioning = "A calm, curious educator who sketches history into life with clean lines and dry wit — hand-drawn whiteboard explainers";
console.log(`reconstructed: ${arc.name}`);

const log = (m) => console.log(`  ${m}`);
const tmp = join(tmpdir(), "thumbs3");
mkdirSync(tmp, { recursive: true });

const fresh = await acquireReferences({ channelName: arc.name, positioning, niche: "History", log });
const refs = await verifyReferences({ candidates: fresh, channelName: arc.name, positioning, tmpDir: tmp, log });
const playbook = await distillPlaybook({ refs, dna, channelName: arc.name, positioning, log });
console.log(`playbook: energy=${playbook.energy} patterns=${playbook.patterns.map((p) => p.name).join(" / ")}`);

const title = "The Map That Redrew Europe: How the Congress of Vienna Changed Everything";
for (let i = 0; i < Math.min(3, playbook.patterns.length); i++) {
  try {
    await renderCandidate({
      pattern: playbook.patterns[i], title, playbook,
      outJpg: join(tmp, `drawn_${i + 1}.jpg`), tmpDir: tmp, idx: i, log,
    });
    console.log(`OK ${i + 1}: ${playbook.patterns[i].name}`);
  } catch (e) { console.log(`FAIL ${i + 1}: ${e.message}`); }
}
