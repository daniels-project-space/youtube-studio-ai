import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/trigger/weeklyOperationsDigest.ts"), "utf8");
assert.match(source, /schedules\.task/);
assert.match(source, /cron:\s*["']15 6 \* \* 1/);
assert.match(source, /previousUtcWeekWindow/);
assert.match(source, /automaticOperationsDigestsApi\.record/);
assert.match(source, /buildWeeklyOperationsDigest/);
assert.doesNotMatch(source, /tasks\.trigger/);
console.log("weekly automatic operations digest wiring passed");
