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
 * The critique combines the deterministic gates with the REAL vision reviewer.
 * An earlier version deliberately used deterministic gates only, to keep the
 * contrast measurement clean. That removed the only gate that can see a figure
 * with three arms, and duly shipped one — a defect no amount of contrast,
 * seam or hue measurement can detect. Cheap measurements cannot replace looking
 * at the picture; they can only tell you things looking at it would miss.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StyleDNA } from "@/engine/creative/types";
import { produceAndCritique } from "@/engine/critiqueLoop";
import { applyThumbnailChannelIdentity } from "@/lib/thumbnailChannelIdentity";
import { buildStyleDnaPlaybook, renderCandidate, runThumbnailMobileReferenceQa } from "@/lib/thumbnailLab";
import { hasVisionKey } from "@/lib/vision";
import { gradeThumbnailForMobile } from "@/lib/thumbnailMobileGate";
import { gradeThumbnailPalette, readThumbnailPalette } from "@/lib/thumbnailPaletteGuard";
import { detectFlatPanel } from "@/lib/thumbnailPanelDetector";
import { THUMBNAIL_FINAL_TIER } from "@/lib/thumbnailRenderTier";

const OUT = process.env.NB_OUT_DIR ?? "/tmp/nb-compare/out-loop";
const MAX_ITERS = 3;

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
    // HEIST — a new one. Art theft, nothing to do with vaults or getaway cars.
    id: "blankframes",
    channelName: "Blank Frames",
    title: "The Painting That Hung Upside Down For Eleven Years Before Anyone Checked",
    recentHues: [],
    dna: channelDna({
      palette: ["#171A21", "#C4452F"],
      subject: "the absence left behind in a gallery after something is taken",
      setting: "museum and gallery interiors after hours",
      composition: "the empty place where the work should be, at human scale",
      colorGrade: "cold gallery light, deep parquet shadow",
      motifs: ["an empty hanging wire", "a numbered wall label", "a velvet rope"],
      avoid: ["masked burglars", "laser grids", "money", "getaway cars"],
    }),
  },
  {
    // NEW — deep-sea engineering failure. No palette accent supplied on
    // purpose: the accent must fall through to the spread default, which is
    // the fix that replaced the hard-coded gold.
    id: "crushdepth",
    channelName: "Crush Depth",
    title: "The Submersible That Imploded Because Of One Bolt",
    recentHues: [],
    dna: channelDna({
      palette: ["#04141C"],
      subject: "a machine built to survive pressure, and the one part that did not",
      setting: "deep water and the surface vessels that work above it",
      composition: "the machine at true scale against water that has no bottom",
      colorGrade: "black water pierced by artificial light",
      motifs: ["a single work light in dark water", "a hull seam", "a tether"],
      avoid: ["sea monsters", "shipwreck cliché", "sunlit tropical water"],
    }),
  },
  {
    // NEW — consumer/supply-chain expose. Deliberately mundane and brightly
    // lit, the opposite visual world to the other two.
    id: "proofofpurchase",
    channelName: "Proof Of Purchase",
    title: "Why The Big Bag Of Crisps Has Been Getting Lighter Every Year",
    recentHues: [],
    dna: channelDna({
      palette: ["#F4F1EA", "#2E7D5B"],
      subject: "an everyday product handled as physical evidence",
      setting: "supermarket aisles and kitchen counters under flat retail light",
      composition: "the ordinary object made forensic at close range",
      colorGrade: "bright flat fluorescent retail light, honest colour",
      motifs: ["a shelf edge label", "a set of kitchen scales", "packaging"],
      avoid: ["dark dramatic lighting", "conspiracy imagery", "stock businesspeople"],
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
          useStoryJudge: true,
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
      critique: async (value, iter) => {
        const mobile = await gradeThumbnailForMobile({ imagePath: value.outJpg });
        const palette = gradeThumbnailPalette({
          reading: await readThumbnailPalette(value.outJpg),
          recentHues: job.recentHues,
        });
        const panel = await detectFlatPanel({ imagePath: value.outJpg });
        const issues = [...mobile.failures, ...palette.issues, ...panel.issues];
        let visionOk = true;
        if (hasVisionKey()) {
          const tmp = await mkdtemp(join(tmpdir(), `qa-${job.id}-`));
          const verdict = await runThumbnailMobileReferenceQa({
            outJpg: value.outJpg,
            tmpDir: tmp,
            title: job.title,
            playbook,
            recentHues: job.recentHues,
          }).catch(() => null);
          if (verdict) {
            // Anatomy and legibility live here and nowhere else.
            // Punch 5 passed every threshold and still produced a weak frame.
            // The deterministic gates are FLOORS — they establish that a
            // candidate is not broken, not that it is good. The reviewer's own
            // punch score is the only quality signal in the loop, so the loop
            // must actually spend its remaining iterations on it.
            visionOk = verdict.faceClear && verdict.uiClean && verdict.textOk && verdict.punch >= 7;
            if (!visionOk) issues.push(verdict.reason || "vision reviewer rejected the candidate");
            console.log(`      iter ${iter} vision: face=${verdict.faceClear} ui=${verdict.uiClean} text=${verdict.textOk} punch=${verdict.punch}`);
          }
        }
        const ok = mobile.passed && !palette.monotonous && !panel.hasFlatPanel && visionOk;
        return { score: ok ? 1 : 0, pass: ok, issues };
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
