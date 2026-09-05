/**
 * The Qwen quality receipt must not be manufacturable.
 *
 * Production admission needs QWEN3_TTS_QUALITY_RECEIPT_SHA256, and
 * docs/QWEN3_TTS_QUALIFICATION.md says the hash "must come from a reviewed
 * benchmark of the exact worker/model revision". Nothing implemented that
 * benchmark, so the only way to satisfy the gate was to invent a hash — exactly
 * what the gate exists to prevent. scripts/qwen-tts-qualify.ts now performs it.
 *
 * What this pins is the set of properties that stop the script becoming a
 * rubber stamp:
 *
 *   - a failed measurement suppresses the receipt, and an UNMEASURED axis counts
 *     as a failure, because "we could not check" must never read as "it is fine";
 *   - the human verdict is a required input with no default, since the doc asks
 *     for a register/performance verdict and no number replaces listening;
 *   - the hash covers the measurements AND the verdicts, so editing either after
 *     the fact invalidates the receipt the runtime checks;
 *   - instruction following is judged as a RELATION between two takes (calm vs
 *     energetic pace), which a single take cannot fake.
 *
 * The measurement helper itself was validated against real speech before being
 * wired in: an exact reference scored WER 0.0, one wrong word in twenty scored
 * 0.05, and a missing file returned a structured error instead of crashing.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(process.cwd(), "scripts/qwen-tts-qualify.ts"), "utf8");
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const PY = readFileSync(join(process.cwd(), "scripts/qwen_take_measure.py"), "utf8");

function main(): void {
  // ---- unmeasured is a failure, not a pass --------------------------------
  assert.match(CODE, /if \(m\.wer === null\) failures\.push/, "an unmeasured WER must fail");
  assert.match(CODE, /if \(m\.lufs === null\) failures\.push/, "unmeasured loudness must fail");
  assert.match(CODE, /if \(m\.truePeakDbtp === null\) failures\.push/, "an unmeasured peak must fail");
  assert.match(CODE, /if \(!receipt\) failures\.push/, "a missing worker runtime receipt must fail");

  // ---- any failure suppresses the receipt ---------------------------------
  const failAt = CODE.indexOf("if (allFailures.length) {");
  const verdictAt = CODE.indexOf("if (missingVerdicts.length) {");
  const hashAt = CODE.indexOf('createHash("sha256").update(JSON.stringify(report))');
  assert.ok(failAt > 0 && verdictAt > 0 && hashAt > 0, "all three stages must exist");
  assert.ok(failAt < hashAt, "measured failures must be checked before any receipt is produced");
  assert.ok(verdictAt < hashAt, "missing human verdicts must be checked before any receipt is produced");

  // ---- the human verdict has no default -----------------------------------
  assert.match(
    CODE,
    /const missingVerdicts = measured\.filter\(\(m\) => !verdicts\[m\.take\.id\]\?\.trim\(\)\)/,
    "a take with no recorded verdict must block the receipt",
  );
  assert.ok(
    !/humanVerdict: verdicts\[m\.take\.id\] \?\? "(pass|ok|approved)"/.test(CODE),
    "the verdict must never default to an approval",
  );

  // ---- the hash covers what it claims to ----------------------------------
  assert.match(
    CODE,
    /humanVerdict: verdicts\[m\.take\.id\] \?\? null,/,
    "verdicts must be part of the hashed report, or they could be edited afterwards",
  );
  assert.match(CODE, /failures: m\.failures,/, "measured failures must be part of the hashed report too");

  // ---- instruction following is relational --------------------------------
  assert.match(
    CODE,
    /const separation = \(energetic\.wordsPerSec - calm\.wordsPerSec\)/,
    "pace separation between two takes is the only honest test of instruction following",
  );
  assert.match(
    CODE,
    /relational\.push\(\s*\n?\s*`the calm and energetic instructions produced only/,
    "insufficient separation must be recorded as a failure",
  );
  assert.match(
    CODE,
    /did not both synthesise, so instruction following is unproven/,
    "a missing half of the pair must be unproven, never assumed to pass",
  );

  // ---- the measurer treats an absent reading as absent --------------------
  assert.match(PY, /"wer": round\(wer, 4\) if wer is not None else None/, "an unmeasurable WER must be null");
  assert.match(PY, /return None, None/, "an unmeasurable loudness must be null, never 0");

  console.log("QWEN QUALIFICATION RECEIPT PASS — the receipt cannot be rubber-stamped");
}

main();
