/**
 * An unjudged cold open must not wear the face of a perfect one.
 *
 * hookcraft's gate scores five axes — punch, specificity, curiosity, voiceMatch,
 * promise — plus an honesty boolean, and requires every axis to clear GATE.
 * passes() reads a missing axis as 10:
 *
 *   (v.punch ?? 10) >= GATE && ... && v.honest !== false
 *
 * which is reasonable for a judge that returned a verdict and omitted one axis.
 * It is not reasonable for a verdict that does not exist. When the judge call
 * fails, `verdicts` is empty, every candidate is scored as `{}`, and EVERY axis
 * defaults to 10 — so the gate admits everything while producing a record
 * indistinguishable from a candidate that scored full marks and was found
 * honest. That is the first fifteen seconds of the video, the single highest-
 * leverage retention surface, passing on a fabricated perfect score.
 *
 * Production now fails closed after its bounded retry: local lint cannot prove
 * retention, voice match, or honesty. Only an explicit draft preview may
 * retain an unjudged candidate for inspection, marked `judged: false`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isEmptyVerdict } from "@/lib/hookcraft";

const SOURCE = readFileSync(join(process.cwd(), "src/lib/hookcraft.ts"), "utf8");
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function main(): void {
  // ---- the distinction the gate could not previously make -----------------
  assert.equal(
    isEmptyVerdict({}),
    true,
    "a verdict with no axes at all is what an unreachable judge leaves behind",
  );
  // A judge that scored everything is not empty, however good the scores.
  assert.equal(
    isEmptyVerdict({ punch: 10, specificity: 10, curiosity: 10, voiceMatch: 10, promise: 10, honest: true }),
    false,
    "full marks from a judge that ran must not be confused with the judge not running",
  );
  // Neither is a partial verdict — one axis is enough to prove the judge saw it.
  assert.equal(isEmptyVerdict({ punch: 9 }), false, "a partial verdict still came from a judge");
  assert.equal(isEmptyVerdict({ honest: false }), false, "an honesty finding alone is still a verdict");
  assert.equal(isEmptyVerdict({ punch: 0 }), false, "a zero is a score, not an absence");

  // ---- production cannot ship an unjudged cold open -----------------------
  assert.match(CODE, /hookQualityProfile\(a\)/, "the engine must resolve an explicit production/draft profile");
  assert.match(CODE, /quality === "production"/, "a known judge failure must take the production refusal path");
  assert.match(CODE, /production refuses/, "production refusal must name its missing judge evidence");
  assert.match(CODE, /lint-only cold open\(s\)/, "production refusal must identify the unscored candidate class");

  // ---- draft marker must reach the caller ---------------------------------
  assert.match(
    CODE,
    /judged: judgeRan && !isEmptyVerdict\(v\)/,
    "the crafted hook must carry whether it was actually judged",
  );
  assert.match(
    CODE,
    /judged: boolean;/,
    "and `judged` must be part of the declared verdict type, not an untyped extra",
  );
  // Both halves matter: the judge call failing, AND this candidate having no
  // verdict even though the call succeeded.
  assert.match(CODE, /let judgeRan = true;/, "the judge-ran flag must default to true and be cleared on failure");
  assert.match(CODE, /judgeRan = false;/, "an explicit draft judge failure must clear it");

  // ---- the failure must name itself ---------------------------------------
  assert.match(
    SOURCE,
    /hookcraft: JUDGE FAILED/,
    "an unreachable cold-open judge must be logged as a failure",
  );
  assert.match(
    SOURCE,
    /draft preview retains a lint-only cold open/,
    "the draft log must say it is diagnostic rather than a passed production gate",
  );
  assert.ok(
    !/judge unreachable \(\$\{e instanceof Error \? e\.message : e\}\) — lint-only pass/.test(CODE),
    "'lint-only pass' must not make an unscored hook read as a routine production downgrade",
  );

  // ---- the gate itself is unchanged ---------------------------------------
  // This availability repair must not weaken or secretly adjust the existing
  // judge threshold.
  assert.match(
    CODE,
    /\(v\.punch \?\? 10\) >= GATE &&/,
    "the scoring rule must be untouched — only the reporting changed",
  );
  assert.match(CODE, /v\.honest !== false/, "the honesty rule must be untouched too");

  console.log("HOOKCRAFT JUDGE GATE PASS — production refuses an unjudged cold open; draft remains explicit");
}

main();
