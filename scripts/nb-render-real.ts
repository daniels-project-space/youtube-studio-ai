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
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StyleDNA } from "@/engine/creative/types";
import { applyThumbnailChannelIdentity } from "@/lib/thumbnailChannelIdentity";
import { buildStyleDnaPlaybook, renderCandidate } from "@/lib/thumbnailLab";

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

async function generateWithNanoBananaPro(prompt: string): Promise<Uint8Array> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not injected");
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent",
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: "16:9", imageSize: "2K" },
        },
      }),
      signal: AbortSignal.timeout(300_000),
    },
  );
  const raw = await response.text();
  if (!response.ok) throw new Error(`Gemini HTTP ${response.status}: ${raw.slice(0, 300)}`);
  const payload = JSON.parse(raw) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] }; finishReason?: string }[];
  };
  const part = payload.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) {
    throw new Error(`Gemini returned no image (finishReason=${payload.candidates?.[0]?.finishReason})`);
  }
  return Buffer.from(part.inlineData.data, "base64");
}

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
    const result = await renderCandidate({
      pattern: playbook.patterns[0],
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
        return generateWithNanoBananaPro(prompt);
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
