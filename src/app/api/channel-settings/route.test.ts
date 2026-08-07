import assert from "node:assert/strict";
import { validatedSchedule } from "./route";

assert.throws(
  () => validatedSchedule({}, { frequency: "weekly", days: [] }),
  /require at least one weekday/,
);
assert.deepEqual(
  validatedSchedule({}, {
    frequency: "weekly",
    days: [3, 1, 3],
    timezone: "Europe/London",
    localTime: "09:30",
  }).days,
  [1, 3],
);
assert.equal(
  validatedSchedule({}, { frequency: "daily", days: [] }).days,
  undefined,
);

console.log("channel schedule route tests passed");
