import assert from "node:assert/strict";
import { localProofBroadFrameBudget } from "@/lib/localProofReviewBudget";

assert.equal(localProofBroadFrameBudget(3), 16, "short proofs retain the minimum broad sample");
assert.equal(
  localProofBroadFrameBudget(190.58),
  25,
  "a three-minute proof must receive enough frames to meet its rounded production gap cap",
);
assert.equal(
  localProofBroadFrameBudget(7_200),
  80,
  "a two-hour proof retains the production coverage requirement rather than silently dropping to a cheaper sample",
);
assert.equal(localProofBroadFrameBudget(Number.NaN), 16, "invalid duration cannot lower the minimum evidence budget");

console.log("local proof review budget: PASS");
