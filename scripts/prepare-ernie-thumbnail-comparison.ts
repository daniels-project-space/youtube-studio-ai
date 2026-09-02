import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildThumbBrief, type ThumbBriefArgs } from "@/lib/banana";
import {
  GOLDEN_THUMBNAIL_CRAFT_RULES,
  OWNER_SELECTED_THUMBNAIL_PREFERENCE_RULES,
} from "@/lib/thumbnailGoldenStandard";

const OUT_DIR = "/tmp/ysa-ernie-thumbnail-comparison-v1";

type ComparisonInput = {
  key: string;
  sourceImage: string;
  provenance: "exact-preserved-native-prompt" | "reconstructed-from-selected-native-plan";
  prompt: string;
};

function fullPrompt(brief: ThumbBriefArgs): string {
  return `${buildThumbBrief(brief)} USER-APPROVED GOLDEN CRAFT BAR: ${GOLDEN_THUMBNAIL_CRAFT_RULES.join(" ")} `
    + `OWNER-SELECTED A/B PREFERENCES: ${OWNER_SELECTED_THUMBNAIL_PREFERENCE_RULES.join(" ")}`;
}

async function preservedPrompt(path: string): Promise<string> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as { prompt?: unknown };
  if (typeof parsed.prompt !== "string" || !parsed.prompt.trim()) {
    throw new Error(`${path} does not contain a preserved prompt`);
  }
  return parsed.prompt.trim();
}

async function main(): Promise<void> {
  const inputs: ComparisonInput[] = [
    {
      key: "history-deadly-dance",
      sourceImage: "/tmp/ysa-fal-pro-native-v8/history/history-attempt-2.jpg",
      provenance: "reconstructed-from-selected-native-plan",
      prompt: fullPrompt({
        channelName: "The Drawn Past",
        imageStyle: "premium hand-drawn editorial engraving on weathered warm paper, dense sepia and charcoal cross-hatching, one restrained burnt-orange accent",
        palette: ["#f5efe0", "#2b2620", "#c45a1d", "#6b5d4a"],
        accentColor: "#c45a1d",
        textObject: "stamp_ink",
        scene: "Three terrified medieval townsfolk are frozen at the peak of an uncontrollable plague dance, their exhausted bodies twisting together in panic while a giant ink-stained artist hand actively draws the scene with a steel nib from the right edge. One central face is huge and emotionally readable; burnt-orange motion slashes circle the dancers; a smoky medieval village recedes into the lower-left background. The full frame remains visibly hand-drawn, never photographic, with an urgent diagonal from headline to faces to drawing hand.",
        lines: [
          { text: "DEADLY", accent: false },
          { text: "DANCE", accent: true, payoff: true },
        ],
        badge: "The Drawn Past",
      }),
    },
    {
      key: "comic-zero-weapons",
      sourceImage: "/tmp/ysa-fal-pro-native-v8/comic/comic-attempt-1.jpg",
      provenance: "reconstructed-from-selected-native-plan",
      prompt: fullPrompt({
        channelName: "Inked Histories",
        imageStyle: "cinematic cross-hatched papercraft war-comic poster, torn parchment depth, dramatic low-key battlefield light",
        palette: ["#f5eeda", "#201d1c", "#704214", "#9b2f25"],
        accentColor: "#704214",
        textObject: "carved",
        scene: "A lone unarmed battlefield medic dominates the right half, cropped hard at the edge, bracing a thick rope in both bloodied hands while lowering one wounded soldier over a jagged smoke-filled cliff. The medic's strained face and damaged hands are emotionally readable; the tiny suspended survivor below supplies the consequence. Torn parchment clouds and a distant burning ridge make three clear depth layers. The rope cuts diagonally across the composition into the left headline zone. No weapon appears anywhere; no comic panels or speech bubbles.",
        lines: [
          { text: "ZERO", accent: false },
          { text: "WEAPONS", accent: true, payoff: true },
        ],
        badge: "Inked Histories",
      }),
    },
    {
      key: "relics-buried-intact",
      sourceImage: "/tmp/ysa-real-nonlofi-v2/real-comic-relics/real-comic-relics-attempt-1.jpg",
      provenance: "exact-preserved-native-prompt",
      prompt: await preservedPrompt("/tmp/ysa-real-nonlofi-v2/real-comic-relics/real-comic-relics-attempt-1.native-plan.json"),
    },
    {
      key: "tax-split",
      sourceImage: "/tmp/ysa-real-nonlofi-v2/real-chalk-tax/real-chalk-tax-attempt-1.jpg",
      provenance: "exact-preserved-native-prompt",
      prompt: await preservedPrompt("/tmp/ysa-real-nonlofi-v2/real-chalk-tax/real-chalk-tax-attempt-1.native-plan.json"),
    },
    {
      key: "meditation-peace-awaits",
      sourceImage: "/tmp/ysa-real-nonlofi-v2/real-gratitude-people/real-gratitude-people-attempt-2.jpg",
      provenance: "exact-preserved-native-prompt",
      prompt: await preservedPrompt("/tmp/ysa-real-nonlofi-v2/real-gratitude-people/real-gratitude-people-attempt-2.native-plan.json"),
    },
  ];

  await mkdir(OUT_DIR, { recursive: true });
  const manifest = [];
  for (const input of inputs) {
    const promptSha256 = createHash("sha256").update(input.prompt).digest("hex");
    const promptFile = join(OUT_DIR, `${input.key}.prompt.json`);
    await writeFile(promptFile, `${JSON.stringify({ prompt: input.prompt }, null, 2)}\n`, "utf8");
    manifest.push({
      key: input.key,
      sourceImage: input.sourceImage,
      provenance: input.provenance,
      promptFile,
      promptSha256,
      promptCharacters: input.prompt.length,
    });
  }
  await writeFile(join(OUT_DIR, "manifest.json"), `${JSON.stringify({ version: 1, inputs: manifest }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outDir: OUT_DIR, inputs: manifest }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
