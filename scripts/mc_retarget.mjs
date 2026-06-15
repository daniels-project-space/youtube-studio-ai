// Reliable face/mouth detection: vision returns a TIGHT face box per speaker + all
// faces. The mouth is DERIVED as the lower-centre of the face box (so it's always
// ON the face, never a held gun/hand), and the anchor is just ABOVE the face. The
// face boxes also feed the hard face-exclusion. Writes timeline.json.
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { geminiVisionLocal } from "@/lib/gemini";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

await bootstrapSecrets(() => {}, { required: ["GEMINI_API_KEY"] });
const RUN = process.argv[2];
const tl = JSON.parse(await readFile(join(RUN, "timeline.json"), "utf8"));
const plan = JSON.parse(await readFile(join(RUN, "plan.json"), "utf8"));
const chars = Object.fromEntries(plan.characters.map((c) => [c.id, c.name]));
const n01 = (v) => (v > 1.5 ? v / 1000 : v);
const clamp = (v) => Math.max(0, Math.min(1, v));

for (let i = 0; i < tl.panels.length; i++) {
  const pp = tl.panels[i];
  if (!pp.bubbles || !pp.bubbles.length) continue;
  const img = join(RUN, `panel_${i}.png`);
  if (!existsSync(img)) continue;
  const lines = plan.panels[i].lines.filter((l) => l.speaker !== "narrator");
  const names = [...new Set(lines.map((l) => chars[l.speaker] || l.speaker))];
  const prompt =
    `This is ONE comic panel. Speaking characters: ${names.join(", ")}.\n` +
    `Return STRICT JSON, ALL coords normalized 0..1:\n` +
    `{"speakers":[{"name":"<character>","face":[x,y,w,h]}], "faces":[[x,y,w,h], ...]}\n` +
    `"face" = a TIGHT box around JUST that character's face/head (forehead to chin). ` +
    `"faces" = a tight box around EVERY face/head visible in the panel. No prose.`;
  let j = {};
  try { j = JSON.parse((await geminiVisionLocal({ prompt, imagePaths: [img], json: true, maxTokens: 600 })).replace(/```json|```/g, "").trim()); }
  catch { console.error(`panel ${i} vision FAILED`); continue; }
  let bi = 0;
  for (const l of plan.panels[i].lines) {
    if (l.speaker === "narrator") continue;
    const nm = (chars[l.speaker] || l.speaker).toLowerCase();
    const sp = (j.speakers || []).find((p) => (p.name || "").toLowerCase().includes(nm.split(" ")[0]) || nm.includes((p.name || "").toLowerCase()));
    if (sp && sp.face && sp.face.length >= 4 && pp.bubbles[bi]) {
      const [fx, fy, fw, fh] = sp.face.map(n01);
      pp.bubbles[bi].mouth = [clamp(fx + fw / 2), clamp(fy + fh * 0.72)];   // lips ≈ lower-centre of face
      pp.bubbles[bi].anchor = [clamp(fx + fw / 2), clamp(fy - fh * 0.35)];  // bubble just above the head
    }
    bi++;
  }
  pp.avoid = (j.faces || []).filter((b) => b && b.length >= 4).map((b) => [n01(b[0]), n01(b[1]), n01(b[2]), n01(b[3])]);
  console.error(`panel ${i}: ${(j.speakers || []).length} speaker-faces, ${pp.avoid.length} faces`);
}
await writeFile(join(RUN, "timeline.json"), JSON.stringify(tl));
console.log("timeline retargeted (face-derived mouths)");
