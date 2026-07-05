// WHITEBOARD STYLE SAMPLES — same scene, 4 style anchors, for Daniel to choose
// the look before I lock it across all panels. Stills only (Banana/Gemini).
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { generateBananaImage } from "../src/lib/banana.ts";

const log = (m) => console.error(`[styles] ${m}`);
await bootstrapSecrets((m) => console.error(`[boot] ${m}`), { required: ["GEMINI_API_KEY"] });

const DIR = join(process.cwd(), "output", "whiteboard", "styles");
await mkdir(DIR, { recursive: true });
await mkdir("/var/www/html/whiteboard/styles", { recursive: true }).catch(() => {});

const SCENE =
  `on the left a samurai in armor holding a katana, then a curved arrow pointing left, on the right a steam-powered ` +
  `warship with a smoke plume. Hand-letter EXACTLY, neat capitals, perfectly spelled and legible: "SEVEN CENTURIES" across ` +
  `the top and "1853" under the ship.`;

const BOARD = `A flat, head-on photo of a clean white dry-erase whiteboard with generous white margins, no hand in frame, no watermark, no UI, no extra words.`;

const STYLES = [
  {
    id: "A_simple_doodle",
    desc:
      `Drawn as a CHILDLIKE SIMPLE whiteboard doodle: uniform thick black dry-erase marker strokes, very simple iconic shapes, ` +
      `NO shading, NO fine detail, flat and minimal, like a quick teacher's sketch. Red marker for ONLY the smoke.`,
  },
  {
    id: "B_clean_lineart",
    desc:
      `Drawn as clean confident black marker line-art: a single consistent stroke weight, simple but well-proportioned icons, ` +
      `no shading. Red marker for ONLY the smoke.`,
  },
  {
    id: "C_detailed_ink",
    desc:
      `Drawn as a DETAILED black ink illustration: fine linework, cross-hatching and engraving-style shading, intricate and ` +
      `premium, but still on the whiteboard. Red ink for ONLY the smoke.`,
  },
  {
    id: "D_flat_color_cartoon",
    desc:
      `Drawn as a FLAT VECTOR CARTOON with simple bright COLOR fills and bold black outlines, friendly modern explainer-video ` +
      `style (like The Swedish Investor channel), clean and cheerful.`,
  },
];

for (const s of STYLES) {
  try {
    const prompt = `${BOARD} On it: ${SCENE} STYLE: ${s.desc} HARD RULES: every letter and number spelled exactly and legible.`;
    const bytes = await generateBananaImage({ prompt, aspectRatio: "16:9" });
    const out = join(DIR, `${s.id}.png`);
    await writeFile(out, bytes);
    await writeFile(join("/var/www/html/whiteboard/styles", `${s.id}.png`), bytes).catch(() => {});
    log(`${s.id} ✓`);
  } catch (e) {
    log(`${s.id} FAILED: ${e.message}`);
  }
}
console.log(JSON.stringify({ dir: DIR, url: "http://87.106.233.113/whiteboard/styles/" }, null, 2));
