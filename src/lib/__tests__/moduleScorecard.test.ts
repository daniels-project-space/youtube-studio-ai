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
  critiqueEvidence: [{
    label: "script:hook",
    scores: [0.61, 0.86],
    passes: [false, true],
    fatalIterations: [false, false],
    issueCounts: [2, 0],
    accepted: true,
    fatal: false,
    completed: true,
  }],
  triggerRuns: null,
  triggerWaits: null,
  convexReads: null,
  convexWrites: null,
  convexActions: null,
  estimatedCostUsd: 0.0123,
  capturedAt: 1_700_000_000_000,
};

const scorecard = createModuleScorecard(base);
assert.equal(scorecard.version, MODULE_SCORECARD_VERSION);
assert.match(scorecard.fingerprint, /^[0-9a-f]{64}$/);
assert.deepEqual(assertModuleScorecard(scorecard), scorecard);

const tampered = { ...scorecard, outputTokens: scorecard.outputTokens! + 1 };
assert.throws(() => assertModuleScorecard(tampered), /fingerprint mismatch/);
assert.throws(
  () => createModuleScorecard({ ...base, status: "failed", outputValid: true }),
  /cannot claim valid output/,
);
assert.throws(
  () => createModuleScorecard({ ...base, status: "passed", outputValid: false }),
  /cannot claim invalid output/,
);

const current = createModuleScorecard({
  ...base,
  wallTimeMs: 90,
  providerCalls: 1,
  inputTokens: 50,
  outputTokens: 20,
  critiqueEvidence: [{
    ...base.critiqueEvidence[0]!,
    scores: [0.61, 0.9],
  }],
  estimatedCostUsd: 0.01,
  capturedAt: base.capturedAt + 1,
});
assert.deepEqual(compareModuleScorecards(scorecard, current), {
  moduleId: "title_module",
  oracleScoreDelta: null,
  falsePassesDelta: null,
  falseRejectsDelta: null,
  wallTimeMs: -30,
  providerCalls: -1,
  inputTokens: -30,
  outputTokens: -10,
  critiqueEvidenceChanged: true,
  triggerRuns: null,
  triggerWaits: null,
  convexReads: null,
  convexWrites: null,
  convexActions: null,
  estimatedCostUsd: -0.0023,
  outputValidityChanged: false,
});
const unknownProviderUsage = createModuleScorecard({
  ...base,
  providerCalls: null,
  inputTokens: null,
  outputTokens: null,
});
assert.deepEqual(
  [unknownProviderUsage.providerCalls, unknownProviderUsage.inputTokens, unknownProviderUsage.outputTokens],
  [null, null, null],
  "unobserved child usage must not be represented as zero",
);
const unknownUsageDelta = compareModuleScorecards(scorecard, unknownProviderUsage);
assert.deepEqual(
  [unknownUsageDelta.providerCalls, unknownUsageDelta.inputTokens, unknownUsageDelta.outputTokens],
  [null, null, null],
  "a usage delta is unknown if either scorecard lacks complete usage evidence",
);
const unknownRemoteEvidence = createModuleScorecard({ ...base, critiqueEvidence: null });
assert.equal(
  compareModuleScorecards(scorecard, unknownRemoteEvidence).critiqueEvidenceChanged,
  null,
  "a missing child receipt is unknown, not evidence that critique behavior changed",
);
assert.throws(
  () => createModuleScorecard({
    ...base,
    critiqueEvidence: [{
      label: "bad-pass",
      scores: [0.4],
      passes: [false],
      fatalIterations: [false],
      issueCounts: [1],
      accepted: true,
      fatal: false,
      completed: true,
    }],
  }),
  /critique outcome is invalid/,
);
const measuredDelta = compareModuleScorecards(
  createModuleScorecard({
    ...base,
    oracleScore: 7.2,
    falsePasses: 3,
    falseRejects: 2,
    triggerRuns: 2,
    triggerWaits: 3,
    convexReads: 8,
    convexWrites: 1,
    convexActions: 1,
  }),
  createModuleScorecard({
    ...base,
    oracleScore: 8.1,
    falsePasses: 1,
    falseRejects: 4,
    triggerRuns: 3,
    triggerWaits: 5,
    convexReads: 13,
    convexWrites: 2,
    convexActions: 3,
  }),
);
assert.deepEqual(
  [measuredDelta.oracleScoreDelta, measuredDelta.falsePassesDelta, measuredDelta.falseRejectsDelta],
  [0.9, -2, 2],
  "independent quality-oracle changes must remain visible in module deltas",
);
assert.deepEqual(
  [measuredDelta.triggerRuns, measuredDelta.triggerWaits, measuredDelta.convexReads, measuredDelta.convexWrites, measuredDelta.convexActions],
  [1, 2, 5, 1, 2],
  "measured Trigger/Convex consumption must remain visible in module deltas",
);
assert.throws(
  () => compareModuleScorecards(scorecard, createModuleScorecard({ ...base, moduleId: "script_module" })),
  /same module/,
);

console.log("module scorecard tests passed");
