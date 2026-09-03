/** Render the Sealed Records candidate through the PRODUCTION fal route. */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StyleDNA } from "@/engine/creative/types";
import { applyThumbnailChannelIdentity } from "@/lib/thumbnailChannelIdentity";
import { buildStyleDnaPlaybook, renderCandidate } from "@/lib/thumbnailLab";

const OUT = "/tmp/nb-compare/out-fal";

const dna: StyleDNA = {
  source: "research+vision", confidence: 0.9, groundingGaps: [],
  palette: ["#14120E", "#C8A24A"],
  recurringSubject: "a die-cut photo cutout of the person the story is about, over torn newsprint",
  setting: "a tabloid collage of torn newspaper strips and court filings",
  composition: "cutout hero centre, collage layered behind",
  colorGrade: "aged newsprint with hard shadows",
  motifs: ["torn tabloid strip", "redaction bar", "exhibit sticker"],
  variationAxes: ["case"], motionVocabulary: ["push"], motionDiscipline: "locked",
  visualAvoid: ["victims", "reconstruction"],
  thumbnail: { composition: "cutout hero centre", textRule: "max four words", palette: ["#14120E", "#C8A24A"], subject: "the person the story is about" },
  audio: { genre: "documentary", bpmRange: [70, 90], instrumentation: ["strings"], textures: ["room"], moodArc: "tension", loudnessLufs: -16, loopable: false },
  seo: { titleFormula: "[SUBJECT] — [REVELATION]", descriptionStructure: "claim, evidence", playlistStrategy: "topic" },
  refreshedAt: 1,
};

async function falRender(prompt: string): Promise<Uint8Array> {
  const res = await fetch("https://fal.run/fal-ai/nano-banana-pro", {
    method: "POST",
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      prompt, num_images: 1, aspect_ratio: "16:9", output_format: "png",
      safety_tolerance: "4", resolution: "2K", limit_generations: true, enable_web_search: false,
    }),
    signal: AbortSignal.timeout(300_000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`fal HTTP ${res.status}: ${raw.slice(0, 400)}`);
  const payload = JSON.parse(raw) as { images?: { url?: string }[]; description?: string };
  const url = payload.images?.[0]?.url;
  if (!url) throw new Error(`fal returned no image: ${raw.slice(0, 300)}`);
  const img = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  return Buffer.from(await img.arrayBuffer());
}

async function main() {
  const playbook = applyThumbnailChannelIdentity({
    channelName: "Sealed Records",
    playbook: buildStyleDnaPlaybook({ dna, family: "narrated_stock", channelName: "Sealed Records", now: 1 }),
  });
  const tmp = await mkdtemp(join(tmpdir(), "nb-fal-"));
  const r = await renderCandidate({
    pattern: playbook.patterns[0],
    title: "The Secret Deal That Buried The Epstein Case For A Decade",
    channelName: "Sealed Records",
    playbook,
    outJpg: join(OUT, "epstein.jpg"),
    tmpDir: tmp,
    idx: 0,
    generateDesignedThumbnail: async ({ prompt, expectWords }) => {
      console.log(`    copy: ${expectWords.join(" / ")}`);
      await writeFile(join(OUT, "epstein.prompt.txt"), prompt);
      return falRender(prompt);
    },
    log: (m) => console.log(`    ${m}`),
  });
  console.log(`    hero: ${r.concept.heroProp}`);
  console.log(`    -> ${r.path}`);
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
