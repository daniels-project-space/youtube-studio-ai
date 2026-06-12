// GATE for ANY thumbnail before it reaches the operator: the same 5-dimension
// critique the pipeline uses. Usage: npx tsx scripts/judge-thumb.mjs <file...>
import { geminiVisionLocal, parseJsonLoose } from "../src/lib/gemini.ts";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";

await bootstrapSecrets(() => {}, { required: ["GEMINI_API_KEY"] });

for (const f of process.argv.slice(2)) {
  const raw = await geminiVisionLocal({
    prompt:
      `THUMBNAIL QUALITY GATE. Judge: 1. has real visual content (not a blank/plain card)? ` +
      `2. text complete+readable at 120px AND every word correctly spelled (garbled/invented words = fail)? ` +
      `3. punch 1-10 (scroll-stopping)? 4. craft 1-10 (professional design)? ` +
      `5. uiClean: true ONLY if NO fake play buttons, video-player icons, progress bars or other baked-in ` +
      `UI chrome appear in the artwork (spam anti-pattern). ` +
      `6. verdict: SHIP or REJECT (reject anything below punch 6 or craft 6, blank, or uiClean=false). ` +
      `Return STRICT JSON {"hasContent":bool,"textOk":bool,"punch":n,"craft":n,"uiClean":bool,"verdict":"SHIP"|"REJECT","why":"<=20 words"}.`,
    imagePaths: [f],
    json: true,
    maxTokens: 200,
  });
  const v = parseJsonLoose(raw);
  console.log(`${f}: ${v.verdict} — punch ${v.punch}/10 craft ${v.craft}/10 — ${v.why}`);
}
