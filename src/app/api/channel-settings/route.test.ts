import assert from "node:assert/strict";
import {
  assertCasefileAutoResearchLaneEligible,
  validatedSchedule,
} from "./route";

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
