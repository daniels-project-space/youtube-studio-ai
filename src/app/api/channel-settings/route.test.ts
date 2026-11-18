import assert from "node:assert/strict";
import {
  assertCasefileAutoResearchLaneEligible,
  isValidChannelBudget,
  validatedSchedule,
} from "@/lib/channelSettingsValidation";

for (const value of [undefined, null, "", "0", false, NaN, Infinity, -1, 10000.01]) {
  assert.equal(isValidChannelBudget(value), false, `invalid budget: ${String(value)}`);
}
for (const value of [0, 0.5, 10000]) assert.equal(isValidChannelBudget(value), true);

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
assert.equal(validatedSchedule({}, { frequency: "daily" }).enabled, false);
assert.equal(validatedSchedule({ enabled: true, frequency: "daily" }, { localTime: "10:00" }).enabled, true);
assert.equal(validatedSchedule({ enabled: true, frequency: "daily" }, { enabled: false }).enabled, false);
assert.equal(validatedSchedule({}, { enabled: true, frequency: "daily" }).enabled, true);

/* ---- casefileAutoResearchEnabled is unavailable until an automatic route exists ---- */

for (const channel of [
  { family: "narrated_stock", pipeline: [] },
  {
    contentLane: {
      version: "content-lane/v1" as const,
      key: "cinematic_ai",
      family: "cinematic",
      primaryRenderer: "novita_render_video",
    },
    family: "cinematic",
    pipeline: [],
  },
]) {
  assert.throws(
    () => assertCasefileAutoResearchLaneEligible(channel, true),
    /no sealed channel Program Route currently admits autonomous Casefile research/,
    "enabling automatic Casefile research must fail closed until a dedicated route exists",
  );
}

// Disabling is always allowed, on any lane — never block turning off spend.
assert.doesNotThrow(() =>
  assertCasefileAutoResearchLaneEligible({ family: "whiteboard", pipeline: [] }, false),
);

console.log("channel schedule route tests passed");
