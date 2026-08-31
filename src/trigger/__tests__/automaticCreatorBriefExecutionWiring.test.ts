import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const scheduler = readFileSync(new URL("../scheduler.ts", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../runPipeline.ts", import.meta.url), "utf8");

const schedulerAdmission = scheduler.indexOf("const creatorBriefAdmission = automaticCreatorBriefAdmission");
const schedulerBootstrap = scheduler.indexOf("await ensureSchedulerBootstrap();", schedulerAdmission);
const schedulerPlanClaim = scheduler.indexOf("api.contentPlan.claimNextPlanRun", schedulerAdmission);
assert.ok(schedulerAdmission >= 0 && schedulerBootstrap >= 0 && schedulerPlanClaim >= 0);
assert.ok(schedulerAdmission < schedulerBootstrap, "creator Brief admission must run before scheduler credential bootstrap");
assert.ok(schedulerAdmission < schedulerPlanClaim, "creator Brief admission must run before calendar-plan leasing");
assert.match(
  scheduler.slice(schedulerAdmission, schedulerBootstrap),
  /if \(!creatorBriefAdmission\.automatic\)[\s\S]*continue;/,
  "a stale factual/child Brief must skip rather than mutate its plan into a failure",
);

const runtimeAdmission = runtime.indexOf("const creatorBriefAdmission = automaticCreatorBriefAdmission");
const runtimeBootstrap = runtime.indexOf("await bootstrapSecrets(", runtimeAdmission);
const runtimeLease = runtime.indexOf("api.runs.claimExecutionLease", runtimeAdmission);
assert.ok(runtimeAdmission >= 0 && runtimeBootstrap >= 0 && runtimeLease >= 0);
assert.ok(runtimeAdmission < runtimeBootstrap, "direct/recovered runs must stop before secret hydration");
assert.ok(runtimeAdmission < runtimeLease, "direct/recovered runs must stop before execution leasing");
assert.match(
  runtime.slice(runtimeAdmission, runtimeBootstrap),
  /creatorBriefBlocked:\s*true[\s\S]*manualGate:\s*true/,
  "the direct guard must return a manual gate rather than enter generic failure handling",
);

console.log("automatic creator Brief execution wiring tests passed");
