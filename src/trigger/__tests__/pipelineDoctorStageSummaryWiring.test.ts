import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const doctor = readFileSync(
  new URL("../pipelineDoctor.ts", import.meta.url),
  "utf8",
);
const stages = readFileSync(
  new URL("../../../convex/runStages.ts", import.meta.url),
  "utf8",
);

assert.match(doctor, /const DOCTOR_STAGE_SUMMARY_BATCH_SIZE = 100/);
assert.match(doctor, /api\.runStages\.listDoctorStageSummariesForRuns/);
assert.match(doctor, /runs\.slice\(offset, offset \+ DOCTOR_STAGE_SUMMARY_BATCH_SIZE\)/);
assert.doesNotMatch(
  doctor,
  /convex\.query\(api\.runStages\.listRunStages/,
  "the doctor must not create one full-stage HTTP request per run",
);

const projection = stages.slice(
  stages.indexOf("export const listDoctorStageSummariesForRuns"),
);
assert.match(projection, /args\.runIds\.length > 100/);
assert.match(projection, /withIndex\("by_run"/);
assert.match(projection, /doctorQaReport/);
assert.match(projection, /issue\.slice\(0, 240\)/);
assert.doesNotMatch(projection, /inputs:/, "the doctor projection must not return stage inputs");

console.log("Pipeline Doctor bounded stage-summary wiring passed");
