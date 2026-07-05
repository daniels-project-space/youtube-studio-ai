// Test: can Nano Banana (gemini-3-pro-image-preview) remove the foreground figure and
// paint a clean background plate behind it? This is the enabler for true pop-up parallax.
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";

const RUN = join(process.cwd(), "output", "lorecraft", "moria");
const rd = (f) => join(RUN, f);
await bootstrapSecrets(() => {}, { required: ["GEMINI_API_KEY"] });
const KEY = process.env.GEMINI_API_KEY;

const img = await readFile(rd("scene_0.png"));
const prompt =
  "Edit this painterly fantasy illustration: completely REMOVE the armored dwarf figure and his glowing lantern " +
  "from the right foreground. Reconstruct and paint the vast cavernous hall, pillars, arches and misty depth that " +
  "would be BEHIND him, seamlessly continuing the existing brushwork, palette, god-rays and perspective. The result " +
  "must look like the same painting with NO figure present — a clean empty hall. Keep the left side identical. 16:9, NO text.";

const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${KEY}`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({
    contents: [{ parts: [{ inlineData: { mimeType: "image/png", data: img.toString("base64") } }, { text: prompt }] }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "2K" } },
  }),
  signal: AbortSignal.timeout(180000),
});
const j = await res.json();
const p = (j?.candidates?.[0]?.content?.parts ?? []).find((x) => x?.inlineData?.data);
if (!p) { console.error("NO IMAGE:", JSON.stringify(j?.error || j).slice(0, 300)); process.exit(1); }
await writeFile(rd("bg_0.png"), Buffer.from(p.inlineData.data, "base64"));
console.log("DONE bg_0.png");
