// NANO BANANA PRO trial: one rich design brief -> one render -> judge gate.
// The elegance test: can a single design-native model replace the whole
// instantiate/stage/fallback machine? 3 channel briefs, 16:9.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";

await bootstrapSecrets(() => {}, { required: ["GEMINI_API_KEY"] });
const KEY = process.env.GEMINI_API_KEY;
const MODELS = ["gemini-3-pro-image-preview", "gemini-2.5-flash-image"];

const RULES =
  "Rules: 1280x720 YouTube thumbnail. The hero fills 55-75% of the frame, aggressively cropped. " +
  "Typography is HUGE (owns 25-40% of the frame), ultra-bold, rendered as a designed physical object " +
  "(plate, smear, strip or sticker), with one PAYOFF word 2-4x larger than the rest. " +
  "HARD RULE: text NEVER covers the hero's face or eyes - place it beside, above or across the body only. " +
  "Spelling EXACTLY as quoted. Everything must read at 120px on a phone. " +
  "No play buttons, no UI, no watermarks, no extra small text.";

const JOBS = [
  {
    out: "banana_stoic.jpg",
    prompt:
      `${RULES} Channel "MARBLE MIND" (stoic philosophy, cinematic marble statues in a black void, palette black/marble-white/gold #d4a017). ` +
      `Scene: an elder marble statue lays a steadying hand on the shoulder of a younger statue whose chest is cracking with glowing golden fissures - stoic comfort, anxiety being steadied. ` +
      `Headline: "CALM" (gold, the payoff word, huge) and "IS POWER" (marble white) - placed clear of both faces. ` +
      `Small badge pill "MARBLE MIND" in a corner away from the text.`,
  },
  {
    out: "banana_rich.jpg",
    prompt:
      `${RULES} Channel "GILDED LIES" (billionaire exposé, gritty photographic tabloid composite, real photo grain, palette black/gold #e3b341/alarm-red). ` +
      `Scene: a smiling billionaire in glasses and a dark knit sweater as a die-cut photo cutout pasted over a collage of torn newspaper clippings and a crashing red stock line - magazine composite, NOT a smooth AI scene. ` +
      `Headline: the single lowercase word "evil." in a distressed white-on-black sticker box, huge, beside his head (never over the face). ` +
      `Small badge pill "GILDED LIES" in a corner away from the text.`,
  },
  {
    out: "banana_samurai.jpg",
    prompt:
      `${RULES} Channel "STEEL & SILK" (samurai history, bold sumi-e ink wash on textured washi paper, palette paper-white/ink-black/crimson #c1272d). ` +
      `Scene: a lone samurai silhouette on a hill watching Kyoto burn - pagoda skyline in ink wash consumed by crimson flames, giant red sun disc, ink splatter. ` +
      `Headline: "KYOTO" (huge, the payoff word) above "BURNS" (smaller), heavy white capitals with hard black outline, in the sky area clear of the samurai. ` +
      `Small badge pill "STEEL & SILK" in a corner away from the text.`,
  },
];

for (const j of JOBS) {
  let done = false;
  for (const model of MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: j.prompt }] }],
            generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9" } },
          }),
          signal: AbortSignal.timeout(180_000),
        },
      );
      const json = await res.json();
      if (!res.ok) { console.log(`${j.out} via ${model}: HTTP ${res.status} ${JSON.stringify(json.error?.message ?? "").slice(0, 160)}`); continue; }
      const part = (json.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData?.data);
      if (!part) { console.log(`${j.out} via ${model}: no image part`); continue; }
      await writeFile(join(tmpdir(), j.out), Buffer.from(part.inlineData.data, "base64"));
      console.log(`OK ${j.out} (${model})`);
      done = true;
      break;
    } catch (e) {
      console.log(`${j.out} via ${model}: ${e.message}`);
    }
  }
  if (!done) console.log(`FAIL ${j.out}`);
}
