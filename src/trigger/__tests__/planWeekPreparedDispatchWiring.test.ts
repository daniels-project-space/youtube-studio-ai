import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const planner = readFileSync(resolve(process.cwd(), "src/trigger/planWeekAhead.ts"), "utf8");
const script = readFileSync(resolve(process.cwd(), "src/trigger/planWeekPreparedScript.ts"), "utf8");
const narration = readFileSync(resolve(process.cwd(), "src/trigger/planWeekPreparedNarration.ts"), "utf8");

assert.match(planner, /tasks\.trigger\("plan-week-prepared-script"/);
assert.match(planner, /idempotencyKeys\.create/);
assert.match(planner, /planWeekPreparationManifestSha256\(manifest\)/);
assert.match(planner, /PLAN_WEEK_PREPARED_SCRIPT_MAX_COST_USD/);
assert.match(script, /tasks\.trigger\("plan-week-prepared-narration"/);
assert.match(script, /idempotencyKeys\.create/);
assert.match(script, /PLAN_WEEK_PREPARED_NARRATION_MAX_COST_USD/);
assert.match(narration, /tasks\.trigger\("plan-week-prepared-music"/);
assert.match(narration, /idempotencyKeys\.create/);
assert.match(narration, /PLAN_WEEK_PREPARED_MUSIC_MAX_COST_USD/);
console.log("automatic weekly prepared-media dispatch wiring passed");
