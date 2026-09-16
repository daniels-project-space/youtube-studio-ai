import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/trigger/weeklyPlanAhead.ts"), "utf8");
assert.match(source, /schedules\.task/);
assert.match(source, /cron:\s*["']0 5 \* \* 1/);
assert.match(source, /STUDIO_AUTOMATION_GATES\.autopilot/);
assert.match(source, /tasks\.trigger\("plan-week-bulk"/);
assert.match(source, /STUDIO_AUTO_CHANNELS/);
assert.match(source, /chunkWeeklyPlanChannels/);
assert.doesNotMatch(source, /run-pipeline/);
console.log("weekly plan-ahead scheduling wiring passed");
