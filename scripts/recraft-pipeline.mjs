// PIPELINE PROOF for the new RECRAFT render mode: full lab path
// (acquireReferences -> verifyReferences -> distillPlaybook -> renderCandidate)
// with renderMode forced to "recraft". Stoic = real channel (playbook persisted);
// samurai = inline DNA (watercolor Asia-history world, no channel exists yet).
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { acquireReferences, verifyReferences, distillPlaybook, renderCandidate } from "../src/lib/thumbnailLab.ts";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { mkdirSync } from "node:fs";

await bootstrapSecrets(() => {}, { required: ["FAL_KEY", "GEMINI_API_KEY"] });
import { join } from "node:path";
import { tmpdir } from "node:os";

const convex = new ConvexHttpClient("https://astute-camel-689.convex.cloud");
const chs = await convex.query(api.channels.listChannels, { ownerId: "owner_daniel" });
const tmp = join(tmpdir(), "recraft-pipe");
mkdirSync(tmp, { recursive: true });
const log = (m) => console.log(`  ${m}`);

const SAMURAI_DNA = {
  recurringSubject: "A lone samurai warrior in detailed armor, painted in loose expressive watercolor strokes with fine ink linework, posed against vast white negative space",
  setting: "clean white paper background, a cherry blossom tree in soft light watercolor washes, pale pink petals drifting",
  colorGrade: "white paper, pale blossom pink and blush washes, deep ink black, one crimson accent - elegant Japanese watercolor, never photoreal",
  palette: ["#ffffff", "#f6c9d4", "#1c1a18", "#c0273a"],
  thumbnail: { subject: "watercolor samurai mid-pose with cherry blossoms, dramatic ink-brush energy", palette: ["#ffffff", "#f6c9d4", "#c0273a"] },
  visualAvoid: ["photorealism", "stock photography", "neon", "modern objects", "play buttons or any UI chrome"],
};

const JOBS = [
  { key: "stoic", find: "Stoic", niche: "Stoicism / Philosophy", title: "The Stoic Rule That Kills All Anxiety" },
  { key: "invest", find: "Investory", niche: "Finance", title: "The $50 Trillion Wealth Transfer Has Already Started" },
  {
    key: "samurai",
    inline: { name: "Blossom & Blade", dna: SAMURAI_DNA, positioning: "elegant watercolor storyteller of Asian history - samurai, shoguns, the moments that ended eras" },
    niche: "Asian History",
    title: "The Day the Samurai Died",
  },
];

const only = process.env.ONLY;
for (const job of JOBS.filter((j) => !only || j.key === only)) {
  console.log(`\n=== ${job.key.toUpperCase()} ===`);
  try {
    let name, dna, positioning, channelId;
    if (job.inline) {
      ({ name, dna, positioning } = job.inline);
    } else {
      const ch = chs.find((c) => c.name.toLowerCase().includes(job.find.toLowerCase()));
      if (!ch) { console.log(`SKIP: channel ${job.find} not found. Channels: ${chs.map((c) => c.name).join(", ")}`); continue; }
      name = ch.name; dna = ch.styleDNA; channelId = ch._id;
      positioning = ch.identity?.creativeBrief?.positioning ?? ch.identity?.persona ?? "";
    }
    const fresh = await acquireReferences({ channelName: name, positioning, niche: job.niche, log });
    const refs = await verifyReferences({ candidates: fresh, channelName: name, positioning, tmpDir: tmp, log });
    const playbook = await distillPlaybook({ refs, dna, channelName: name, positioning, log });
    playbook.visualLanguage = { ...(playbook.visualLanguage ?? {}), renderMode: "recraft" };
    console.log(`language: font=${playbook.visualLanguage?.font} accent=${playbook.visualLanguage?.accentColor} energy=${playbook.energy} mode=${playbook.visualLanguage?.renderMode}`);
    console.log(`imageStyle: ${playbook.visualLanguage?.imageStyle}`);
    if (channelId) await convex.mutation(api.channels.updateChannel, { channelId, thumbnailPlaybook: playbook });
    await renderCandidate({
      pattern: playbook.patterns[0], title: job.title, playbook,
      outJpg: join(tmp, `pipe_${job.key}.jpg`), tmpDir: tmp, idx: 0, log,
    });
    console.log(`OK: ${join(tmp, `pipe_${job.key}.jpg`)}`);
  } catch (e) {
    console.log(`FAIL ${job.key}: ${e.message}`);
  }
}
