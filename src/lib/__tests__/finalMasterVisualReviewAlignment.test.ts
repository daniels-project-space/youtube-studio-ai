import assert from "node:assert/strict";
import { join } from "node:path";

import {
  planStorySpine,
  storySpineFingerprint,
  storySpineVisualReviewLocks,
} from "@/engine/storySpine";
import {
  finalMasterTranscriptCues,
  planVisualReviewEvidence,
  reviewRender,
} from "@/lib/visualReview";

const sentenceTimings = [
  { text: "Mira finds a tiny seed beside the sunny garden wall.", start: 0, end: 6 },
  { text: "She gives it water and light every morning before school.", start: 6, end: 12 },
];
const storySpine = planStorySpine({
  topic: "Mira learns to care for a seed",
  narrationDurationSec: 12,
  sentenceTimings,
  targetShotSec: 6,
});

const narrationStartSec = 2;
const finalMasterDurationSec = 15;
const cues = finalMasterTranscriptCues({
  sentenceTimings,
  narrationStartSec,
  finalMasterDurationSec,
});
assert.deepEqual(
  cues.map((cue) => [cue.startSec, cue.endSec]),
  [[2, 8], [8, 14]],
  "narration-local cue times must be shifted onto the final-master clock",
);

const locks = storySpineVisualReviewLocks({
  storySpine,
  expectedStorySpineFingerprint: storySpineFingerprint(storySpine),
  narrationStartSec,
  finalMasterDurationSec,
});
assert.equal(locks.length, storySpine.shotList.length);
assert.deepEqual(
  locks.map((lock) => [lock.startSec, lock.endSec]),
  [[2, 8], [8, 14]],
  "each authored shot must occupy its exact narration-shifted master window",
);
assert.match(locks[0]!.expected, /Mira finds a tiny seed/i);
assert.match(locks[0]!.acceptanceCriteria.join(" "), /exact current narrated idea/i);

const evidence = planVisualReviewEvidence({
  durationSec: finalMasterDurationSec,
  transcriptCues: cues,
  creativeLocks: locks,
  maxFrames: 32,
});
for (const lock of locks) {
  const midpointSec = Number(((lock.startSec + lock.endSec) / 2).toFixed(1));
  assert(
    evidence.some((frame) => Math.abs(frame.tSec - midpointSec) < 0.11 && frame.selectionReasons.includes("scene")),
    `Story Spine lock ${lock.shotId} must contribute a final-master review frame`,
  );
}
assert(
  evidence.some((frame) => frame.tSec >= narrationStartSec && frame.selectionReasons.includes("cue")),
  "the shifted narration map must contribute cue evidence on the master clock",
);

assert.throws(
  () => storySpineVisualReviewLocks({
    storySpine,
    expectedStorySpineFingerprint: "f".repeat(64),
    narrationStartSec,
    finalMasterDurationSec,
  }),
  /fingerprint does not match/i,
  "a substituted post-render Story Spine must not control final visual review",
);
assert.throws(
  () => finalMasterTranscriptCues({
    sentenceTimings,
    narrationStartSec: 5,
    finalMasterDurationSec: 12,
  }),
  /extends beyond the master/i,
  "a cue map that does not fit the final master must fail before review",
);
assert.throws(
  () => storySpineVisualReviewLocks({
    storySpine,
    expectedStorySpineFingerprint: storySpineFingerprint(storySpine),
    narrationStartSec: 5,
    finalMasterDurationSec: 12,
  }),
  /extends beyond the final master/i,
  "a Story Spine whose shifted narration window does not fit the master must fail closed",
);

async function finalReviewerPromptWiringTest(): Promise<void> {
  const prompts: string[] = [];
  const reviewed = await reviewRender(
    join(process.cwd(), "public", "golden", "comic", "comic3d.mp4"),
    18,
    {
      title: "Final-master clock alignment fixture",
      expectTitleCard: false,
      transcriptCues: [...cues],
      creativeLocks: [...locks],
    },
    {
      runId: "final-master-clock-alignment",
      persistEvidence: false,
      maxFrames: 16,
      maxFocusFrames: 0,
      reviewer: async (input) => {
        prompts.push(input.prompt);
        return JSON.stringify({ defects: [], summary: "Aligned narration and Story Spine fixture." });
      },
    },
  );
  assert.equal(reviewed.verdict, "pass");
  const prompt = prompts.join("\n");
  assert.match(prompt, /narration: "Mira finds a tiny seed/i);
  assert.match(prompt, /visual-lock: "Story Spine shot-0001/i);
  assert.match(prompt, /exact current narrated idea/i);
  assert.doesNotMatch(
    prompt,
    /@(?:0\.2|0\.7|1\.5)s[^\n]*narration:/i,
    "intro evidence before the declared narration start must not inherit the nearest spoken cue",
  );
  console.log("final-master narration/Story Spine visual-review alignment tests passed");
}

void finalReviewerPromptWiringTest();
