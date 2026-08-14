import assert from "node:assert/strict";
import {
  filterCriticAssertionsForQa,
  measurableValidationMetricsForFamily,
} from "@/engine/creative/crew";
import {
  assessProductionValidationAcceptance,
  runValidationSpec,
} from "@/engine/creative/validate";

async function rejectsAllSkippedRequiredAssertions(): Promise<void> {
  const outcome = await runValidationSpec(
    {
      assertions: [
        {
          id: "loop_seam",
          description: "The loop boundary is visually seamless.",
          check: "deterministic",
          metric: "loopSeamDiff",
          op: "<=",
          threshold: 0.12,
          severity: "block",
        },
      ],
    },
    { metrics: { durationSec: 60 } },
  );

  // The reusable executor preserves its draft-friendly semantics, but release
  // evidence must never turn this skipped block assertion into a story pass.
  assert.equal(outcome.passed, true);
  const acceptance = assessProductionValidationAcceptance(outcome);
  assert.equal(acceptance.ready, false);
  assert.equal(acceptance.evaluatedAssertionCount, 0);
  assert.ok(acceptance.blockers.some((blocker) => blocker.includes("loop_seam")));
}

async function acceptsMeasuredRequiredPass(): Promise<void> {
  const outcome = await runValidationSpec(
    {
      assertions: [
        {
          id: "duration_window",
          description: "The master is within the approved duration window.",
          check: "deterministic",
          metric: "durationSec",
          op: ">=",
          threshold: 45,
          severity: "block",
        },
      ],
    },
    { metrics: { durationSec: 60 } },
  );

  const acceptance = assessProductionValidationAcceptance(outcome);
  assert.equal(acceptance.ready, true);
  assert.equal(acceptance.evaluatedAssertionCount, 1);
}

function filtersMetricsToTheRealRendererContract(): void {
  assert.deepEqual(measurableValidationMetricsForFamily("music_loop"), ["durationSec", "loopSeamDiff"]);
  const filtered = filterCriticAssertionsForQa(
    [
      {
        id: "unmeasured_bed",
        description: "The music bed hits its target loudness.",
        check: "deterministic",
        metric: "bedLufs",
        op: ">=",
        threshold: -24,
        severity: "block",
      },
      {
        id: "loop_seam",
        description: "The loop boundary is visually seamless.",
        check: "deterministic",
        metric: "loopSeamDiff",
        op: "<=",
        threshold: 0.12,
        severity: "block",
      },
    ],
    "music_loop",
  );
  assert.deepEqual(filtered.map((assertion) => assertion.id), ["loop_seam"]);
}

async function main(): Promise<void> {
  await rejectsAllSkippedRequiredAssertions();
  await acceptsMeasuredRequiredPass();
  filtersMetricsToTheRealRendererContract();
  console.log("CRITIC VALIDATION EVIDENCE TEST PASSED");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
