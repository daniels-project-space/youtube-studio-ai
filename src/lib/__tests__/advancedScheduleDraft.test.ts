import assert from "node:assert/strict";
import { test } from "node:test";
import { advancedScheduleWrite } from "../advancedScheduleDraft";
import { channelScheduleWriteFence } from "../channelScheduleWriteFence";

test("advanced settings only write a schedule when its own fields change", () => {
  const schedule = { frequency: "weekly", days: [1], enabled: false, timezone: "UTC" };
  const draft = { schedule, cadence: "weekly", days: [1] };
  assert.equal(advancedScheduleWrite(draft, "weekly", [1]), null);
  const write = advancedScheduleWrite(draft, "weekly", [2]);
  assert.deepEqual(write?.schedule, { ...schedule, days: [2] });
  assert.equal(write?.expectedScheduleFence, channelScheduleWriteFence(schedule));
  assert.notEqual(write?.expectedScheduleFence, channelScheduleWriteFence({ ...schedule, enabled: true }));
});
