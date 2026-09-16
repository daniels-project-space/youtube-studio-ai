import assert from "node:assert/strict";
import {
  buildAutomaticProviderPlan,
  buildWeeklyOperationsDigest,
  capacityEta,
  createAutomaticQualityGateContract,
  createAutomaticReleaseRollbackPlan,
  nextProviderCircuitState,
  previousUtcWeekWindow,
} from "@/lib/automaticOperations";

const plan = buildAutomaticProviderPlan({
  moduleIds: ["thumbnail_gen", "script_gen", "minimax_h3_video"],
  circuits: { "salad-h3": { status: "open", consecutiveFailures: 3 } },
});
assert.equal(plan.modules.find((module) => module.moduleId === "minimax_h3_video")?.primary, "novita-h3");
assert.equal(plan.modules.find((module) => module.moduleId === "thumbnail_gen")?.primary, "fal-nano-banana");
assert.match(plan.fingerprint, /^[a-f0-9]{64}$/);

const blockedImage = buildAutomaticProviderPlan({
  moduleIds: ["image_gen"],
  circuits: {
    "salad-ernie": { status: "open", consecutiveFailures: 3 },
    "novita-image": { status: "open", consecutiveFailures: 3 },
  },
});
assert.equal(blockedImage.modules[0]?.primary, null, "all-open routes must be visibly blocked");
assert.deepEqual(blockedImage.modules[0]?.fallbacks, []);
assert.deepEqual(blockedImage.blockedModules, ["image_gen"]);

const narration = buildAutomaticProviderPlan({ moduleIds: ["narration_tts", "script_gen", "metadata"] });
assert.deepEqual(narration.modules.find((module) => module.moduleId === "narration_tts")?.fallbacks, []);
assert.deepEqual(narration.modules.find((module) => module.moduleId === "script_gen")?.fallbacks, []);
assert.deepEqual(narration.modules.find((module) => module.moduleId === "metadata")?.fallbacks, ["local-deterministic"]);

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

const window = previousUtcWeekWindow(Date.UTC(2026, 8, 16, 12)); // Wednesday
assert.equal(new Date(window.weekStart).toISOString(), "2026-09-07T00:00:00.000Z");
assert.equal(new Date(window.weekEnd).toISOString(), "2026-09-13T23:59:59.999Z");

console.log("automatic operations contracts passed");
