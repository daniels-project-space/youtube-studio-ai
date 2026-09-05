/**
 * Drive the REAL thumbnail module end to end.
 *
 * Unlike nb-thumb-compare.ts (which freezes a scene so every model receives
 * identical bytes), this supplies only what the production pipeline supplies —
 * a channel name, a video title, and the channel's own identity — and lets
 * renderCandidate() invent the layout, hero, background, story details and
 * headline copy itself. That means the story-interest gate, the identity
 * contract, the golden craft bar and the badge signature all run for real.
 */
import { generateFalNanoBananaProThumbnailWithReceipt } from "@/lib/falNanoBananaProThumbnail";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StyleDNA } from "@/engine/creative/types";
import { applyThumbnailChannelIdentity } from "@/lib/thumbnailChannelIdentity";
import { buildStyleDnaPlaybook, renderCandidate } from "@/lib/thumbnailLab";
import { fingerprintThumbnail } from "@/lib/thumbnailSameness";
import type { ChannelDefectLedger } from "@/lib/thumbnailDefectLedger";

const OUT_DIR = process.env.NB_OUT_DIR ?? "/tmp/nb-compare/out-real";

/** Channel-level configuration only — no per-video scene or copy authoring. */
function channelDna(args: {
  palette: string[];
  subject: string;
  setting: string;
  composition: string;
  colorGrade: string;
  motifs: string[];
  avoid: string[];
}): StyleDNA {
  return {
    source: "research+vision",
    confidence: 0.9,
    groundingGaps: [],
    palette: args.palette,
    recurringSubject: args.subject,
    setting: args.setting,
    composition: args.composition,
    colorGrade: args.colorGrade,
    motifs: args.motifs,
    variationAxes: ["case"],
    motionVocabulary: ["slow push"],
    motionDiscipline: "locked camera",
    visualAvoid: args.avoid,
    thumbnail: {
      composition: args.composition,
      textRule: "maximum four words",
      palette: args.palette,
      subject: args.subject,
    },
    audio: {
      genre: "documentary",
      bpmRange: [70, 90],
      instrumentation: ["low strings"],
      textures: ["room tone"],
      moodArc: "tension into revelation",
      loudnessLufs: -16,
      loopable: false,
    },
    seo: {
      titleFormula: "[SUBJECT] — [REVELATION]",
      descriptionStructure: "claim, evidence, consequence",
      playlistStrategy: "topic",
    },
    refreshedAt: 1,
  };
}

const JOBS = [
  {
    id: "overbuilt-comparison",
    channelName: "Overbuilt",
    title: "The Render They Sold You vs What Actually Got Built",
    energy: undefined,
    dna: channelDna({
      palette: ["#1B2733", "#E2833C"],
      subject: "a promised architectural render measured against the delivered building",
      setting: "a city block in real daylight",
      composition: "two separate photographs butted together along a hard vertical seam",
      colorGrade: "clean render gloss against dusty real daylight",
      motifs: ["hoarding board", "scaffolding", "haze"],
      avoid: ["drawn divider bars", "infographic arrows", "one continuous building bisected by a line"],
    }),
  },
] as const;

async function main(): Promise<void> {
  for (const job of JOBS) {
    console.log(`\n=== ${job.channelName} — "${job.title}"`);
    const playbook = applyThumbnailChannelIdentity({
      channelName: job.channelName,
      playbook: {
        ...buildStyleDnaPlaybook({
          dna: job.dna,
          family: "narrated_stock",
          channelName: job.channelName,
          now: 1,
        }),
        ...(job.energy ? { energy: job.energy } : {}),
      },
    });
    console.log(`    identity profile: ${playbook.identityContract?.profile ?? "none"} · energy: ${playbook.energy} · subjectClass: ${playbook.identityContract?.subjectClass ?? "event"}`);
    console.log(`    patterns available: ${playbook.patterns.map((p) => p.name).join(", ")}`);
    const tmp = await mkdtemp(join(tmpdir(), `nb-real-${job.id}-`));
    const outJpg = join(OUT_DIR, `${job.id}.jpg`);
    // Simulate a channel that has repeatedly shipped an undersized hero, and a
    // catalogue whose last thumbnail used this exact idea.
    const defectLedger: ChannelDefectLedger = {
      channelName: job.channelName,
      observations: ["v-1", "v-2", "v-3"].map((videoKey, i) => ({
        videoKey, reason: "hero is too small, too much background", at: Date.now() - (i + 1) * 86_400_000,
      })),
    };
    const recentThumbnails = [
      await fingerprintThumbnail({ heroProp: "colossal Burj Khalifa tower shot from ground level looking steeply up into hazy desert sky" }),
    ];
    const result = await renderCandidate({
      pattern: playbook.patterns[0],
      defectLedger,
      recentThumbnails,
      useStoryJudge: true,
      title: job.title,
      channelName: job.channelName,
      playbook,
      outJpg,
      tmpDir: tmp,
      idx: 0,
      generateDesignedThumbnail: async ({ prompt, expectWords }) => {
        console.log(`    module planned copy: ${expectWords.join(" / ")}`);
        console.log(`    prompt: ${Buffer.byteLength(prompt, "utf8")} UTF-8 bytes`);
        await writeFile(join(OUT_DIR, `${job.id}.prompt.txt`), prompt);
        // The sealed, receipt-bearing provider the production block uses.
        //
        // This script existed to "drive the REAL thumbnail module end to end",
        // and then called a raw Google image endpoint of its own — so it was
        // exercising a path production does not take, and its results did not
        // describe the shipped renderer. It also tripped the runtime gate that
        // forbids a raw Google model boundary under scripts/, which is the only
        // reason the failure was visible at all.
        //
        // The endpoint is deliberately not spelled out here: that gate scans raw
        // source, so quoting the host in a comment re-trips it. Weakening a
        // production guard so a comment can pass would be the wrong trade.
        const generated = await generateFalNanoBananaProThumbnailWithReceipt({
          prompt,
          idempotencyContext: `nb-render-real:${job.id}`,
        });
        console.log(`    provider receipt: $${generated.receipt.costUsd.toFixed(4)}`);
        return generated.bytes;
      },
      log: (message) => console.log(`    ${message}`),
    });
    console.log(`    hero: ${result.concept.heroProp ?? "(none)"}`);
    console.log(`    -> ${result.path}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
