import assert from "node:assert/strict";
import {
  buildDocuLabelReviewReceipt,
  docuLabelReviewPlanFingerprint,
  mergeModelUsageSummaries,
  reusableDocuLabelReviewReceipt,
  subtractModelUsageSummary,
} from "../documotionLabelReview";
import type { ModelUsageSummary } from "../modelUsage";

const emptyUsage = (): ModelUsageSummary => ({
  calls: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0,
  cachedInputTokens: 0, totalTokens: 0, costUsd: 0, unpricedCalls: 0, groups: [],
});
const before = emptyUsage();
const after: ModelUsageSummary = {
  calls: 1,
  cacheHits: 0,
  inputTokens: 800,
  outputTokens: 120,
  reasoningTokens: 20,
  cachedInputTokens: 0,
  totalTokens: 940,
  costUsd: 0.0012,
  unpricedCalls: 0,
  groups: [{
    provider: "openrouter",
    model: "google/gemini-3.7-flash",
    kind: "text",
    calls: 1,
    cacheHits: 0,
    inputTokens: 800,
    outputTokens: 120,
    reasoningTokens: 20,
    cachedInputTokens: 0,
    totalTokens: 940,
    costUsd: 0.0012,
    unpricedCalls: 0,
    unpricedReasons: [],
  }],
};
const inputPlan = { shots: [{ title: "THE TRASH", narration: "One mistake exposes the crew." }] };
const outputPlan = { shots: [{ title: "ONE MISTAKE", narration: "One mistake exposes the crew." }] };
const delta = subtractModelUsageSummary(after, before);
assert.deepEqual(delta, after);

const receipt = buildDocuLabelReviewReceipt({
  styleId: "detective_board",
  inputPlanFingerprint: docuLabelReviewPlanFingerprint(inputPlan),
  outputPlan,
  outcome: "reviewed",
  modelUsage: delta,
  completedAt: 123,
});
assert.deepEqual(reusableDocuLabelReviewReceipt({
  value: receipt,
  styleId: "detective_board",
  currentPlan: inputPlan,
}).outputPlan, outputPlan, "the exact pre-review plan must reuse the completed output");
assert.deepEqual(reusableDocuLabelReviewReceipt({
  value: receipt,
  styleId: "detective_board",
  currentPlan: outputPlan,
}).outputPlan, outputPlan, "the already-reviewed cached plan must not be reviewed again");
assert.equal(mergeModelUsageSummaries([emptyUsage(), receipt.modelUsage]).costUsd, 0.0012,
  "a reused review must carry its original exact cost into the child receipt");

assert.throws(() => reusableDocuLabelReviewReceipt({
  value: receipt,
  styleId: "archival_collage",
  currentPlan: inputPlan,
}), /style identity mismatch/);
assert.throws(() => reusableDocuLabelReviewReceipt({
  value: { ...receipt, outputPlan: inputPlan },
  styleId: "detective_board",
  currentPlan: inputPlan,
}), /output fingerprint mismatch/);
assert.throws(() => reusableDocuLabelReviewReceipt({
  value: receipt,
  styleId: "detective_board",
  currentPlan: { shots: [] },
}), /plan identity mismatch/);
assert.throws(() => reusableDocuLabelReviewReceipt({
  value: { ...receipt, modelUsage: { ...receipt.modelUsage, costUsd: 99 } },
  styleId: "detective_board",
  currentPlan: inputPlan,
}), /modelUsage\.costUsd does not match its groups/,
"a receipt cannot carry a fabricated top-level cost that disagrees with its exact provider groups");

console.log("DocuMotion durable label-review receipt tests passed");
