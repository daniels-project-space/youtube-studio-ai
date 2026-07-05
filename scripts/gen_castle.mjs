// Generate a NEW scene replicating the GoT Histories-&-Lore 1-minute shot: a lone warrior
// before a castle, with TALL GRASS in the immediate FOREGROUND (a layer in FRONT of him).
// Strong, separable depth layers (grass → warrior → castle → sky) for a big zoom-out reveal.
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";

const RUN = join(process.cwd(), "output", "lorecraft", "castle");
await mkdir(RUN, { recursive: true });
const rd = (f) => join(RUN, f);
await bootstrapSecrets(() => {}, { required: ["GEMINI_API_KEY"] });
const KEY = process.env.GEMINI_API_KEY;

const PROMPT =
  "A Game of Thrones 'Histories & Lore' style illustration, hand-drawn pen-and-ink / engraving look with muted " +
  "ivory, gold and sepia tones and restrained selective colour. SCENE, composed in CLEAR SEPARATED DEPTH LAYERS: " +
  "(1) FOREGROUND — tall dark wind-blown GRASS and wheat blades rising close to the camera across the lower third, " +
  "slightly out of focus, clearly IN FRONT of everything; (2) MID-GROUND — a lone weary armoured WARRIOR seen from a " +
  "low angle, leaning both hands on a long greatsword planted point-down in the earth, standing among the grass; " +
  "(3) BACKGROUND — a vast pale medieval CASTLE and curtain wall with many towers and banners on a low hill; " +
  "(4) FAR — a soft overcast pale sky with drifting cloud. Strong atmospheric haze separating each layer for depth. " +
  "Epic, still, cinematic. 16:9. ABSOLUTELY NO text, NO words, NO letters.";

async function gen(out, prompt) {
  if (existsSync(out)) { console.error("cached", out); return; }
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${KEY}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "2K" } } }),
    signal: AbortSignal.timeout(180000),
  });
  const j = await res.json();
  const p = (j?.candidates?.[0]?.content?.parts ?? []).find((x) => x?.inlineData?.data);
  if (!p) throw new Error("no image: " + JSON.stringify(j?.error || j).slice(0, 200));
  await writeFile(out, Buffer.from(p.inlineData.data, "base64"));
  console.error("wrote", out);
}

await gen(rd("scene.png"), PROMPT);
console.log("DONE castle scene");
