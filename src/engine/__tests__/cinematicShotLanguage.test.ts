import assert from "node:assert/strict";
import {
  classifyCinematicNarrativeIntent,
  planCinematicShotLanguage,
} from "../cinematicShotLanguage";
import { planStorySpine } from "../storySpine";

assert.equal(
  classifyCinematicNarrativeIntent("The phone record showed the call came from inside the house.", "follow the clue", false),
  "investigate",
);
assert.equal(
  classifyCinematicNarrativeIntent("But the evidence proved he had never left the city.", "the contradiction", false), "reveal");
assert.equal(
  classifyCinematicNarrativeIntent("The detective raced to stop the escape.", "stakes rise", false), "escalate");

const first = planCinematicShotLanguage({
  literalContent: "The record showed a second key had been used.",
  beatPurpose: "investigate the missing entry",
  shotIndex: 4,
  chunkIndex: 0,
  chunksInBeat: 2,
});
const next = planCinematicShotLanguage({
  literalContent: "But the timestamp made that explanation impossible.",
  beatPurpose: "reveal the contradiction",
  shotIndex: 5,
  chunkIndex: 1,
  chunksInBeat: 2,
  previous: first,
});
assert.equal(first.intent, "investigate");
assert.equal(next.intent, "reveal");
assert.notEqual(next.cameraMove, first.cameraMove);
assert.notEqual(next.shotScale, first.shotScale);
assert.match(next.cutRationale, /tighten|overturns/i);

const spine = planStorySpine({
  topic: "a source-bound investigation",
  narrationDurationSec: 18,
  targetShotSec: 3,
  sentenceTimings: [
    { text: "In the winter of 1994, the house sat empty at the edge of town.", start: 0, end: 3 },
    { text: "The phone record showed a second key had been used.", start: 3, end: 6 },
    { text: "But the timestamp made that explanation impossible.", start: 6, end: 9 },
    { text: "The detective raced to stop the escape before dawn.", start: 9, end: 12 },
    { text: "Afterward, the consequence changed the whole investigation.", start: 12, end: 15 },
    { text: "The witness finally chose to explain what she saw.", start: 15, end: 18 },
  ],
  structure: { beats: [{ name: "cause and effect", note: "advance the causal story" }] },
});
assert.equal(spine.shotList.length, 6);
for (let index = 1; index < spine.shotList.length; index++) {
  assert.notEqual(spine.shotList[index]?.cameraMove, spine.shotList[index - 1]?.cameraMove, "adjacent LTX shots must not be index-cycled duplicates");
  assert.notEqual(spine.shotList[index]?.shotScale, spine.shotList[index - 1]?.shotScale, "adjacent LTX shots must change coverage deliberately");
}
assert.match(spine.dpVisualSpecs[2]?.keyframePrompt ?? "", /Visual purpose:.*Cut rationale:/);
console.log("cinematic shot language test passed");
