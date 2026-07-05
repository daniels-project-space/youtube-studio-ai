import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(() => {}, { required: ["GEMINI_API_KEY"] });
const GK = process.env.GEMINI_API_KEY;
const RUN = join(process.cwd(), "output", "loreshort", "starwars");
const rd = (f) => join(RUN, f);
const STYLE = "epic cinematic concept-art ILLUSTRATION, dramatic chiaroscuro lighting, highly detailed, vast awe-inspiring scale, deep shadows with selective warm and cold light, painterly sci-fi grandeur, original universe. 16:9, fills the frame, NO text, no letters, no borders.";
// de-branded (no trademarked names / no gore) rewrites of the four refused beats
const V = {
  3: "A chaotic smoke-filled desert battlefield at dusk. In the foreground, scattered broken war-machines and shattered armor; in the deep background, two vast armies of soldiers and towering walkers clash beneath a blood-red sky, distant explosions lighting the haze.",
  5: "A dense bioluminescent alien jungle glowing blue at night. In the foreground, an abandoned brown warrior-monk robe hangs on a twisted branch; deep in the misty background, shadowy ranks of armored soldiers advance between giant trees.",
  6: "An ancient colossal stone temple engulfed in flame and smoke. In the foreground, a great shattered heroic statue lies broken in smoking rubble; the towering burning temple looms behind beneath a black sky, embers rising.",
  9: "A sleek obsidian corridor of a dark star-empire, filled with drifting steam and shadow. In the foreground, the glossy black helmeted mask of a towering armored dark warlord catches a thin sliver of red light; the long hall recedes into darkness behind.",
};
for (const i of [3, 5, 6, 9]) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${GK}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: `${STYLE}\nSCENE: ${V[i]}` }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "2K" } } }), signal: AbortSignal.timeout(180000) });
  const j = await res.json();
  const p = (j?.candidates?.[0]?.content?.parts ?? []).find((x) => x?.inlineData?.data);
  if (!p) { console.log(`scene ${i} STILL FAIL ${JSON.stringify(j?.candidates?.[0]?.finishReason || j?.error || "").slice(0, 80)}`); continue; }
  await writeFile(rd(`scene_${i}.png`), Buffer.from(p.inlineData.data, "base64"));
  console.log(`scene ${i} OK`);
}
