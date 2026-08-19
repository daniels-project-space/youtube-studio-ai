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

/* ---- casefileAutoResearchEnabled is refused at WRITE TIME off cinematic_ai ---- */

const cinematicLane = {
  version: "content-lane/v1" as const,
  key: "cinematic_ai",
  family: "cinematic",
  primaryRenderer: "novita_render_video",
};

// A wrong-lane channel must be refused outright, with a message that says why.
for (const channel of [
  // Persisted non-cinematic lane.
  {
    contentLane: {
      version: "content-lane/v1" as const,
      key: "narrated_documentary",
      family: "narrated_stock",
      primaryRenderer: "stock_footage",
    },
    family: "narrated_stock",
    pipeline: [],
  },
  // No persisted lane, but a family that resolves to a non-cinematic lane.
  { family: "whiteboard", pipeline: [] },
  // Nothing resolvable at all -> legacy_unclassified, still not cinematic_ai.
  { pipeline: [] },
]) {
  assert.throws(
    () => assertCasefileAutoResearchLaneEligible(channel, true),
    /requires the cinematic_ai content lane/,
    "enabling automatic Casefile research off the cinematic_ai lane must throw at settings-write time",
  );
}

// Disabling is always allowed, on any lane — never block turning off spend.
assert.doesNotThrow(() =>
  assertCasefileAutoResearchLaneEligible({ family: "whiteboard", pipeline: [] }, false),
);

// A genuine cinematic_ai channel is accepted.
assert.doesNotThrow(() =>
  assertCasefileAutoResearchLaneEligible(
    { contentLane: cinematicLane, family: "cinematic", pipeline: [] },
    true,
  ),
);

console.log("channel schedule route tests passed");
