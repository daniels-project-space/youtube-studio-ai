// Motion-comic probe 2: CHARACTER-CONSISTENT comic panels via image-to-image.
// Make a character ref, then render 2 different panels feeding that ref back in.
// Proves Nano Banana keeps one character across scenes (the core of a motion comic).
import { writeFileSync } from "node:fs";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(() => {}, { required: ["GEMINI_API_KEY"] });
const key = process.env.GEMINI_API_KEY;

async function gen(parts, out) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${key}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "2K" } } }),
    signal: AbortSignal.timeout(180_000),
  });
  const j = await res.json();
  const p = (j?.candidates?.[0]?.content?.parts ?? []).find((x) => x?.inlineData?.data);
  if (p) { const b = Buffer.from(p.inlineData.data, "base64"); writeFileSync(out, b); console.log("OK  ", out); return b.toString("base64"); }
  console.log("FAIL", out, JSON.stringify(j?.error || j).slice(0, 160)); return null;
}

const STYLE = "bold graphic-novel ink line-art, heavy blacks, dramatic cel shading, gritty noir palette (teal shadows, amber highlights), cinematic comic-book composition";

// 1. character reference sheet
const ref = await gen([{ text:
  `Character reference sheet, ${STYLE}. A grizzled 1940s private detective: trench coat, fedora, square stubbled jaw, tired eyes, scar over left brow. Full body, neutral standing pose, plain light-grey background. A clean, consistent design meant to be reused across many comic panels.` }],
  "/tmp/mc_char.png");

// 2. panel A (wide, env-heavy) reusing the ref
await gen([
  { text: `A COMIC PANEL, ${STYLE}, 16:9. KEEP THIS CHARACTER IDENTICAL to the reference image (same face, coat, hat, scar). Wide establishing shot: the detective stands alone under a flickering streetlight in a rain-soaked noir alley at night, collar up, neon sign reflected in puddles, looking off-panel. Lots of atmosphere.` },
  { inlineData: { mimeType: "image/png", data: ref } },
], "/tmp/mc_panelA.png");

// 3. panel B (close-up, different scene) reusing the ref
await gen([
  { text: `A COMIC PANEL, ${STYLE}, 16:9. KEEP THIS CHARACTER IDENTICAL to the reference image (same face, coat, hat, scar). Dramatic close-up: the same detective lights a cigarette in a dim office, smoke curling, hard venetian-blind shadows striping his face, rain on the window behind.` },
  { inlineData: { mimeType: "image/png", data: ref } },
], "/tmp/mc_panelB.png");

console.log("DONE — compare /tmp/mc_char.png vs panelA vs panelB for character consistency");
