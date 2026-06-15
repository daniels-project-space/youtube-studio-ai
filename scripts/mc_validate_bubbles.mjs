// Vision validator: Gemini LOOKS at each placed speech bubble and scores it like a
// comic letterer would. Usage: node mc_validate_bubbles.mjs <cropdir>
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { geminiVisionLocal } from "@/lib/gemini";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

await bootstrapSecrets(() => {}, { required: ["GEMINI_API_KEY"] });
const dir = process.argv[2];
const crops = JSON.parse(await readFile(join(dir, "crops.json"), "utf8"));
const prompt =
  `This is ONE comic-book panel that MAY contain a speech bubble. If there is NO speech bubble, return {"bubble":false}.\n` +
  `If there IS a bubble, judge its placement as a professional comic letterer and return STRICT JSON:\n` +
  `{"bubble":true,"clear":N,"tail":N,"proximity":N,"legible":N,"issue":"<=10 words or 'none'"}\n` +
  `clear = 1-10 (10 = covers NO face and NO important object). tail = 1-10 (10 = the tail clearly points at the ` +
  `speaking character's mouth). proximity = 1-10 (10 = bubble sits right by the speaker, short tail). legible = 1-10. No prose.`;

let withB = 0, sumC = 0, sumT = 0, sumP = 0, sumL = 0;
for (const c of crops) {
  let j = {};
  try { j = JSON.parse((await geminiVisionLocal({ prompt, imagePaths: [join(dir, c.file)], json: true, maxTokens: 300 })).replace(/```json|```/g, "").trim()); }
  catch { /* skip */ }
  if (j.bubble) {
    withB++; sumC += j.clear || 0; sumT += j.tail || 0; sumP += j.proximity || 0; sumL += j.legible || 0;
    console.log(`panel ${c.pi}.${c.li}:  clear=${j.clear}  tail=${j.tail}  proximity=${j.proximity}  legible=${j.legible}` + (j.issue && j.issue !== "none" ? `   — ${j.issue}` : ""));
  }
}
if (withB) console.log(`\nVISION AVG over ${withB} bubbles:  clear=${(sumC / withB).toFixed(1)}  tail=${(sumT / withB).toFixed(1)}  proximity=${(sumP / withB).toFixed(1)}  legible=${(sumL / withB).toFixed(1)}  (10 = best)`);
else console.log("no bubbles detected");
