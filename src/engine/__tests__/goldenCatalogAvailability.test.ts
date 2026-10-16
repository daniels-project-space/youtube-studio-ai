import assert from "node:assert/strict";

import {
  catalogExecutionAvailability,
  catalogExecutionBinding,
} from "@/engine/goldenExecution";

function main(): void {
  const pipeline = catalogExecutionAvailability(catalogExecutionBinding("thumbnail"));
  assert.equal(pipeline.state, "composition-gated");
  assert.match(pipeline.detail, /does not grant automatic channel admission/i);

  const privateRelease = catalogExecutionAvailability(
    catalogExecutionBinding("quiz-short-private-release"),
  );
  assert.equal(privateRelease.state, "private-review-only");
  assert.match(privateRelease.detail, /no owner-facing intake/i);

  const cinematicCase = catalogExecutionAvailability(catalogExecutionBinding("cinematic-case-sequence"));
  assert.equal(catalogExecutionBinding("cinematic-case-sequence").kind, "registered-private-release");
  assert.deepEqual(catalogExecutionBinding("cinematic-case-sequence").executableIds, [
    "cinematic_case_sequence_draft",
    "cinematic_case_sequence_finalize",
    "cinematic_case_sequence",
  ], "direction and signature inputs stay behind the same private-release boundary");
  assert.equal(cinematicCase.state, "private-review-only",
    "human-signed cinematic crime review must not appear as an autonomous pipeline capability");
  assert.match(cinematicCase.detail, /cannot become an automatic creator route/i);

  const children = catalogExecutionAvailability(catalogExecutionBinding("children-video-treatment"));
  assert.equal(catalogExecutionBinding("children-video-treatment").kind, "pipeline-module");
  assert.equal(children.state, "composition-gated");
  assert.match(children.detail, /does not grant automatic channel admission/i);

  const externalTask = catalogExecutionAvailability(catalogExecutionBinding("channel-planner"));
  assert.equal(externalTask.state, "outside-module-abi");
  assert.match(externalTask.label, /external task/i);

  const catalogOnly = catalogExecutionAvailability(catalogExecutionBinding("cinematic"));
  assert.equal(catalogOnly.state, "blocked");
  assert.match(catalogOnly.label, /blocked/i);
}

main();
console.log("golden catalog availability tests passed");
