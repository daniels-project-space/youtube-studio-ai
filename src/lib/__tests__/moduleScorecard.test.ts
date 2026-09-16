import assert from "node:assert/strict";
import {
  assertModuleScorecard,
  compareModuleScorecards,
  createModuleScorecard,
  MODULE_SCORECARD_VERSION,
} from "@/lib/moduleScorecard";

const base = {
  runId: "run-scorecard-test",
  moduleId: "title_module",
  status: "passed" as const,
  outputValid: true,
  oracleScore: null,
  falsePasses: null,
  falseRejects: null,
  wallTimeMs: 120,
  providerCalls: 2,
  inputTokens: 80,
  outputTokens: 30,
  triggerRuns: null,
  triggerWaits: null,
  convexReads: null,
  convexWrites: null,
  estimatedCostUsd: 0.0123,
  capturedAt: 1_700_000_000_000,
};

const scorecard = createModuleScorecard(base);
assert.equal(scorecard.version, MODULE_SCORECARD_VERSION);
assert.match(scorecard.fingerprint, /^[0-9a-f]{64}$/);
assert.deepEqual(assertModuleScorecard(scorecard), scorecard);

const tampered = { ...scorecard, outputTokens: scorecard.outputTokens + 1 };
assert.throws(() => assertModuleScorecard(tampered), /fingerprint mismatch/);
assert.throws(
  () => createModuleScorecard({ ...base, status: "failed", outputValid: true }),
  /cannot claim valid output/,
);

const current = createModuleScorecard({
  ...base,
  wallTimeMs: 90,
  providerCalls: 1,
  inputTokens: 50,
  outputTokens: 20,
  estimatedCostUsd: 0.01,
  capturedAt: base.capturedAt + 1,
});
assert.deepEqual(compareModuleScorecards(scorecard, current), {
  moduleId: "title_module",
  wallTimeMs: -30,
  providerCalls: -1,
  inputTokens: -30,
  outputTokens: -10,
  estimatedCostUsd: -0.0023,
  outputValidityChanged: false,
});
assert.throws(
  () => compareModuleScorecards(scorecard, createModuleScorecard({ ...base, moduleId: "script_module" })),
  /same module/,
);

console.log("module scorecard tests passed");
