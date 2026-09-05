/**
 * A safety scan must not be blind to exactly what it exists to catch.
 *
 * Both compliance model calls ran at maxTokens 200 on a reasoning route, where
 * the output budget has to cover the thinking AND the JSON. That interacts with
 * the CONTENT of the verdict in the worst possible way:
 *
 *   a clean verdict is cheap  {"violation":false,"category":"","reason":"none"}
 *   a flagged verdict is not  the model must decide WHICH policy applies and
 *                             write a reason justifying it
 *
 * so the ceiling sat between the two. Measured on the shipping route, two
 * attempts each, with 6000 characters of narration:
 *
 *   benign historical narration   @200  -> 2/2 succeeded, violation=false
 *   clearly violating narration   @200  -> 0/2, the call threw both times
 *                                 @800  -> 2/2 succeeded, violation=true
 *                                 @1500 -> 2/2 succeeded, violation=true
 *
 * A thrown call lands in a catch that logs and continues. So the advertiser-
 * safety scan of spoken narration worked whenever there was nothing to find and
 * failed whenever there was something to find — and reported the second case as
 * "skipped (non-fatal)".
 *
 * The sensitive-topic classifier has the same shape: `sensitive` and
 * `depictsRealPeopleRealistically` both default to false, so a parse failure
 * means the hard gate (sensitive && synthRealistic) cannot fire and no
 * synthetic-content disclosure note is produced.
 *
 * Both still fail OPEN — a provider outage must not block every publish — but a
 * safety scan that did not run must say so in those words, not as a routine
 * skip. That is what this test pins, alongside the measured ceiling.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(process.cwd(), "src/trigger/blocks/complianceBlocks.ts"), "utf8");
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Measured safe for a verdict that has to justify itself. */
const SAFETY_SCAN_FLOOR = 800;

function main(): void {
  const ceilings = Array.from(CODE.matchAll(/maxTokens:\s*([0-9_]+)/g)).map((m) =>
    Number(m[1].replace(/_/g, "")),
  );
  assert.ok(ceilings.length >= 2, "both compliance model calls must still be present");
  const tooLow = ceilings.filter((c) => c < SAFETY_SCAN_FLOOR);
  assert.deepEqual(
    tooLow,
    [],
    `a compliance scan is running at ${tooLow.join(", ")} tokens. Measured: at 200 the ` +
      `advertiser-safety scan returned a clean verdict 2/2 on benign narration and THREW 2/2 on ` +
      `clearly violating narration, because only the flagged verdict has to justify itself. ` +
      `A safety gate must not be cheapest exactly when it should fire.`,
  );

  // Both scans get one deliberate retry before giving up. Safety is worth a
  // second billed call.
  assert.equal(
    (CODE.match(/retryOnUnusableOutput\(/g) ?? []).length,
    2,
    "both compliance scans must retry once on an unusable response",
  );

  // A scan that did not run must be reported as that, not as a routine skip.
  // "non-fatal" reads like nothing happened; something did — the check is
  // missing from this video.
  assert.match(
    SOURCE,
    /SPOKEN-LINE SAFETY SCAN DID NOT RUN/,
    "a skipped advertiser-safety scan must name itself as a scan that did not run",
  );
  assert.match(
    SOURCE,
    /CLASSIFIER DID NOT RUN/,
    "a skipped sensitive-topic classification must name itself too",
  );
  assert.ok(
    !/scan skipped \(non-fatal\)/.test(CODE),
    "the old wording made a missing safety check read as routine",
  );

  // The real violation path must still be fatal. Raising a ceiling must not
  // have softened the gate it feeds.
  assert.match(
    CODE,
    /spoken-line compliance FAILED/,
    "a detected violation must still throw",
  );
  assert.match(
    CODE,
    /if \(e instanceof Error && e\.message\.startsWith\("spoken-line compliance FAILED"\)\) throw e;/,
    "a detected violation must propagate through the catch, never be swallowed with the parse errors",
  );
  assert.match(
    CODE,
    /compliance_check FAILED: sensitive topic \+ realistic synthetic depiction/,
    "the sensitive + synthetic hard gate must still refuse to auto-publish",
  );

  console.log("COMPLIANCE SCAN CEILINGS PASS — the safety scans can afford to say why");
}

main();
