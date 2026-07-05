// Generate the 4 Khazad-dûm beats in the GoT Histories-&-Lore ENGRAVING style (matching the
// castle shot), each with a CLEAR FOREGROUND element in front + mid subject + deep background,
// so DepthFlow can do a big zoom-out reveal with a layer parallaxing IN FRONT.
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";

const RUN = join(process.cwd(), "output", "lorecraft", "moria2");
await mkdir(RUN, { recursive: true });
const rd = (f) => join(RUN, f);
await bootstrapSecrets(() => {}, { required: ["GEMINI_API_KEY"] });
const KEY = process.env.GEMINI_API_KEY;

const STYLE =
  "A Game of Thrones 'Histories & Lore' style illustration, hand-drawn pen-and-ink / engraving look with muted " +
  "ivory, gold and sepia tones and restrained selective colour, soft atmospheric haze that clearly SEPARATES depth " +
  "into a close FOREGROUND element, a mid-ground subject, and a deep receding background. Low cinematic angle, epic, " +
  "still. 16:9, fills the whole frame edge to edge. ABSOLUTELY NO text, NO words, NO decorative border.";

const SCENES = [
  // 0 — the carved kingdom under the mountain
  "FOREGROUND, close to the camera at the right edge: a towering intricately carved dwarven stone statue holding aloft " +
  "a glowing crystal lantern. MID-GROUND: a wide carved stone walkway. DEEP BACKGROUND: the immense cavernous pillared " +
  "hall of Khazad-dûm at its height, endless great columns and golden braziers receding into glowing haze.",
  // 1 — delving for mithril
  "FOREGROUND, close and low: jagged glittering broken rock and a heavy iron pickaxe. MID-GROUND: grimy armoured " +
  "dwarven miners striking a glowing vein of silver mithril. DEEP BACKGROUND: a vast mineshaft descending into black " +
  "depths, faint silver glimmers far below.",
  // 2 — waking Durin's Bane
  "FOREGROUND, close and low: a shattered dwarven pillar and a broken iron shield glowing orange with heat. MID-GROUND: " +
  "small dwarves recoiling in terror. DEEP BACKGROUND: a colossal towering Balrog of shadow and flame, Durin's Bane, " +
  "rising in a fiery abyss.",
  // 3 — the fall and the enduring line of Durin
  "FOREGROUND, close and low: broken dwarven runestones and creeping dry ferns over cold grey ash. MID-GROUND: a weary " +
  "but proud dwarven king in heavy tarnished armour gripping a warhammer, looking back over his shoulder. DEEP " +
  "BACKGROUND: the silent ruined gates and tombs of Moria fading into mist.",
];

async function gen(i) {
  const out = rd(`scene_${i}.png`);
  if (existsSync(out)) { console.error("cached", i); return; }
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${KEY}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: `${STYLE}\nSCENE: ${SCENES[i]}` }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "2K" } } }),
    signal: AbortSignal.timeout(180000),
  });
  const j = await res.json();
  const p = (j?.candidates?.[0]?.content?.parts ?? []).find((x) => x?.inlineData?.data);
  if (!p) { console.error(`scene ${i} NO IMAGE`, JSON.stringify(j?.error || j).slice(0, 160)); return; }
  await writeFile(out, Buffer.from(p.inlineData.data, "base64"));
  console.error("wrote", i);
}
await Promise.all([0, 1, 2, 3].map(gen));
console.log("DONE gen 4 scenes");
