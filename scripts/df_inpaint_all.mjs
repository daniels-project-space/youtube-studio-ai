// Batch: generate a CLEAN background plate per scene (foreground figure removed +
// inpainted) with Nano Banana. Skips any that already exist.
import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";

const RUN = join(process.cwd(), "output", "lorecraft", "moria");
const rd = (f) => join(RUN, f);
await bootstrapSecrets(() => {}, { required: ["GEMINI_API_KEY"] });
const KEY = process.env.GEMINI_API_KEY;
const N = 4;

const PROMPT =
  "Edit this painterly fantasy illustration: completely REMOVE the closest foreground character(s)/figure(s) " +
  "(the people, warriors or dwarves nearest the camera) and any object they hold. Seamlessly reconstruct and paint " +
  "the environment — architecture, cavern, stone, landscape, smoke and atmosphere — that would be BEHIND them, " +
  "continuing the existing brushwork, palette, god-rays, depth and perspective. Keep distant background creatures or " +
  "structures. The result must look like the SAME painting with the foreground figures gone — a clean environment. " +
  "16:9, absolutely NO text.";

async function inpaint(i) {
  if (existsSync(rd(`bg_${i}.png`))) { console.error(`bg_${i} cached`); return; }
  const img = await readFile(rd(`scene_${i}.png`));
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${KEY}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ inlineData: { mimeType: "image/png", data: img.toString("base64") } }, { text: PROMPT }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "2K" } },
    }),
    signal: AbortSignal.timeout(180000),
  });
  const j = await res.json();
  const p = (j?.candidates?.[0]?.content?.parts ?? []).find((x) => x?.inlineData?.data);
  if (!p) { console.error(`bg_${i} NO IMAGE:`, JSON.stringify(j?.error || j).slice(0, 200)); return; }
  await writeFile(rd(`bg_${i}.png`), Buffer.from(p.inlineData.data, "base64"));
  console.error(`bg_${i} ✓`);
}

await Promise.all([1, 2, 3].map(inpaint));
console.log("DONE inpaint all");
