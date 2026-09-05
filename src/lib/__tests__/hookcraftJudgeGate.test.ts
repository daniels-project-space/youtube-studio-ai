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
 * The gate still fails open: the candidates have cleared a real deterministic
 * lint, and refusing to produce a cold open would fail the whole video. What
 * this pins is that the two cases are now distinguishable — `judged` travels
 * with the verdict, and the failure names itself in the log.
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

  // ---- the marker must reach the caller -----------------------------------
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
  assert.match(CODE, /judgeRan = false;/, "a judge failure must clear it");

  // ---- the failure must name itself ---------------------------------------
  assert.match(
    SOURCE,
    /hookcraft: JUDGE FAILED/,
    "an unreachable cold-open judge must be logged as a failure",
  );
  assert.match(
    SOURCE,
    /the cold open was NOT scored/,
    "the log must say what was skipped, not merely that something was skipped",
  );
  assert.ok(
    !/judge unreachable \(\$\{e instanceof Error \? e\.message : e\}\) — lint-only pass/.test(CODE),
    "'lint-only pass' made a fabricated perfect score read as a routine downgrade",
  );

  // ---- the gate itself is unchanged ---------------------------------------
  // This was a visibility fix. If it had also moved the threshold, hooks would
  // silently start passing or failing for unrelated reasons.
  assert.match(
    CODE,
    /\(v\.punch \?\? 10\) >= GATE &&/,
    "the scoring rule must be untouched — only the reporting changed",
  );
  assert.match(CODE, /v\.honest !== false/, "the honesty rule must be untouched too");

  console.log("HOOKCRAFT JUDGE GATE PASS — an unjudged cold open cannot pass as a perfect one");
}

main();
