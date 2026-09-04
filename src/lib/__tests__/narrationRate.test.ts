/**
 * Calibration for the delivery-rate gate, using REAL measurements rather than
 * invented numbers.
 *
 * Every figure below came from grading the studio's own narration corpus with
 * scripts/narration-oracle.py — three ElevenLabs takes that were accepted, and
 * three Qwen takes of the same scripts. A gate is only worth having if it
 * passes the work already approved and fails the work that is visibly off; a
 * threshold that rejects the reference is broken, not strict.
 */
import assert from "node:assert/strict";

import {
  NARRATION_BASE_WORDS_PER_SEC,
  NARRATION_RATE_TOLERANCE,
  evaluateNarrationRate,
} from "@/lib/narrationPerformance";

/** wpm -> a (wordCount, durationSec) pair the gate can consume. */
function atWpm(wpm: number, seconds = 60) {
  return { wordCount: Math.round((wpm / 60) * seconds), durationSec: seconds };
}

function main(): void {
  // ---- the approved reference must pass ---------------------------------
  // eleven-stoic 125 wpm · eleven-history 128 wpm · eleven-finance 136 wpm
  for (const wpm of [125, 128, 136]) {
    const verdict = evaluateNarrationRate({ ...atWpm(wpm), speed: 1 });
    assert.equal(verdict.ok, true, `approved reference at ${wpm} wpm must pass: ${verdict.detail}`);
  }

  // ---- the measured outliers must fail ----------------------------------
  // qwen-stoic came in at 98 wpm and qwen-finance at 158 wpm on the very same
  // scripts. Both passed the old 0.3x-2.5x sanity band without comment.
  const slow = evaluateNarrationRate({ ...atWpm(98), speed: 1 });
  assert.equal(slow.ok, false, "98 wpm against a ~129 wpm intent must fail");
  assert.match(slow.detail, /slower/, "the verdict must say which direction it missed");

  const fast = evaluateNarrationRate({ ...atWpm(158), speed: 1 });
  assert.equal(fast.ok, false, "158 wpm against a ~129 wpm intent must fail");
  assert.match(fast.detail, /faster/);

  // ---- the band is per channel, not absolute ----------------------------
  // A quiet mentor runs 0.95 and a chaos commentator 1.15. Judging both against
  // one absolute rate would mark a deliberately unhurried read as broken, the
  // same mistake as scoring every channel's CTR against one threshold.
  const unhurried = evaluateNarrationRate({ ...atWpm(118), speed: 0.95 });
  assert.equal(unhurried.ok, true, `118 wpm is correct FOR a quiet mentor: ${unhurried.detail}`);
  const brisk = evaluateNarrationRate({ ...atWpm(118), speed: 1.15 });
  assert.equal(brisk.ok, false, "the same 118 wpm is too slow for a chaos commentator");

  // ...and the reverse, so the direction of the correction is real.
  assert.equal(evaluateNarrationRate({ ...atWpm(148), speed: 1.15 }).ok, true);
  assert.equal(evaluateNarrationRate({ ...atWpm(148), speed: 0.95 }).ok, false);

  // ---- degenerate input is a failure, never a pass ----------------------
  // A zero-duration or empty narration must not sail through as "in band".
  assert.equal(evaluateNarrationRate({ wordCount: 0, durationSec: 30 }).ok, false);
  assert.equal(evaluateNarrationRate({ wordCount: 100, durationSec: 0 }).ok, false);
  assert.equal(evaluateNarrationRate({ wordCount: 100, durationSec: Number.NaN }).ok, false);

  // ---- the band itself stays honest -------------------------------------
  // If someone widens the tolerance far enough, the gate stops discriminating
  // and quietly becomes the sanity check it was written to replace.
  assert.ok(NARRATION_RATE_TOLERANCE <= 0.2, "a tolerance above 20% no longer separates the corpus");
  const boundary = evaluateNarrationRate({ ...atWpm(129), speed: 1 });
  assert.ok(
    Math.abs(boundary.intendedWordsPerSec - NARRATION_BASE_WORDS_PER_SEC) < 1e-9,
    "speed 1 must mean the base rate exactly",
  );

  console.log("NARRATION RATE PASS");
}

main();
