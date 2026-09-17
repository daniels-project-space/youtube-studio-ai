import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/app/api/plan-week/script/route.ts"), "utf8");
assert.match(source, /requireStudioActor/);
assert.match(source, /assertPlanWeekPreparedScriptArgs/);
assert.match(source, /tasks\.trigger\("plan-week-prepared-script"/);
assert.match(source, /idempotencyKeys\.create/);
assert.match(source, /ownedBy\(actor\.ownerId, payload\.manifestKey\)/);
assert.match(source, /planWeekPreparedScriptKey/);
console.log("weekly prepared script dispatcher wiring passed");

