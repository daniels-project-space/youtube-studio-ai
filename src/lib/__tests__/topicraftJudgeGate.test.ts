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
 * Production now fails closed after its bounded retry because the lint cannot
 * prove demand, freshness, fit, or packageability. An explicitly draft-only
 * preview may keep an `ungated` slate for inspection, never as a runnable
 * plan.
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

  // ---- production cannot ship an unjudged slate ---------------------------
  assert.match(
    topicraft,
    /topicQualityProfile\(a\)/,
    "the actual engine must resolve an explicit production/draft policy profile",
  );
  assert.match(
    topicraft,
    /quality === "production"/,
    "an unavailable Topicraft judge must follow the production refusal path",
  );
  assert.match(
    topicraft,
    /production refuses/,
    "production refusal must name its refusal rather than imply a passing gate",
  );
  assert.match(
    topicraft,
    /lint-only bet\(s\)/,
    "production refusal must identify the unscored candidate class",
  );
  assert.match(
    topicraft,
    /draft preview retains/,
    "only an explicit draft preview may retain the visible ungraded diagnostic",
  );
  assert.match(
    topicraft,
    /LINT-ONLY bet\(s\) with NO demand\/freshness\/fit\/packageability score/,
    "the retained draft diagnostic must make its missing quality evidence explicit",
  );

  // ---- the judge gets one deliberate retry --------------------------------
  assert.match(
    topicraft,
    /retryOnUnusableOutput\(/,
    "the judge must retry once on an unusable response before the next bounded slate attempt",
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
