/**
 * An unjudged topic slate must be impossible to mistake for a judged one.
 *
 * topicraft is upstream of every other module: its bets become the scripts, the
 * titles, the thumbnails and the uploads. Its quality gate scores each bet on
 * demand, freshness, fit and packageability and requires >= 7 on all four.
 *
 * That gate was failing open and silently. On a judge error the catch did
 * `gated = survivors`, admitting every lint-passing bet exactly as if it had
 * scored >= 7 on all four axes, and logging it as a "lint-only pass". Two things
 * made that invisible:
 *
 *   1. The judge ran at maxTokens 1500 on a reasoning route. Measured on a
 *      realistic 8-bet slate: 1500 failed the JSON contract 2 of 3 attempts,
 *      while 2500 and 4000 passed 3 of 3. So the gate was skipped on roughly
 *      two slates in three.
 *   2. `scores` is optional per bet and is read NOWHERE downstream — only in one
 *      log string inside topicraft itself. An ungated slate and a judged slate
 *      were identical to every consumer.
 *
 * It still fails open, deliberately: the bets have cleared a real deterministic
 * lint (cited evidence fuzzy-verified against the actual signals, banned words,
 * stale years, dedupe, title lint), and failing closed means a channel plans no
 * videos at all. What changed is that it can no longer be mistaken for a judged
 * slate — the result carries `ungated`, and both layers say so out loud.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { retryOnUnusableOutput } from "@/lib/anthropic";
import { OpenRouterGenerationOutcomeUnknownError } from "@/lib/openRouter";

const read = (p: string): string => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string): string =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

async function main(): Promise<void> {
  const topicraft = code("src/lib/topicraft.ts");

  // ---- the measured ceiling ----------------------------------------------
  const judgeCeiling = Number(
    /rankings\?[\s\S]{0,3000}?maxTokens:\s*([0-9_]+)/.exec(topicraft)?.[1]?.replace(/_/g, "") ?? "0",
  );
  assert.ok(judgeCeiling > 0, "the judge's token ceiling must be findable — has the call moved?");
  assert.ok(
    judgeCeiling >= 2500,
    `the topicraft judge runs at maxTokens ${judgeCeiling}; measured on a realistic 8-bet slate, ` +
      `1500 failed the JSON contract 2 of 3 attempts while 2500 passed 3 of 3. Below 2500 the ` +
      `quality gate is skipped more often than it runs.`,
  );

  // ---- the fail-open must be marked, not silent ---------------------------
  assert.match(
    topicraft,
    /ungatedByJudgeFailure = true;/,
    "a judge failure must set the flag that marks the slate as unjudged",
  );
  assert.match(
    topicraft,
    /ungated: true/,
    "the flag must reach the returned result, not just a local variable",
  );
  assert.match(
    topicraft,
    /JUDGE FAILED/,
    "a skipped quality gate must be logged as a failure, not as a 'lint-only pass'",
  );
  // Both exit paths return a slate, so both must carry the flag.
  assert.equal(
    (topicraft.match(/\.\.\.\(ungatedByJudgeFailure \? \{ ungated: true \} : \{\}\)/g) ?? []).length,
    2,
    "both return paths must carry the ungated flag — one unmarked exit is the whole bug again",
  );
  assert.match(
    code("src/lib/topicOptimizer.ts"),
    /optimizeTopics: this slate was NOT quality-gated/,
    "the caller must also surface an unjudged slate; a flag nobody reads is not a signal",
  );

  // ---- the judge gets one deliberate retry --------------------------------
  assert.match(
    topicraft,
    /retryOnUnusableOutput\(/,
    "the judge must retry once on an unusable response before falling open",
  );

  // ---- and that retry helper behaves -------------------------------------
  // Shared with the insert director, so its behaviour is asserted here too
  // rather than assumed from the other module's test.
  let calls = 0;
  const retried: string[] = [];
  const value = await retryOnUnusableOutput(async () => {
    calls++;
    if (calls === 1) {
      throw new OpenRouterGenerationOutcomeUnknownError("text failed the requested JSON contract", {
        status: 200,
        outcome: "consumed_unusable",
      });
    }
    return { rankings: [{ idx: 0 }] };
  }, () => retried.push("retried"));
  assert.equal(calls, 2, "an unusable response must be re-called exactly once");
  assert.deepEqual(value, { rankings: [{ idx: 0 }] });
  assert.deepEqual(retried, ["retried"], "the retry must notify its caller so it can be logged");

  // An ambiguous outcome must still propagate untouched — replaying it could
  // buy the same generation twice.
  calls = 0;
  await assert.rejects(
    () =>
      retryOnUnusableOutput(async () => {
        calls++;
        throw new OpenRouterGenerationOutcomeUnknownError("successful response contained no text", { status: 200 });
      }, () => retried.push("must not happen")),
    (e: unknown) => e instanceof OpenRouterGenerationOutcomeUnknownError && e.outcome === "unknown",
  );
  assert.equal(calls, 1, "an ambiguous outcome must not be replayed");

  console.log("TOPICRAFT JUDGE GATE PASS — an unjudged slate cannot pass as a judged one");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
