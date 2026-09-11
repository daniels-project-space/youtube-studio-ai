import assert from "node:assert/strict";

import {
  produceAndCritique,
  validateCritiqueResponse,
} from "@/engine/critiqueLoop";

const valid = validateCritiqueResponse({
  score: 0.84,
  pass: true,
  issues: ["  Keep the first beat concrete.  "],
  fatal: false,
});
assert.equal(valid.pass, true);
assert.deepEqual(valid.critique, {
  score: 0.84,
  pass: true,
  issues: ["Keep the first beat concrete."],
  fatal: false,
});

for (const invalid of [
  { score: Number.NaN, pass: true, issues: [] },
  { score: 1.1, pass: true, issues: [] },
  { score: 0.5, pass: "true", issues: [] },
  { score: 0.5, pass: false, issues: ["  "] },
  { score: 0.5, pass: false, issues: ["x".repeat(501)] },
  { score: 0.5, pass: false, issues: [], fatal: "no" },
  { score: 0.5, pass: false, issues: Array.from({ length: 33 }, () => "too many") },
  null,
]) {
  const admission = validateCritiqueResponse(invalid);
  assert.equal(admission.pass, false, `expected rejection for ${String(invalid)}`);
  assert.equal(admission.critique, null);
  assert.ok(admission.issues.length > 0);
}

async function main(): Promise<void> {
  let produced = 0;
  await assert.rejects(
    () => produceAndCritique({
      label: "admission-test",
      maxIters: 2,
      produce: async () => ({ id: ++produced }),
      // A malformed provider verdict must fail closed. It must not be converted
      // into a passing score or silently let a prior candidate ship.
      critique: async () => ({ score: Number.NaN, pass: true, issues: [] } as never),
    }),
    /admission-test: malformed critique response.*finite number from 0 to 1/,
  );
  assert.equal(produced, 1, "a malformed first verdict must stop before a second paid-capable attempt");

  console.log("CRITIQUE LOOP ADMISSION PASS — malformed shared verdicts fail closed");
}

void main();
