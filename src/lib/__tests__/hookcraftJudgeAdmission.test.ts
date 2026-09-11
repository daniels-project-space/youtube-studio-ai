import assert from "node:assert/strict";
import { validateHookJudgeResponse } from "@/lib/hookcraft";

const verdict = (score = 8) => ({
  punch: score,
  specificity: score,
  curiosity: score,
  voiceMatch: score,
  promise: score,
  honest: true,
  note: "Specific and promise-matched.",
});

const valid = validateHookJudgeResponse({ verdicts: [verdict(), verdict(9)] }, 2);
assert.equal(valid.pass, true);
assert.equal(valid.verdicts[1].promise, 9);

for (const [label, value] of [
  ["missing verdict", { verdicts: [verdict()] }],
  ["missing axis", { verdicts: [{ ...verdict(), promise: undefined }, verdict()] }],
  ["non-finite axis", { verdicts: [{ ...verdict(), punch: Number.NaN }, verdict()] }],
  ["score over ten", { verdicts: [verdict(11), verdict()] }],
  ["missing honesty", { verdicts: [{ ...verdict(), honest: undefined }, verdict()] }],
  ["oversized note", { verdicts: [{ ...verdict(), note: "x".repeat(241) }, verdict()] }],
] as const) {
  const result = validateHookJudgeResponse(value, 2);
  assert.equal(result.pass, false, `${label} must fail the complete hook gate`);
  assert.equal(result.verdicts.length, 0, `${label} must not leak partial verdicts`);
  assert.ok(result.issues.length > 0, `${label} must explain why admission failed`);
}

console.log("hookcraft judge admission passed: complete finite verdicts only");
