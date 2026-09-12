import assert from "node:assert/strict";

import {
  admitOrdinaryCreativeObservation,
  creativeMeasurementKind,
} from "@/lib/contentExperimentMeasurement";

assert.equal(creativeMeasurementKind(undefined), "single_variant_observation");
assert.equal(creativeMeasurementKind("legacy"), "single_variant_observation");
assert.equal(creativeMeasurementKind("youtube_native_ab"), "youtube_native_ab");
assert.deepEqual(admitOrdinaryCreativeObservation(undefined), {
  pass: true,
  kind: "single_variant_observation",
});
const native = admitOrdinaryCreativeObservation("youtube_native_ab");
assert.equal(native.pass, false);
if (!native.pass) assert.match(native.reason, /watch-time-share/i);

console.log("contentExperimentMeasurement: ordinary creative observations cannot resolve native A/B tests");
