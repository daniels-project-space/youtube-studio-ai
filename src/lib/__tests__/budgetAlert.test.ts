import assert from "node:assert/strict";
import { evaluateBudgetAlert } from "@/lib/budgetAlert";

// No budget ceiling configured (channels.budget <= 0) → nothing to alert
// against; the ship stage should stay silent.
{
  const result = evaluateBudgetAlert({ costUsd: 5, budgetUsd: 0 });
  assert.equal(result, null, "zero budget must not produce an alert result");
}
{
  const result = evaluateBudgetAlert({ costUsd: 5, budgetUsd: -1 });
  assert.equal(result, null, "negative budget must not produce an alert result");
}

// Comfortably under the default 80% threshold → no alert.
{
  const result = evaluateBudgetAlert({ costUsd: 4, budgetUsd: 10 });
  assert.ok(result, "well-under-budget run must still return a result");
  assert.equal(result!.shouldAlert, false);
  assert.equal(result!.percentUsed, 40);
}

// Exactly at the default 80% threshold → alert fires (>=, not >).
{
  const result = evaluateBudgetAlert({ costUsd: 8, budgetUsd: 10 });
  assert.ok(result);
  assert.equal(result!.shouldAlert, true);
  assert.equal(result!.percentUsed, 80);
  assert.match(result!.message, /\$8\.00/);
  assert.match(result!.message, /\$10\.00/);
  assert.match(result!.message, /80%/);
  assert.match(result!.message, /near ceiling/);
}

// Just under the threshold → no alert (boundary check the other direction).
{
  const result = evaluateBudgetAlert({ costUsd: 7.9, budgetUsd: 10 });
  assert.ok(result);
  assert.equal(result!.shouldAlert, false);
}

// Spend at/over the ceiling itself is unreachable in production (runPipeline
// throws first), but the predicate must still classify it correctly as a
// defensive second rail — and label it "exceeded" rather than "near".
{
  const result = evaluateBudgetAlert({ costUsd: 12, budgetUsd: 10 });
  assert.ok(result);
  assert.equal(result!.shouldAlert, true);
  assert.equal(result!.percentUsed, 120);
  assert.match(result!.message, /exceeded ceiling/);
}

// Custom threshold ratio is respected.
{
  const result = evaluateBudgetAlert({ costUsd: 6, budgetUsd: 10, thresholdRatio: 0.5 });
  assert.ok(result);
  assert.equal(result!.shouldAlert, true);
  assert.equal(result!.percentUsed, 60);
}

console.log("budgetAlert.test.ts: all assertions passed");
