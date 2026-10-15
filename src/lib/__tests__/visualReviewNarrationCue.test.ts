import assert from "node:assert/strict";
import { test } from "node:test";
import { narrationCueForVisualFrame } from "../visualReview";

const cues = [
  { text: "  The opening   claim. ", startSec: 5, endSec: 6 },
  { text: "A distant later claim.", startSec: 30, endSec: 31 },
];

test("frame context uses active or nearby narration, never a remote cue across a long pause", () => {
  assert.equal(narrationCueForVisualFrame(cues, 5.5), "The opening claim.");
  assert.equal(narrationCueForVisualFrame(cues, 6.75), "The opening claim.", "a short narration pause may use nearby context");
  assert.equal(narrationCueForVisualFrame(cues, 7.01), undefined, "a gap over one second is not mislabeled with stale narration");
  assert.equal(narrationCueForVisualFrame(cues, 18), undefined, "a long internal silence must remain unassociated");
  assert.equal(narrationCueForVisualFrame(cues, 4), undefined, "intro frames remain outside narration context");
  assert.equal(narrationCueForVisualFrame(cues, 32), undefined, "outro frames remain outside narration context");
});

test("a frame on an adjacent sentence boundary uses the sentence beginning there", () => {
  const adjacentCues = [
    { text: "The first sentence ends.", startSec: 0, endSec: 2 },
    { text: "The next sentence begins.", startSec: 2, endSec: 4 },
  ];
  assert.equal(narrationCueForVisualFrame(adjacentCues, 2), "The next sentence begins.");
  assert.equal(narrationCueForVisualFrame(adjacentCues, 4), "The next sentence begins.", "the final cue endpoint remains covered");
});
