// Prep the castle scene into clean parallax layers for a big zoom-out reveal:
//  - bg plate: grass + warrior removed → castle, open field, sky (Nano Banana inpaint)
// (cutouts for grass + warrior are made separately with make_cutout.py)
import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";

const RUN = join(process.cwd(), "output", "lorecraft", "castle");
const rd = (f) => join(RUN, f);
await bootstrapSecrets(() => {}, { required: ["GEMINI_API_KEY"] });
const KEY = process.env.GEMINI_API_KEY;

const PROMPT =
  "Edit this pen-and-ink engraving illustration: REMOVE the tall foreground grass/wheat AND the armoured warrior " +
  "completely. Paint the scene as an OPEN grassy field/hill rolling toward the vast pale CASTLE with its towers and " +
  "the soft overcast SKY — as if nothing stood in the foreground. Keep the exact same engraving linework, ivory/sepia " +
  "palette, haze and perspective. A clean empty landscape, full castle visible. 16:9, NO text.";

if (!existsSync(rd("bg.png"))) {
  const img = await readFile(rd("scene_c.png"));
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${KEY}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType: "image/png", data: img.toString("base64") } }, { text: PROMPT }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "2K" } } }),
    signal: AbortSignal.timeout(180000),
  });
  const j = await res.json();
  const p = (j?.candidates?.[0]?.content?.parts ?? []).find((x) => x?.inlineData?.data);
  if (!p) throw new Error("no image: " + JSON.stringify(j?.error || j).slice(0, 200));
  await writeFile(rd("bg.png"), Buffer.from(p.inlineData.data, "base64"));
}
console.log("DONE bg plate");
