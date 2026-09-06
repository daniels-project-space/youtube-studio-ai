/**
 * Is a single-field JSON contract really cheap on a reasoning route?
 *
 * scripts/audit-json-contract-ceilings.ts sizes a call's floor from the SHAPE of
 * its declared output: a single field gets a floor of 0, justified by one
 * measurement — agentJson answered "2+2" inside 100 tokens.
 *
 * That measurement is about the ANSWER. On this route reasoning is mandatory,
 * is billed as completion tokens, and is spent out of max_tokens BEFORE any
 * answer exists — so what the ceiling has to cover is the thinking the TASK
 * provokes, not the bytes the schema declares. "2+2" provokes almost none.
 * "Write ONE scroll-stopping hook line for this video, concrete, promising only
 * what the narration delivers" is a creative judgement over 2000 characters of
 * narration, and returns a single string.
 *
 * hook_craft runs exactly that call at maxTokens: 200, and the audit exempts it
 * on shape. This measures whether the exemption is sound, by running the REAL
 * prompt at a ladder of ceilings and reporting how often a usable hook comes
 * back. If it fails low, the audit's floor model is wrong for creative
 * single-field calls and the exemption has been hiding starved calls.
 *
 * Failure here is not silent in production: hook_craft falls back to
 * `firstLine()`, the narration's opening line — which its OWN deterministic
 * critique then rejects as "just the narration's opening line echoed back". So
 * a starved hook call costs a wasted critique cycle and ships a hook the block
 * itself considers invalid.
 *
 * Usage:
 *   ai-vault openrouter OPENROUTER_API_KEY=OPENROUTER_API_KEY -- \
 *     ./node_modules/.bin/tsx scripts/measure-single-field-ceiling.ts
 */
import { claudeJson } from "@/lib/anthropic";

/** Real narration, long enough that the hook must actually be read out of it. */
const NARRATION = [
  "In 1971, a man in a dark suit boarded a Boeing 727 in Portland and paid cash for a one-way ticket.",
  "He gave his name as Dan Cooper. Nobody has ever proved it was his.",
  "Somewhere over the forests of southwest Washington he opened the aft airstair and stepped into the rain.",
  "He had two hundred thousand dollars strapped to his chest and no confirmed name.",
  "The FBI worked the case for forty-five years and closed it without an answer.",
  "What they did find, nine years later, was a rotting bundle of twenty-dollar bills on a riverbank.",
  "The serial numbers matched. The money had travelled eleven miles from where the plane should have passed.",
  "That single detail broke every theory the investigators had built.",
  "Because if the money landed there, the man did not — and if the man landed where they thought, the money could not.",
  "This is the story of a case that was solved in every direction except the one that mattered.",
].join(" ");

const PROMPT =
  "Write ONE scroll-stopping hook line for this video (for the title/thumbnail). " +
  "It must be concrete and must promise ONLY something this narration actually " +
  "delivers — a hook the video does not pay off is a failure, not a win. " +
  'Return STRICT JSON {"hook": string}. No markdown.\n\n' +
  NARRATION;

const CEILINGS = [200, 400, 700, 1200, 2500];
const TRIALS = 3;

async function main(): Promise<void> {
  console.log("=== single-field creative contract vs ceiling ===");
  console.log(`prompt: hook_craft's real one. ${TRIALS} trials per ceiling.\n`);
  const rows: Array<{ ceiling: number; ok: number; samples: string[] }> = [];

  for (const ceiling of CEILINGS) {
    let ok = 0;
    const samples: string[] = [];
    for (let trial = 0; trial < TRIALS; trial++) {
      try {
        const out = await claudeJson<{ hook?: string }>({
          prompt: PROMPT,
          maxTokens: ceiling,
          temperature: 0.9,
        });
        const hook = typeof out.hook === "string" ? out.hook.trim() : "";
        if (hook) { ok++; samples.push(hook); }
      } catch (e) {
        samples.push(`THREW: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`);
      }
    }
    rows.push({ ceiling, ok, samples });
    console.log(`  ${String(ceiling).padStart(4)}  ${ok}/${TRIALS} usable   ${samples[0]?.slice(0, 76) ?? "-"}`);
  }

  const firstGood = rows.find((r) => r.ok === TRIALS);
  console.log(
    `\nlowest ceiling that produced a hook on every trial: ${firstGood ? firstGood.ceiling : "none of the tested ceilings"}`,
  );
  console.log(
    `\nIf 200 did not clear this, the audit's single-field floor of 0 is wrong for\n` +
      `CREATIVE single-field calls: what the ceiling must cover is the reasoning the\n` +
      `task provokes, not the size of the value it returns. "2+2" is a single field\n` +
      `too, and that is the measurement the floor was built on.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
