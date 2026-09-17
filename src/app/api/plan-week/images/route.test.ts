import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/app/api/plan-week/images/route.ts"), "utf8");
assert.match(source, /requireStudioActor/);
assert.match(source, /assertPlanWeekPreparedImagesArgs/);
assert.match(source, /tasks\.trigger\("plan-week-prepared-images"/);
assert.match(source, /idempotencyKeys\.create/);
assert.match(source, /ownedBy\(actor\.ownerId, payload\.manifestKey\)/);
assert.match(source, /planWeekPreparedImagesKey/);
console.log("weekly prepared image dispatcher wiring passed");

