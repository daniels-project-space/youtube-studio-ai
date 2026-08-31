import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function main(): Promise<void> {
  const root = process.cwd();
  const source = await readFile(join(root, "src/trigger/scheduler.ts"), "utf8");
  const seriesGate = source.indexOf("const narrativeRequirement = narrativeSeriesSchedulerRequirement({");
  const bootstrap = source.indexOf("await ensureSchedulerBootstrap();");
  const planClaim = source.indexOf("api.contentPlan.claimNextPlanRun", seriesGate);
  const trigger = source.indexOf('"run-pipeline"', planClaim);
  assert(seriesGate >= 0, "scheduler must derive a narrative selector from the sealed horizon");
  assert(bootstrap > seriesGate, "series horizon validation must happen before secrets bootstrap");
  assert(planClaim > seriesGate, "series horizon validation must happen before run claiming");
  assert(trigger > planClaim, "selector must be present before pipeline dispatch");
  const gateSlice = source.slice(seriesGate, planClaim);
  assert.doesNotMatch(gateSlice, /bootstrapSecrets|claimNextPlanRun|tasks\.trigger/);
  const claimSlice = source.slice(planClaim, trigger);
  assert.match(claimSlice, /narrativeSeriesSelector/);
  const triggerSlice = source.slice(trigger, source.indexOf("if (\"recoveryDispatch\" in admitted", trigger));
  assert.match(triggerSlice, /narrativeSeriesSelector/);
  console.log("NARRATIVE SERIES SCHEDULER WIRING PASS");
}

void main();
