import assert from "node:assert/strict";
import {
  chunkWeeklyPlanChannels,
  currentUtcWeekStart,
  parseWeeklyPlanCount,
} from "@/lib/weeklyPlanAhead";

assert.equal(parseWeeklyPlanCount(undefined), 5);
assert.equal(parseWeeklyPlanCount("12"), 12);
assert.throws(() => parseWeeklyPlanCount("0"), /integer from 1 to 12/);
assert.throws(() => parseWeeklyPlanCount("many"), /integer from 1 to 12/);
assert.deepEqual(chunkWeeklyPlanChannels(["b", "a", "", "a"]), [["a", "b"]]);
const ids = Array.from({ length: 13 }, (_, index) => `channel-${index}`);
assert.deepEqual(chunkWeeklyPlanChannels(ids).map((chunk) => chunk.length), [12, 1]);
assert.equal(new Date(currentUtcWeekStart(Date.UTC(2026, 8, 16, 12))).toISOString(), "2026-09-14T00:00:00.000Z");
console.log("weekly plan-ahead contracts passed");
