import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  runThumbnailMobileReferenceQa,
  type ThumbnailPlaybook,
} from "@/lib/thumbnailLab";

const OUT_DIR = "/tmp/ysa-ernie-thumbnail-comparison-v1";

const jobs = [
  {
    key: "history-deadly-dance",
    title: "The Plague That Made People Dance",
    channelName: "The Drawn Past",
    niche: "hand-drawn history explainer",
    expectedWords: ["DEADLY", "DANCE"],
    imageStyle: "hand-drawn sepia cross-hatched engraving on warm paper with one burnt-orange accent",
    accentColor: "#c45a1d",
  },
  {
    key: "comic-zero-weapons",
    title: "The Medic Who Saved 75 Men At Hacksaw Ridge",
    channelName: "Inked Histories",
    niche: "historical motion comic",
    expectedWords: ["ZERO", "WEAPONS"],
    imageStyle: "cinematic cross-hatched papercraft war comic with torn parchment depth",
    accentColor: "#704214",
  },
  {
    key: "relics-buried-intact",
    title: "7 Secrets of Battlefield Relic Preservation Revealed",
    channelName: "Inked Histories",
    niche: "historical motion comic",
    expectedWords: ["BURIED", "INTACT"],
    imageStyle: "cinematic cross-hatched papercraft archaeological comic poster",
    accentColor: "#704214",
  },
  {
    key: "tax-split",
    title: "Taxation Isn't Complex: A Simple Framework",
    channelName: "Chalk & Compound",
    niche: "hand-drawn personal finance explainer",
    expectedWords: ["TAX", "SPLIT"],
    imageStyle: "hand-drawn editorial chalk illustration in an antique dark-academic ledger world",
    accentColor: "#e0b35a",
  },
  {
    key: "meditation-peace-awaits",
    title: "Gratitude for the People Beside You Brings Deep Sleep",
    channelName: "Gratitude Springs",
    niche: "guided sleep meditation",
    expectedWords: ["PEACE", "AWAITS"],
    imageStyle: "hyperreal cinematic nature scene with ethereal glowing mist",
    accentColor: "#6495ed",
  },
] as const;

function playbook(job: (typeof jobs)[number]): ThumbnailPlaybook {
  return {
    source: "style_dna_foundation",
    energy: "bold",
    visualLanguage: {
      font: "bebas",
      treatment: "clean",
      baseColor: "#f5f0e8",
      accentColor: job.accentColor,
      imageStyle: job.imageStyle,
      composition: "full_scene",
      uppercase: true,
    },
    rules: [
      "One unmistakable story-specific hero dominates at mobile size.",
      "The exact two-word headline is immediately legible with one clear hierarchy.",
      "Only one compact channel badge may accompany the headline.",
      "Cause and consequence read together in under one second.",
    ],
    avoid: ["generic stock imagery", "extra subtitle or tagline", "broken glyphs", "clutter", "text over the hero"],
    patterns: [{
      name: "comparison-proof",
      when: "provider comparison QA",
      fluxRecipe: "One dominant story-specific hero and one supporting consequence detail.",
      textRecipe: { lines: job.expectedWords.map((text) => ({ text })) },
    }],
    refsUsed: [],
    distilledAt: Date.now(),
  };
}

async function main(): Promise<void> {
  for (const job of jobs) {
    const tmpDir = join(OUT_DIR, `${job.key}.qa`);
    await mkdir(tmpDir, { recursive: true });
    const verdict = await runThumbnailMobileReferenceQa({
      outJpg: join(OUT_DIR, `${job.key}.ernie.png`),
      tmpDir,
      title: job.title,
      niche: job.niche,
      playbook: playbook(job),
      referenceUrls: [],
      brandContext: { channelName: job.channelName, imageStyle: job.imageStyle },
      expectedWords: job.expectedWords,
      qaTier: "final",
      log: (message) => console.log(`[${job.key}] ${message}`),
    });
    await writeFile(join(OUT_DIR, `${job.key}.ernie.qa.json`), `${JSON.stringify(verdict, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ key: job.key, verdict }));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
