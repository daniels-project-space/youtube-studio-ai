/**
 * A title written before this step competes; it never wins by precedence.
 *
 * Two titles exist before metacraft runs: the scheduled plan's, and the topic
 * bet's judge-linted `provisionalTitle`. Only the first was reaching the pool.
 * topic_select's own comment claims the bet's fields "are judged warm starts for
 * metacraft, banana and hookcraft downstream" — and none of the three read them,
 * so on the unscheduled path the bet title was written, judged, logged, and
 * thrown away.
 *
 * What must stay true of the fix, and why each matters:
 *
 *   competes, not overrides  the packaging step once shipped
 *                            `plannedTitle || craftedTitle`, so a title written
 *                            before the script existed beat one written after it
 *   labelled honestly        the CTR judge is shown `[frame] title`, so calling a
 *                            topic bet "planned" feeds it a false premise
 *   deduped                  the same string in the pool twice only crowds it
 *
 * Measured on the real bettor, metacraft and judge
 * (scripts/metacraft-bet-title-value.ts): the bet title won outright 1 of 7.
 * The "winner changed" count from that run is NOT evidence of anything — two
 * IDENTICAL control runs disagreed 7 of 7, because generation is at temperature
 * 0.8. Only the outright win is causal.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { warmStartCandidates } from "@/lib/metacraft";

const PLANNED = "The Lost Bells of Dunwich Still Ring Beneath Suffolk Waters";
const BET = "What Fishermen Actually Hear Under the Dunwich Waves";

/* ------------------------------ both present ------------------------------ */

const both = warmStartCandidates(PLANNED, BET);
assert.deepEqual(
  both,
  [{ frame: "planned", title: PLANNED }, { frame: "topic-bet", title: BET }],
  "both pre-written titles must enter the pool, each under its own frame",
);

/* ------------------------------ one present ------------------------------- */

assert.deepEqual(
  warmStartCandidates(PLANNED, undefined),
  [{ frame: "planned", title: PLANNED }],
  "a scheduled video with no bet title contributes only the plan's title",
);
assert.deepEqual(
  warmStartCandidates(undefined, BET),
  [{ frame: "topic-bet", title: BET }],
  "an UNSCHEDULED video must still contribute its bet title — this is the whole fix",
);
assert.deepEqual(warmStartCandidates(undefined, undefined), [], "nothing pre-written, nothing added");

/* -------------------------------- dedupe ---------------------------------- */

assert.deepEqual(
  warmStartCandidates(PLANNED, PLANNED),
  [{ frame: "planned", title: PLANNED }],
  "the same title from both sources must enter once, under the plan's frame",
);
assert.deepEqual(
  warmStartCandidates(`  ${PLANNED}  `, PLANNED),
  [{ frame: "planned", title: PLANNED }],
  "dedupe must survive surrounding whitespace",
);

/* ---------------------------- blank is absent ----------------------------- */

for (const blank of ["", "   ", "\n\t"]) {
  assert.deepEqual(
    warmStartCandidates(blank, blank),
    [],
    `a whitespace-only title (${JSON.stringify(blank)}) is not a candidate`,
  );
  assert.deepEqual(
    warmStartCandidates(blank, BET),
    [{ frame: "topic-bet", title: BET }],
    "a blank plan title must not suppress the bet title",
  );
}

/* --------------------- it must still only COMPETE ------------------------- */

// The candidates are lint-gated and then judge-ranked. If a future edit ever
// let a warm start bypass that, the old `plannedTitle || craftedTitle` failure
// returns — a title written before the script beating one written after it.
const source = readFileSync(join(process.cwd(), "src/lib/metacraft.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
assert.match(
  source,
  /const candidates = \[\s*\n\s*\.\.\.warmStartCandidates\(/,
  "warm starts must enter the SAME candidate array as the generated titles",
);
assert.match(
  source,
  /const survivors = candidates\.filter\(\(c\) => c\.lint\.pass\)/,
  "every candidate, warm starts included, must pass the same lint",
);
assert.ok(
  !/\ba\.warmStartTitle\s*\|\|/.test(source) && !/\ba\.betTitle\s*\|\|/.test(source),
  "no warm start may short-circuit the crafted result with ||",
);

console.log("METACRAFT WARM STARTS PASS — pre-written titles compete, labelled honestly, never override");
