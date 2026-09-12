import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/trigger/planWeekBulk.ts"), "utf8");
assert.match(source, /buildPlanWeekBulkOrder/);
assert.match(source, /api\.channels\.listChannels/);
assert.match(source, /idempotencyKeys\.create/);
assert.match(source, /tasks\.trigger\("plan-week-ahead"/);
assert.match(source, /Promise\.all/);
console.log("plan-week bulk dispatch wiring passed");
