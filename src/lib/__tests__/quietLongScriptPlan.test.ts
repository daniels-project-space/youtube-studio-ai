import assert from "node:assert/strict";
import { planQuietLongScript } from "../quietLongScriptPlan";
import { planNarrationCadence } from "../narrationPerformance";

for (const options of [{}, { gapSec: 0.85, speed: 0.9 }]) {
  const plan = planQuietLongScript({ targetSeconds: 28_800, ...options });
  assert.equal(plan.restSeconds, 2880);
  assert.equal(plan.spokenSeconds, 25_920);
  assert.equal(plan.minimumRestBoundaries, 96);
  assert.ok(plan.sectionCount >= 97);
  assert.equal(plan.sectionWordTargets.reduce((a, b) => a + b, 0), plan.wordBudget);
  assert.ok(plan.sectionWordTargets.every(n => n > 0 && n <= 400));
  assert.equal(plan.executionAuthorized, false);
  const sentences = plan.sectionWordTargets.map((_, index) => `Synthetic section ${index + 1}.`);
  const cadence = planNarrationCadence({ sentences, baseGapSec: 0.85, jitterSec: 0, sectionBoundaryAfter: sentences.map((_, i) => i < sentences.length - 1), profile: "quiet_listening", maxQuietRestBudgetSec: plan.restSeconds });
  const rests = cadence.gapsSec.filter((_, i) => cadence.purposes[i] === "section");
  assert.ok(rests.length >= 96);
  assert.ok(rests.every(gap => gap >= 15 && gap <= 30));
  assert.equal(Number(rests.reduce((a, b) => a + b, 0).toFixed(3)), 2880);
}
assert.throws(() => planQuietLongScript({ targetSeconds: 86_401 }), /duration/);
console.log("Eight-hour quiet plan preserves exact word and rest budgets with bounded sections");
