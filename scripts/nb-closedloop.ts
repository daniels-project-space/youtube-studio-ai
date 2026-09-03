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
    // "Clearer text on what it references" + "more emotional".
    id: "investory",
    channelName: "Investory",
    title: "The Pension Fee That Quietly Took A Third Of Your Retirement",
    recentHues: [205, 210, 200],
    dna: channelDna({
      palette: ["#0E2B22", "#F2C230"],
      subject: "an older person at the moment of realising money they earned is gone",
      setting: "an ordinary cold home where the consequence is visible around them",
      composition: "the face and hands carry the emotion at close range; the evidence surrounds them in the same room",
      colorGrade: "cold green-grey domestic light with ONE warm source on the person",
      motifs: ["unpaid bills", "a single lit lamp"],
      avoid: ["a person holding paperwork calmly", "floating coins", "charts", "a diagram of a mechanism", "a panel beside the picture"],
    }),
  },
  {
    // "Still not interesting enough" — the story is the person who should have
    // noticed, not the tool.
    id: "vault",
    channelName: "Vault Breach",
    title: "They Robbed It While The Guard Watched A Loop Of An Empty Room",
    recentHues: [119, 130, 110],
    dna: channelDna({
      palette: ["#141821", "#FF7A1A"],
      subject: "the person who was supposed to notice, calmly watching the wrong thing",
      setting: "a security desk whose screens show a room that is no longer real",
      composition: "the watcher and the screens in one frame, the truth visible to us and not to them",
      colorGrade: "near-black room lit only by screen glow with ONE hot amber source",
      motifs: ["a frozen timestamp", "an untouched coffee"],
      avoid: ["anonymous cables", "tools in gloves", "an equipment box", "a panel beside the picture"],
    }),
  },
  {
    // New channel: Star Wars fan theory.
    id: "startheory",
    channelName: "Parsec Theory",
    title: "The Detail In Episode IV That Proves The Empire Knew All Along",
    recentHues: [30, 40, 20],
    dna: channelDna({
      palette: ["#05070D", "#3FD2FF"],
      subject: "one overlooked physical detail from the films, isolated and made enormous",
      setting: "the frame of the film itself, treated as evidence rather than illustration",
      composition: "the overlooked detail dominant and lit like the point of the whole story",
      colorGrade: "deep space-black with ONE cold cyan source and a hard rim",
      motifs: ["a freeze-frame marker", "scan lines"],
      avoid: ["a collage of characters", "movie-poster montage", "a panel beside the picture", "warm firelight"],
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
        const panel = await detectFlatPanel({ imagePath: value.outJpg });
        const issues = [...mobile.failures, ...palette.issues, ...panel.issues];
        const ok = mobile.passed && !palette.monotonous && !panel.hasFlatPanel;
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
