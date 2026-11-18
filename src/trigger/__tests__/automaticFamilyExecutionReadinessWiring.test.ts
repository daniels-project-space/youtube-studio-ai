import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../designChannelInception.ts", import.meta.url), "utf8");
const bootstrap = source.indexOf("await bootstrapSecrets(log);");
const capabilityGate = source.indexOf("assertAutomaticFamilyExecutionReadiness(payload.family,");
const unavailableDesign = source.indexOf("if (!design.available || !design.productionReady)");

assert.ok(bootstrap >= 0, "inception must hydrate server-only capabilities before checking them");
assert.ok(capabilityGate > bootstrap, "renderer capability gate must run after secret hydration");
assert.ok(
  capabilityGate < unavailableDesign,
  "renderer capability gate must stop automatic inception before any downstream design/provider work",
);
const creatorAdmission = source.slice(capabilityGate, unavailableDesign);
assert.match(creatorAdmission, /narrationProvider:\s*"qwen3"/);
assert.match(creatorAdmission, /thumbnailMode:\s*"deferred_mvp"/);
assert.doesNotMatch(creatorAdmission, /narrationProvider:\s*"elevenlabs"/);

const scheduler = readFileSync(new URL("../scheduler.ts", import.meta.url), "utf8");
const schedulerBootstrap = scheduler.indexOf("await ensureSchedulerBootstrap();");
const schedulerRuntimeGate = scheduler.indexOf("const automaticRuntimeAdmission = automaticFamilyExecutionReadinessAdmission", schedulerBootstrap);
const schedulerPlanClaim = scheduler.indexOf("api.contentPlan.claimNextPlanRun", schedulerBootstrap);
const schedulerCasefile = scheduler.indexOf("dispatchCasefileAutoResearch(", schedulerBootstrap);
assert.ok(schedulerBootstrap >= 0 && schedulerRuntimeGate >= 0 && schedulerPlanClaim >= 0 && schedulerCasefile >= 0);
assert.ok(
  schedulerBootstrap < schedulerRuntimeGate && schedulerRuntimeGate < schedulerPlanClaim && schedulerRuntimeGate < schedulerCasefile,
  "a scheduled automatic channel must re-check its hydrated live stack before plan claim or provider-capable Casefile work",
);
const schedulerGateSlice = scheduler.slice(schedulerRuntimeGate, schedulerPlanClaim);
assert.match(schedulerGateSlice, /if \(!automaticRuntimeAdmission\.automatic\)[\s\S]*continue;/);
assert.doesNotMatch(schedulerGateSlice, /claimNextPlanRun|dispatchCasefileAutoResearch|failClaimedPlanRun/);

const pipeline = readFileSync(new URL("../runPipeline.ts", import.meta.url), "utf8");
const runtimeBootstrap = pipeline.indexOf("await bootstrapSecrets(", pipeline.indexOf("requiresAutomaticFamilyExecutionReadiness"));
const runRuntimeGate = pipeline.indexOf("const automaticRuntimeAdmission = automaticFamilyExecutionReadinessAdmission", runtimeBootstrap);
const executionLease = pipeline.indexOf("api.runs.claimExecutionLease", runtimeBootstrap);
assert.ok(runtimeBootstrap >= 0 && runRuntimeGate >= 0 && executionLease >= 0);
assert.ok(
  runtimeBootstrap < runRuntimeGate && runRuntimeGate < executionLease,
  "a direct/scheduled automatic run must stop before lease, snapshot, or provider work when its live stack drifts",
);
const runGateSlice = pipeline.slice(runRuntimeGate, executionLease);
assert.match(runGateSlice, /if \(!automaticRuntimeAdmission\.automatic\)[\s\S]*executionReadinessBlocked[\s\S]*manualGate: true/);
assert.match(pipeline.slice(pipeline.indexOf("const candidateBenchmarkV3"), runtimeBootstrap), /if \(!candidateBenchmarkV3 && requiresAutomaticFamilyExecutionReadiness\(persistedFamily\)\)/);
const candidatePreflight = pipeline.indexOf("preflightCandidateBenchmarkWorker({", executionLease);
const candidateBootstrap = pipeline.indexOf("await bootstrapSecrets(", candidatePreflight);
const candidateRuntimeGate = pipeline.indexOf("const readiness = automaticFamilyExecutionReadinessAdmission", candidateBootstrap);
const candidateSnapshot = pipeline.indexOf("api.runs.claimInvocationSnapshot", candidateRuntimeGate);
assert.ok(candidatePreflight > executionLease && candidateBootstrap > candidatePreflight && candidateRuntimeGate > candidateBootstrap && candidateSnapshot > candidateRuntimeGate);
assert.match(pipeline.slice(candidateRuntimeGate, candidateSnapshot), /if \(!readiness\.automatic\) throw new Error\(readiness\.reason\)/);

const creatorRoute = readFileSync(
  new URL("../../app/api/build-channel/route.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(
  creatorRoute,
  /automaticFamilyExecutionReadinessAdmission|bootstrapSecrets/,
  "the web creator must not misclassify a worker-only vault secret as a missing live capability; secure workers own hydrated runtime admission",
);

console.log("Automatic family execution readiness wiring tests passed");
