/**
 * Does geminiJson starve the way the OpenRouter route does?
 *
 * scripts/audit-json-contract-ceilings.ts excludes geminiJson on purpose, and
 * says why: "it targets gemini-2.5-flash directly and parses loosely, which is a
 * different failure profile that has not been measured here. Reporting it would
 * be guessing." That exemption covers 24 live calls, two of which run at 200 and
 * one at 500 with a LIST contract — the same shape and the same ceilings that
 * turned out to have been silently failing on the other route.
 *
 * Not guessing is right; leaving it unmeasured forever is not. This measures it,
 * on the two shapes that matter, using the real helper.
 *
 * The difference that might make gemini safe: gemini-2.5-flash is reached
 * directly rather than through OpenRouter, and reasoning is not mandatory there,
 * so the ceiling may cover only the answer. If that holds, low ceilings are fine
 * and the exemption becomes a MEASURED exemption rather than an assumed one. If
 * it does not hold, three live calls are starved.
 *
 * Usage:
 *   ai-vault gemini GEMINI_API_KEY=GEMINI_API_KEY -- \
 *     ./node_modules/.bin/tsx scripts/measure-gemini-ceiling.ts
 */
import { geminiJson, hasGeminiKey } from "@/lib/gemini";

/** A LIST contract, the shape footagecraft runs at 500. */
const LIST_PROMPT =
  `A narrated video about "the 1971 skyjacking that was never solved" (unsolved cases). ` +
  `Give 8 CONCRETE, filmable, VISUALLY DISTINCT stock-footage search queries (2-4 words each, ` +
  `things a camera can literally show) whose MOOD, SUBJECT and MOVEMENT match a cold, ` +
  `procedural, evidence-led narration — not generic decorative b-roll. ` +
  `Return STRICT JSON {"queries":string[]}.`;

/** A single creative field, the shape that failed at 200 on the other route. */
const SINGLE_PROMPT =
  `Write ONE scroll-stopping hook line (for a title/thumbnail) for a video about the 1971 ` +
  `skyjacking that was never solved. Concrete, honest, no clickbait. ` +
  `Return STRICT JSON {"hook":string}.`;

const CEILINGS = [200, 500, 1000, 2500];
const TRIALS = 3;

async function run(label: string, prompt: string, ok: (value: unknown) => boolean): Promise<void> {
  console.log(`\n${label}`);
  for (const ceiling of CEILINGS) {
    let good = 0;
    let sample = "";
    for (let trial = 0; trial < TRIALS; trial++) {
      try {
        const out = await geminiJson<Record<string, unknown>>({ prompt, maxTokens: ceiling, temperature: 0.7 });
        if (ok(out)) { good++; sample ||= JSON.stringify(out).slice(0, 70); }
        else sample ||= `EMPTY/SHAPE-MISS: ${JSON.stringify(out).slice(0, 60)}`;
      } catch (e) {
        sample ||= `THREW: ${(e instanceof Error ? e.message : String(e)).slice(0, 60)}`;
      }
    }
    console.log(`  ${String(ceiling).padStart(4)}  ${good}/${TRIALS}  ${sample}`);
  }
}

async function main(): Promise<void> {
  if (!hasGeminiKey()) {
    console.log("GEMINI_API_KEY not injected — cannot measure. This is the one thing that must not be guessed.");
    return;
  }
  console.log("=== geminiJson vs ceiling ===");
  await run(
    'LIST  {"queries":string[]}   (footagecraft runs this shape at 500)',
    LIST_PROMPT,
    (v) => Array.isArray((v as { queries?: unknown }).queries) && ((v as { queries: unknown[] }).queries.length >= 4),
  );
  await run(
    'SINGLE {"hook":string}       (the shape that returned nothing at 200 on OpenRouter)',
    SINGLE_PROMPT,
    (v) => typeof (v as { hook?: unknown }).hook === "string" && String((v as { hook: string }).hook).trim().length > 0,
  );
  console.log(
    `\nIf gemini clears its low ceilings where OpenRouter did not, the audit's\n` +
      `exemption is sound and becomes a MEASURED one. If it does not, three live\n` +
      `calls (two at 200, one at 500 on a list) have been failing the same way\n` +
      `hook_craft was.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
