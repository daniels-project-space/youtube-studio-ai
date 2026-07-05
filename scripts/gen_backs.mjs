// Fresh clean BACK layer per scene (empty of the foreground figures) so the multiplane back
// is crisp, not a smudge. Writes s{i}lay/back.png.
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
const ROOT = process.cwd();
const RUN = join(ROOT, "output", "lorecraft", "moria2");
await bootstrapSecrets(() => {}, { required: ["GEMINI_API_KEY"] });
const KEY = process.env.GEMINI_API_KEY;
const STYLE = "A detailed Game of Thrones Histories-and-Lore PEN-AND-INK ENGRAVING with crosshatching on ivory paper, sepia ink, filling the frame with rich detail. ";
const BACKS = {
  0: STYLE + "An EMPTY grand dwarven pillared hall of Khazad-dûm: rows of massive carved stone columns and arches receding into deep shadow, a wide stone walkway, glowing braziers, detailed throughout. NO figures, NO statues, NO people. 16:9, NO text.",
  1: STYLE + "A deep dwarven mithril MINE CAVERN FILLING the frame: dark carved rock walls and pillars, a brilliant glowing silver-white mithril vein in the stone, carved tunnel arches, a descending carved stone staircase, scaffolding, deep shadow. NO miners, NO people, NO figures. 16:9, NO text.",
  2: STYLE + "A COLOSSAL BALROG demon of black shadow veined with molten orange fire, great bat wings and horns, looming in a fiery abyss, filling the frame. NO dwarves, NO small figures, NO foreground objects. 16:9, NO text.",
  3: STYLE + "An EMPTY ruined hall of Moria: fallen carved columns, broken stone tombs, faint embers and drifting mist, deep shadow. NO king, NO dwarf, NO figures. 16:9, NO text.",
};
async function gen(i) {
  const dir = join(RUN, `s${i}lay`); await mkdir(dir, { recursive: true });
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${KEY}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: BACKS[i] }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "2K" } } }), signal: AbortSignal.timeout(180000) });
  const j = await res.json(); const p = (j?.candidates?.[0]?.content?.parts ?? []).find((x) => x?.inlineData?.data);
  if (!p) { console.error(i, "NOIMG", JSON.stringify(j?.error || j).slice(0, 140)); return; }
  await writeFile(join(dir, "back.png"), Buffer.from(p.inlineData.data, "base64")); console.error("back", i);
}
await Promise.all([0, 1, 2, 3].map(gen));
console.log("DONE backs");
