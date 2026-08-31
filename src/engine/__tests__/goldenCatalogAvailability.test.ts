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

  const externalTask = catalogExecutionAvailability(catalogExecutionBinding("channel-planner"));
  assert.equal(externalTask.state, "outside-module-abi");
  assert.match(externalTask.label, /external task/i);

  const catalogOnly = catalogExecutionAvailability(catalogExecutionBinding("cinematic"));
  assert.equal(catalogOnly.state, "blocked");
  assert.match(catalogOnly.label, /blocked/i);
}

main();
console.log("golden catalog availability tests passed");
