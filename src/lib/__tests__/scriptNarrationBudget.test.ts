import assert from "node:assert/strict";
import { effectiveScriptWordsPerSecond, scriptSpeechRate } from "../scriptNarrationBudget";
import { evaluateNarrationRate } from "../narrationPerformance";

assert.equal(scriptSpeechRate({}), 2.15);
assert.equal(scriptSpeechRate({ qualityProfile: "draft" }), 3.1);
assert.equal(scriptSpeechRate({ override: "2.3" }), 2.3);
assert.throws(() => scriptSpeechRate({ override: "3.1" }), /outside.*contract/);
for (const override of ["bad", "0", "-1", "Infinity"]) assert.throws(() => scriptSpeechRate({ override }), /finite positive/);
for (const speed of [0.85, 1, 1.15]) {
  const gapSec = 0.85;
  const effective = effectiveScriptWordsPerSecond({ speed, gapSec });
  const speechSeconds = 1 / (2.15 * speed);
  assert.ok(Math.abs(1 / effective - (speechSeconds + gapSec / 14)) < 1e-12);
  assert.equal(evaluateNarrationRate({ wordCount: 1000, durationSec: 1000 * speechSeconds, speed }).ok, true);
}
assert.throws(() => effectiveScriptWordsPerSecond({ speed: 1.3 }), /finite/);
assert.throws(() => effectiveScriptWordsPerSecond({ gapSec: Infinity }), /gap/);
console.log("Production script budget matches the unchanged narration rate gate");
