import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/app/api/plan-week/music/route.ts"), "utf8");
assert.match(source, /requireStudioActor/);
assert.match(source, /assertPlanWeekPreparedMusicArgs/);
assert.match(source, /tasks\.trigger\("plan-week-prepared-music"/);
assert.match(source, /idempotencyKeys\.create/);
assert.match(source, /ownedBy\(actor\.ownerId, payload\.manifestKey\)/);
assert.match(source, /planWeekPreparedMusicAudioKey/);
console.log("weekly prepared music dispatcher wiring passed");
