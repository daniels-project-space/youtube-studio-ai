import assert from "node:assert/strict";
import { validateTopicJudgeResponse } from "@/lib/topicraft";

const row = (idx: number, score = 8) => ({
  idx,
  demand: score,
  freshness: score,
  fit: score,
  packageability: score,
});

const valid = validateTopicJudgeResponse({ rankings: [row(0), row(1), row(2)] }, 3);
assert.equal(valid.pass, true);
assert.deepEqual(valid.rankings.map((ranking) => ranking.idx), [0, 1, 2]);

for (const [label, value] of [
  ["missing ranking", { rankings: [row(0), row(1)] }],
  ["duplicate index", { rankings: [row(0), row(0), row(2)] }],
  ["out of range index", { rankings: [row(0), row(1), row(3)] }],
  ["missing score", { rankings: [{ ...row(0), fit: undefined }, row(1), row(2)] }],
  ["non-finite score", { rankings: [{ ...row(0), demand: Number.NaN }, row(1), row(2)] }],
  ["score over ten", { rankings: [row(0), row(1), row(2, 11)] }],
] as const) {
  const result = validateTopicJudgeResponse(value, 3);
  assert.equal(result.pass, false, `${label} must fail the complete judge gate`);
  assert.equal(result.rankings.length, 0, `${label} must not leak partial rankings`);
  assert.ok(result.issues.length > 0, `${label} must explain why admission failed`);
}

console.log("topicraft judge admission passed: complete finite unique rankings only");
