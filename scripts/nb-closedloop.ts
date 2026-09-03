/**
 * CLOSED-LOOP TEST.
 *
 * Every render measured so far was produced open-loop: renderCandidate called
 * directly, single shot, with nothing telling the generator it had failed. The
 * contrast numbers from that setup are therefore the worst case, not the
 * production case — in the real pipeline a failing verdict becomes
 * `priorIssues` and drives a regenerate (engine/critiqueLoop.ts:161).
 *
 * This wires the gate in so the claim can be tested rather than asserted.
 *
 * Every candidate renders on the SHIPPING model. Drafting is disabled, so the
 * loop judges exactly the picture a viewer would get.
 *
 * The critique here is DELIBERATELY DETERMINISTIC — the mobile squint gate, the
 * monotony guard and the copy gates, all local and free. That is not a
 * shortcut: the question being asked is whether feeding a measured contrast
 * failure back actually improves contrast, and a vision reviewer in the loop
 * would add cost and a second opinion that muddies exactly that measurement.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StyleDNA } from "@/engine/creative/types";
import { produceAndCritique } from "@/engine/critiqueLoop";
import { applyThumbnailChannelIdentity } from "@/lib/thumbnailChannelIdentity";
import { buildStyleDnaPlaybook, renderCandidate } from "@/lib/thumbnailLab";
import { gradeThumbnailForMobile } from "@/lib/thumbnailMobileGate";
import { gradeThumbnailPalette, readThumbnailPalette } from "@/lib/thumbnailPaletteGuard";
import { THUMBNAIL_FINAL_TIER } from "@/lib/thumbnailRenderTier";

const OUT = process.env.NB_OUT_DIR ?? "/tmp/nb-compare/out-loop";
const MAX_ITERS = 2;

function channelDna(a: {
  palette: string[]; subject: string; setting: string; composition: string;
  colorGrade: string; motifs: string[]; avoid: string[];
}): StyleDNA {
  return {
    source: "research+vision", confidence: 0.9, groundingGaps: [],
    palette: a.palette, recurringSubject: a.subject, setting: a.setting,
    composition: a.composition, colorGrade: a.colorGrade, motifs: a.motifs,
    variationAxes: ["case"], motionVocabulary: ["push"], motionDiscipline: "locked",
    visualAvoid: a.avoid,
    thumbnail: { composition: a.composition, textRule: "max four words", palette: a.palette, subject: a.subject },
    audio: { genre: "documentary", bpmRange: [70, 90], instrumentation: ["strings"], textures: ["room"], moodArc: "tension", loudnessLufs: -16, loopable: false },
    seo: { titleFormula: "[SUBJECT] — [REVELATION]", descriptionStructure: "claim, evidence", playlistStrategy: "topic" },
    refreshedAt: 1,
  };
}

/** Shipping model for EVERY candidate — drafting is disabled by owner decision. */
async function falRender(prompt: string): Promise<Uint8Array> {
  const res = await fetch(`https://fal.run/${THUMBNAIL_FINAL_TIER.model}`, {
    method: "POST",
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      prompt, num_images: 1, aspect_ratio: "16:9", output_format: "png",
      safety_tolerance: "4", resolution: THUMBNAIL_FINAL_TIER.resolution,
      limit_generations: true, enable_web_search: false,
    }),
    signal: AbortSignal.timeout(300_000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`fal HTTP ${res.status}: ${raw.slice(0, 200)}`);
  const url = (JSON.parse(raw) as { images?: { url?: string }[] }).images?.[0]?.url;
  if (!url) throw new Error("fal returned no image");
  return Buffer.from(await (await fetch(url)).arrayBuffer());
}

