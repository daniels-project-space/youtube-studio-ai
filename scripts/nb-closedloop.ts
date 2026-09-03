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

const JOBS = [  {
    // "Boring and could be much more visual" — the fix is a physical, tactile
    // mechanism the viewer can SEE taking money, not a document being held.
    id: "investory",
    channelName: "Investory",
    title: "The Pension Fee That Quietly Took A Third Of Your Retirement",
    recentHues: [0, 10, 350],
    dna: channelDna({
      // DEEP GREEN world, far from both the red and the cyan.
      palette: ["#0E2B22", "#F2C230"],
      subject: "a physical mechanism visibly removing part of something that belongs to a person",
      setting: "a tactile real-world object standing in for the money, being cut, siphoned or shaved",
      composition: "extreme close crop on the mechanism doing the taking",
      colorGrade: "deep green-black field with ONE hot yellow accent",
      motifs: ["a slice removed", "a hand too late"],
      avoid: ["a person holding paperwork", "floating coins", "charts", "an office desk"],
    }),
  },
  {
    // "Horrible, boring, not understandable" — the previous frame showed bolt
    // cutters on an anonymous cable, which reads as nothing. The subject must be
    // the CONSEQUENCE: the thing that was supposed to be watching, blinded.
    id: "vault",
    channelName: "Vault Breach",
    title: "They Cut The Alarm Line And Nobody Noticed For 9 Hours",
    recentHues: [0, 10, 120],
    dna: channelDna({
      // AMBER-SODIUM world, far from red and green.
      palette: ["#1A1206", "#FFB020"],
      subject: "the security system that was supposed to be watching, visibly dead",
      setting: "the room the alarm was protecting, still and untouched, with the system dark",
      composition: "the dead indicator or blank screen dominant, the untouched room beyond",
      colorGrade: "near-black field with ONE sodium-amber source",
      motifs: ["a dark status light", "an empty mount"],
      avoid: ["anonymous cables", "generic tools in gloves", "cool cyan equipment light"],
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
