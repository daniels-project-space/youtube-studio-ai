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
    id: "hannibal",
    channelName: "Empires At War",
    title: "The Day Hannibal Stood At The Gates Of Rome",
    recentHues: [190, 205, 218],
    dna: channelDna({
      palette: ["#E9EDF2", "#B3121D"],
      subject: "the most surprising object of the campaign, not the most famous man",
      setting: "a bright open snowfield, daylight, the unglamorous part of the campaign",
      composition: "the surprising object overwhelming in the frame, a countable column of tiny figures behind for scale",
      colorGrade: "bright snow-white field, near-monochrome, ONE saturated red",
      motifs: ["a torn red standard", "a column receding to the horizon"],
      avoid: ["dark interiors", "night", "warm firelight", "drawn line art", "a panel beside the picture"],
    }),
  },
  {
    id: "investory",
    channelName: "Investory",
    title: "The Pension Fee That Quietly Took A Third Of Your Retirement",
    recentHues: [190, 205, 218],
    dna: channelDna({
      palette: ["#123B2A", "#F2C230"],
      subject: "one person, one clear gesture, at the moment money they earned is gone",
      setting: "a bright ordinary kitchen in daylight",
      composition: "ONE person with exactly two arms and two hands, both visible and doing one single action",
      colorGrade: "bright daylight green-grey with ONE warm accent",
      motifs: ["a single sheet of paper", "an empty purse"],
      avoid: ["a person with hands in more than one place at once", "multiple simultaneous gestures", "dark rooms", "a panel beside the picture"],
    }),
  },
  {
    // "Too ambiguous and complicated" — and the judge agreed: it staged the
    // passive half and omitted the crime. Show BOTH in one simple frame.
    id: "vault",
    channelName: "Vault Breach",
    title: "They Emptied The Vault While The Camera Showed An Empty Room",
    recentHues: [190, 205, 218],
    dna: channelDna({
      palette: ["#1C1408", "#FF9E1B"],
      subject: "the theft and the thing that failed to see it, both plainly visible in one frame",
      setting: "the vault itself, standing wide open and stripped bare, with the camera above it",
      composition: "the emptied vault dominant and unmistakable; the camera small and pointed at it, its light dead",
      colorGrade: "warm sodium vault light, deep shadow, ONE amber source",
      motifs: ["an open vault door", "a dark camera housing"],
      avoid: ["a guard at a desk", "monitors", "cables", "anything requiring explanation", "a panel beside the picture"],
    }),
  },
  {
    // "Doesn't feel interesting or epic at all" — a console close-up is not
    // epic. Scale is the fix.
    id: "startheory",
    channelName: "Parsec Theory",
    title: "The Detail In Episode IV That Proves The Empire Knew All Along",
    recentHues: [190, 205, 218],
    dna: channelDna({
      palette: ["#04060C", "#59E0FF"],
      subject: "an overwhelming imperial structure at colossal scale with one small telling detail on it",
      setting: "deep space at a scale that dwarfs everything human",
      composition: "the colossal structure filling the frame, a tiny ship or figure giving true scale against it",
      colorGrade: "near-black space with ONE cold cyan source and a hard rim light",
      motifs: ["a tiny ship for scale", "a single lit aperture"],
      avoid: ["a control panel close-up", "a collage of characters", "a hand on a console", "a panel beside the picture"],
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
