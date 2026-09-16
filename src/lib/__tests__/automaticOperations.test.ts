import assert from "node:assert/strict";
import {
  buildAutomaticProviderPlan,
  buildWeeklyOperationsDigest,
  capacityEta,
  createAutomaticQualityGateContract,
  createAutomaticReleaseRollbackPlan,
  nextProviderCircuitState,
} from "@/lib/automaticOperations";

const plan = buildAutomaticProviderPlan({
  moduleIds: ["thumbnail_gen", "script_gen", "minimax_h3_video"],
  circuits: { "salad-h3": { status: "open", consecutiveFailures: 3 } },
});
assert.equal(plan.modules.find((module) => module.moduleId === "minimax_h3_video")?.primary, "novita-h3");
assert.equal(plan.modules.find((module) => module.moduleId === "thumbnail_gen")?.primary, "fal-nano-banana");
assert.match(plan.fingerprint, /^[a-f0-9]{64}$/);

assert.deepEqual(capacityEta({ now: 100, requiredWorkers: 3, availableWorkers: 1, retryEveryMs: 900_000 }), {
  state: "waiting", nextCheckAt: 900_100,
});
assert.deepEqual(capacityEta({ now: 100, requiredWorkers: 3, availableWorkers: 3, retryEveryMs: 900_000 }), {
  state: "ready", nextCheckAt: 100,
});
assert.equal(capacityEta({ now: 100, requiredWorkers: 3, availableWorkers: 0, retryEveryMs: 900_000, fallbackAfterMs: 0 }).state, "fallback_due");

const opened = nextProviderCircuitState({ now: 10, previous: { status: "closed", consecutiveFailures: 2 }, outcome: "failure" });
assert.equal(opened.status, "open");
assert.equal(nextProviderCircuitState({ now: 20, previous: opened, outcome: "success" }).status, "closed");

const quality = createAutomaticQualityGateContract();
assert.equal(quality.status, "measurement_required");
assert.match(quality.fingerprint, /^[a-f0-9]{64}$/);
assert.equal(createAutomaticReleaseRollbackPlan({ runId: "run-1" }).mode, "private-first-reversible");

const digest = buildWeeklyOperationsDigest({
  weekStart: 0,
  weekEnd: 7,
  runs: [
    { status: "ok", costTotal: 1.25 },
    { status: "failed", costTotal: 0.4, error: "Salad capacity unavailable" },
    { status: "running", costTotal: 0.1 },
  ],
});
assert.deepEqual(digest.runs, { total: 3, succeeded: 1, failed: 1, active: 1, spentUsd: 1.75 });
assert.deepEqual(digest.actionItems, ["Review 1 failed run", "Provider/capacity failures: 1", "1 run is still active"]);

console.log("automatic operations contracts passed");
