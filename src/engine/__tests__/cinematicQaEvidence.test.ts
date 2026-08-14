import assert from "node:assert/strict";
import { cinematicFinalMasterQaEvidence } from "@/engine/cinematicQaEvidence";
import { CINEMATIC_CASE_SEQUENCE_VERSION } from "@/engine/cinematicCaseSequence";

const fingerprint = "a".repeat(64);
const evidence = cinematicFinalMasterQaEvidence({
  creativeLocks: {
    version: CINEMATIC_CASE_SEQUENCE_VERSION,
    sequenceFingerprint: fingerprint,
    locks: [
      { id: "cinematic-shot-one", startSec: 0, endSec: 3, expected: "Opening question.", acceptanceCriteria: ["a", "b", "c", "d"] },
      { id: "cinematic-shot-two", startSec: 3, endSec: 6, expected: "The contradiction is revealed.", acceptanceCriteria: ["a", "b", "c", "d"] },
      { id: "cinematic-shot-three", startSec: 6, endSec: 9, expected: "The consequence lands.", acceptanceCriteria: ["a", "b", "c", "d"] },
    ],
  },
  editDecisionList: {
    version: CINEMATIC_CASE_SEQUENCE_VERSION,
    sequenceFingerprint: fingerprint,
    durationSec: 9,
    edits: [
      { shotId: "cinematic-shot-one", t0: 0, t1: 3, cutReason: "new_fact", tensionState: "question", narrationPurpose: "Open the question." },
      { shotId: "cinematic-shot-two", t0: 3, t1: 6, cutReason: "contradiction", tensionState: "reversal", narrationPurpose: "Reveal the contradiction." },
      { shotId: "cinematic-shot-three", t0: 6, t1: 9, cutReason: "physical_action", tensionState: "release", narrationPurpose: "Show the consequence." },
    ],
  },
  bodyOffsetSec: 5,
});

assert.deepEqual(
  evidence.creativeLocks.map((lock) => [lock.startSec, lock.endSec]),
  [[5, 8], [8, 11], [11, 14]],
  "all source-bound locks must shift with a prepended intro",
);
assert.equal(evidence.focusWindows.length, 3, "one reveal window plus every actual cinematic join must be inspected");
assert.deepEqual(
  evidence.focusWindows.slice(-2).map((window) => [window.startSec, window.endSec]),
  [[7.65, 8.45], [10.65, 11.45]],
  "cut windows must straddle each final-master EDL boundary",
);

console.log("cinematic final-master QA evidence test passed");
