import assert from "node:assert/strict";

import {
  produceAndCritique,
  validateCritiqueResponse,
} from "@/engine/critiqueLoop";
import { createModuleCritiqueScope } from "@/lib/moduleCritiqueEvidence";

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

  const scope = createModuleCritiqueScope();
  const accepted = await scope.run(() => produceAndCritique({
    label: "script:hook",
    maxIters: 2,
    threshold: 0.8,
    produce: async (_issues, iter) => ({ iter }),
    critique: async (_candidate, iter) => iter === 1
      ? { score: 0.61, pass: false, issues: ["sharpen opening", "ground claim"] }
      : { score: 0.86, pass: true, issues: [] },
  }));
  assert.equal(accepted.accepted, true);
  assert.deepEqual(scope.snapshot(), [{
    label: "script:hook",
    scores: [0.61, 0.86],
    passes: [false, true],
    fatalIterations: [false, false],
    issueCounts: [2, 0],
    accepted: true,
    fatal: false,
    completed: true,
  }]);

  const rejectedScope = createModuleCritiqueScope();
  const bestEffort = await rejectedScope.run(() => produceAndCritique({
    label: "script:below-bar",
    maxIters: 1,
    threshold: 0.8,
    produce: async () => "candidate",
    critique: async () => ({ score: 0.67, pass: false, issues: ["weak payoff"] }),
  }));
  assert.equal(bestEffort.accepted, false);
  assert.deepEqual(rejectedScope.snapshot(), [{
    label: "script:below-bar",
    scores: [0.67],
    passes: [false],
    fatalIterations: [false],
    issueCounts: [1],
    accepted: false,
    fatal: false,
    completed: true,
  }], "a returned best-effort candidate must remain distinct from an accepted gate");

  const failedScope = createModuleCritiqueScope();
  await assert.rejects(() => failedScope.run(() => produceAndCritique({
    label: "script:malformed",
    maxIters: 1,
    produce: async () => "candidate",
    critique: async () => ({ score: Number.NaN, pass: true, issues: [] } as never),
  })));
  assert.deepEqual(failedScope.snapshot(), [{
    label: "script:malformed",
    scores: [],
    passes: [],
    fatalIterations: [],
    issueCounts: [],
    accepted: false,
    fatal: false,
    completed: false,
  }], "failed/untrusted critique attempts remain visible in the module receipt");

  console.log("CRITIQUE LOOP ADMISSION PASS — malformed verdicts fail closed and gate evidence is retained");
}

void main();