const JOBS = [
  {
    id: "hannibal",
    channelName: "Empires At War",
    title: "The Day Hannibal Stood At The Gates Of Rome",
    recentHues: [222, 216, 208],
    dna: channelDna({
      palette: ["#0D0F14", "#C8442E"],
      subject: "a heroic commander or war beast at the peak of a campaign moment",
      setting: "the ancient Mediterranean world as a cinematic painted film still",
      composition: "one dominant figure at peak action, army and landscape scale behind",
      colorGrade: "hard directional key light, deep black shadow against bright highlight",
      motifs: ["army column", "war standard"], avoid: ["drawn line art", "all-over haze"],
    }),
  },
  {
    id: "investory",
    channelName: "Investory",
    title: "The Pension Fee That Quietly Took A Third Of Your Retirement",
    recentHues: [43, 41, 52],
    dna: channelDna({
      palette: ["#0B1220", "#D8A11A"],
      subject: "a tactile financial artifact enacting a wealth mechanism",
      setting: "a real domestic or institutional interior",
      composition: "human decision at close range",
      colorGrade: "hard window light against deep shadow",
      motifs: ["paper", "hands"], avoid: ["floating coins", "neon charts"],
    }),
  },
  {
    id: "vault",
    channelName: "Vault Breach",
    title: "They Cut The Alarm Line And Nobody Noticed For 9 Hours",
    recentHues: [197, 54, 61],
    dna: channelDna({
      palette: ["#0B0E12", "#4FD6C1"],
      subject: "a security mechanism being defeated by human hands and real tools",
      setting: "a service corridor lit only by working equipment",
      composition: "head-on one-point perspective, mechanism dead centre",
      colorGrade: "hard equipment light, deep black, full tonal range",
      motifs: ["worklight", "cut cable"], avoid: ["all-over haze", "uniform mid-tone"],
    }),
  },
] as const;

async function main(): Promise<void> {
  const rows: string[] = [];
  for (const job of JOBS) {
    console.log(`\n=== ${job.channelName} — "${job.title}"`);
    const playbook = applyThumbnailChannelIdentity({
      channelName: job.channelName,
      playbook: buildStyleDnaPlaybook({ dna: job.dna, family: "narrated_stock", channelName: job.channelName, now: 1 }),
    });
    const measured: number[] = [];

    const loop = await produceAndCritique<{ outJpg: string; contrast: number }>({
      label: `loop:${job.id}`,
      threshold: 1,
      maxIters: MAX_ITERS,
      log: (m) => console.log(`    ${m}`),
      channel: { channelName: job.channelName },
      produce: async (priorIssues, iter) => {
        const tmp = await mkdtemp(join(tmpdir(), `loop-${job.id}-`));
        const outJpg = join(OUT, `${job.id}-iter${iter}.jpg`);
        const result = await renderCandidate({
          pattern: playbook.patterns[0],
          title: job.title,
          channelName: job.channelName,
          playbook,
          outJpg,
          tmpDir: tmp,
          idx: 0,
          // THE WHOLE POINT: the previous iteration's measured failures.
          ...(priorIssues.length ? { priorIssues } : {}),
          generateDesignedThumbnail: async ({ prompt }) => falRender(prompt),
          log: (m) => console.log(`      ${m}`),
        });
        const mobile = await gradeThumbnailForMobile({ imagePath: result.path });
        measured.push(mobile.squintContrast);
        console.log(`      iter ${iter}: contrast ${mobile.squintContrast}`);
        return { outJpg: result.path, contrast: mobile.squintContrast };
      },
      critique: async (value) => {
        const mobile = await gradeThumbnailForMobile({ imagePath: value.outJpg });
        const palette = gradeThumbnailPalette({
          reading: await readThumbnailPalette(value.outJpg),
          recentHues: job.recentHues,
        });
        const issues = [...mobile.failures, ...palette.issues];
        return {
          score: mobile.passed && !palette.monotonous ? 1 : 0,
          pass: mobile.passed && !palette.monotonous,
          issues,
        };
      },
    });
    const first = measured[0] ?? 0;
    const best = Math.max(...measured);
    rows.push(`${job.id.padEnd(12)} iter1=${String(first).padEnd(6)} best=${String(best).padEnd(6)} delta=${best - first > 0 ? "+" : ""}${(best - first).toFixed(1).padEnd(6)} accepted=${loop.accepted}`);
  }
  console.log(`\n=== CLOSED LOOP RESULT (floor 110) ===`);
  for (const r of rows) console.log(r);
}

main().catch((e) => { console.error(e); process.exit(1); });
