import assert from "node:assert/strict";

import {
  footageOnScreenTextCues,
  shiftFootageOnScreenTextCues,
} from "@/lib/footageOnScreenTextCues";

const cues = footageOnScreenTextCues([
  {
    sceneId: "shot-intro",
    durationSec: 5,
    nameCardText: "DETECTIVE AYANA OKAFOR",
  },
  {
    sceneId: "shot-proof",
    durationSec: 6,
    evidenceOverlay: { text: "SEC. 001 SOURCE PROOF", durationSec: 2 },
  },
]);

assert.equal(cues.length, 6, "each deterministic text treatment requires entry/middle/exit proof");
assert.deepEqual(
  cues.slice(0, 3).map((cue) => cue.sampleSec),
  [0.72, 2.5, 4.28],
  "name-card samples must avoid its intentional fade edges",
);
assert.deepEqual(
  cues.slice(3).map((cue) => cue.sampleSec),
  [5.24, 6, 6.76],
  "evidence-overlay samples must remain body-relative until assembly",
);
assert.ok(cues.every((cue) => cue.minTokenCoverage === 0.85));

const shifted = shiftFootageOnScreenTextCues(cues, 4.5);
assert.deepEqual(
  shifted.map((cue) => cue.sampleSec),
  [5.22, 7, 8.78, 9.74, 10.5, 11.26],
  "timeline assembly must shift body-relative overlay proof by the actual intro duration",
);
assert.throws(
  () => footageOnScreenTextCues([{ sceneId: "broken", durationSec: 5, nameCardText: "X" }]),
  /at least three visible characters/i,
);
assert.throws(
  () => shiftFootageOnScreenTextCues([{ id: "bad", sampleSec: -1, expectedText: "Bad" }], 0),
  /malformed/i,
);

console.log("footage on-screen text cue timing tests passed");
