// Regenerate each panel at its TILE's aspect ratio (from tile_aspects.json), with
// the character model-sheets as refs + a prompt that keeps every face fully inside
// the frame and leaves clean caption space. Overwrites panel_<i>.png.
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

await bootstrapSecrets(() => {}, { required: ["GEMINI_API_KEY"] });
const RUN = process.argv[2];
const amap = JSON.parse(await readFile(join(RUN, "tile_aspects.json"), "utf8"));
const plan = JSON.parse(await readFile(join(RUN, "plan.json"), "utf8"));
const key = process.env.GEMINI_API_KEY;
const chars = Object.fromEntries(plan.characters.map((c) => [c.id, c.name]));
const STYLE =
  "cinematic graphic-novel / comic-book art: bold confident ink line-art with strong black outlines, dramatic cel shading, " +
  "rich but moody colour, expressive faces, dynamic compositions, film-grain texture. ABSOLUTELY NO speech bubbles, NO " +
  "captions, NO lettering, NO text of any kind anywhere in the image.";

async function gen(parts, ratio) {
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${key}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: ratio, imageSize: "2K" } } }),
        signal: AbortSignal.timeout(180000),
      });
      const j = await res.json();
      const p = (j?.candidates?.[0]?.content?.parts ?? []).find((x) => x?.inlineData?.data);
      if (p) return Buffer.from(p.inlineData.data, "base64");
      console.error("  no image:", JSON.stringify(j?.error || j).slice(0, 120));
    } catch (e) { console.error("  err", e.message); }
    await new Promise((r) => setTimeout(r, 2000 * (a + 1)));
  }
  return null;
}

for (let i = 0; i < plan.panels.length; i++) {
  const p = plan.panels[i]; const ratio = amap[String(i)] || "4:3";
  const refs = [], names = [];
  for (const cid of (p.characters || [])) {
    const f = join(RUN, `char_${cid}.png`);
    if (existsSync(f)) { refs.push((await readFile(f)).toString("base64")); names.push(chars[cid] || cid); }
  }
  const keep = refs.length ? ` KEEP the character(s) (${names.join(", ")}) IDENTICAL to the reference model-sheet(s): same face, hair, wardrobe, marks.` : "";
  const prompt =
    `A single ${(p.shot || "medium").toUpperCase()} COMIC PANEL, ${STYLE} Composed for a ${ratio} frame — fill the whole ${ratio} frame.${keep} ` +
    `CRITICAL: keep EVERY face and head FULLY INSIDE the frame — never cropped by the top, bottom or side edges. ` +
    `Leave some clean, UNCLUTTERED negative space (open sky, a plain wall, or empty ground) beside or above the main figure for a speech caption, and keep faces away from the extreme corners.\n` +
    `PANEL: ${p.scene}`;
  const parts = [{ text: prompt }, ...refs.map((r) => ({ inlineData: { mimeType: "image/png", data: r } }))];
  const buf = await gen(parts, ratio);
  if (buf) { await writeFile(join(RUN, `panel_${i}.png`), buf); console.error(`panel ${i} regen ${ratio} ✓`); }
  else console.error(`panel ${i} regen FAILED (kept old)`);
}
console.log("regen done");
