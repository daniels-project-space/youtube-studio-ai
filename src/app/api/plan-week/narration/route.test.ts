import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/app/api/plan-week/narration/route.ts"), "utf8");
assert.match(source, /requireStudioActor/);
assert.match(source, /assertPlanWeekPreparedNarrationArgs/);
assert.match(source, /tasks\.trigger\("plan-week-prepared-narration"/);
assert.match(source, /idempotencyKeys\.create/);
assert.match(source, /ownedBy\(actor\.ownerId, payload\.manifestKey\)/);
assert.match(source, /planWeekPreparedNarrationAudioKey/);
console.log("weekly prepared narration dispatcher wiring passed");
