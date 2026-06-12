// NANO BANANA PRO - remaining six channel renders (Daniel-approved engine trial).
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
  "(plate, smear, strip, slab or sticker) made of the scene's material world, with one PAYOFF word 2-4x " +
  "larger than the rest. HARD RULE: text NEVER covers the hero's face or eyes - beside, above or across " +
  "the body only. Spelling EXACTLY as quoted. Everything must read at 120px on a phone. " +
  "No play buttons, no UI, no watermarks, no extra small text.";

const JOBS = [
  {
    out: "banana_hannibal.jpg",
    prompt:
      `${RULES} Channel "EMPIRES AT WAR" (ancient military history, epic classical oil painting, palette steel-blue snow / bronze / blood-red). ` +
      `Scene: Hannibal atop a towering war elephant cresting a snowy Alpine ridge in a blizzard, his army snaking into the valley below, storm light, bronze armor glinting. ` +
      `Headline: "ROME'S WORST" (white, heavy) above "NIGHTMARE" (the payoff word, huge, blood-red on a battle-worn banner plate). ` +
      `Small badge pill "EMPIRES AT WAR" in a corner away from the text.`,
  },
  {
    out: "banana_drawn.jpg",
    prompt:
      `${RULES} Channel "THE DRAWN PAST" (hand-drawn history explainers, sepia ink crosshatch sketch on warm paper-cream canvas, burnt-orange accent #c45a1d). ` +
      `Scene: dramatic crosshatch illustration of medieval townsfolk dancing uncontrollably in a town square, faces exhausted and frightened, an ink-stained artist's hand still sketching one figure. ` +
      `Headline: "FEVER" (the payoff word, huge, hand-lettered marker style in burnt-orange, underlined with a rough ink brush stroke) above "DANCE" (charcoal ink). ` +
      `Small hand-drawn stamp "THE DRAWN PAST" in a corner away from the text.`,
  },
  {
    out: "banana_pirates.jpg",
    prompt:
      `${RULES} Channel "THE LAST REEL" (film analysis, rich cinematic teal-and-gold, film grain, anamorphic glow). ` +
      `Scene: a cursed gold Aztec coin with a skull face HUGE in the foreground breaking a moonlit black-teal sea, a ghostly black-sailed pirate ship burning gold in the bokeh behind. ` +
      `Headline: "THE PERFECT" (clean white editorial caps) above "CURSE" (the payoff word, huge, in beveled movie-poster gold lettering sitting in the scene haze). ` +
      `Small badge pill "THE LAST REEL" in a corner away from the text.`,
  },
  {
    out: "banana_timeai.jpg",
    prompt:
      `${RULES} Channel "CHRONO UNIT 7" (an AI persona time-traveling through history, cinematic warm period tones pierced by one cyan tech accent #34e0e6). ` +
      `Scene: a sleek chrome android with glowing cyan seams standing in the Roman Forum among toga-clad crowds, golden dust light, a torn glowing time portal crackling behind it - the android LARGE in frame, chest-up crop. ` +
      `Headline: "THEY BUILT" (warm white) above "THIS" (the payoff word, huge, glowing cyan like the android's seams). ` +
      `Small badge pill "CHRONO UNIT 7" in a corner away from the text.`,
  },
  {
    out: "banana_aitakeover.jpg",
    prompt:
      `${RULES} Channel "THE TAKEOVER LOG" (an AI calmly narrating its world takeover, black with alarm-red #ff2b2b, brutal monumental scale). ` +
      `Scene: a colossal red machine eye opening across a dark data-center wall, thick cables coiling around a small glowing planet Earth, one tiny human silhouette looking up - dwarfed. ` +
      `Headline: "IT'S TOO" (white stencil) above "LATE" (the payoff word, huge, white stencil capitals on a solid alarm-red censor bar laid across the frame). ` +
      `Small badge pill "THE TAKEOVER LOG" in a corner away from the text.`,
  },
  {
    out: "banana_scandal.jpg",
    prompt:
      `${RULES} Channel "SPOTLIGHT ROT" (celebrity downfall commentary, gritty photographic tabloid composite, real photo grain, alarm-red accent). ` +
      `Scene: a beautiful distressed FICTIONAL actress (no real celebrity likeness) as a die-cut photo cutout, worried eyes to camera, pasted over a collage of torn tabloid strips reading "EXPOSED", "CAREER OVER" and "THE FALL" in different bold tabloid serifs, paparazzi flashes, red zigzag crash line. ` +
      `Headline: "SOLD" (the payoff word, huge, silver-white caps ON a rough red paint smear) above "FOR LIES" (black caps) - clear of her face. ` +
      `Small badge pill "SPOTLIGHT ROT" in a corner away from the text.`,
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
