import assert from "node:assert/strict";

import {
  EDITORIAL_EVIDENCE_NARRATION_BINDING_VERSION,
  assertEditorialEvidencePacketNarrationAlignment,
} from "@/engine/editorialEvidenceNarration";
import { createEditorialEvidencePacket } from "@/engine/editorialEvidencePacket";
import { planStorySpine } from "@/engine/storySpine";

const now = Date.now();

function reviewedPacket(args?: { approvedText?: string; numericAnchor?: string }) {
  return createEditorialEvidencePacket({
    subject: "Weekly seed growth",
    sources: [{
      id: "source-seed-atlas",
      name: "Seed Atlas",
      url: "https://example.org/seed-atlas",
      snapshotSha256: "a".repeat(64),
      kind: "dataset",
    }],
    claims: [{
      id: "claim-weekly-sprouts",
      sourceIds: ["source-seed-atlas"],
      approvedText: args?.approvedText ?? "Seed Atlas recorded 20 sprouts in week one and 35 in week two.",
      numericAnchor: args?.numericAnchor ?? "20 and 35",
      context: "Reviewed weekly seed-growth trend.",
    }],
    review: {
      reviewerId: "editorial-reviewer",
      reviewId: "review-seed-growth",
      reviewedAt: new Date(now).toISOString(),
    },
    now,
  });
}

function spineFor(firstSentence: string) {
  return planStorySpine({
    topic: "Weekly seed growth",
    narrationDurationSec: 24,
    sentenceTimings: [
      { text: firstSentence, start: 0, end: 12 },
      { text: "The second week shows a clear upward change.", start: 12, end: 24 },
    ],
  });
}

const approvedText = "Seed Atlas recorded 20 sprouts in week one and 35 in week two.";
const binding = assertEditorialEvidencePacketNarrationAlignment({
  editorialEvidencePacket: reviewedPacket(),
  storySpine: spineFor(approvedText),
  now,
});
assert.equal(binding.version, EDITORIAL_EVIDENCE_NARRATION_BINDING_VERSION);
assert.deepEqual(binding.claimBindings, [{
  claimId: "claim-weekly-sprouts",
  sourceIds: ["source-seed-atlas"],
  storySpineSentenceIds: ["sentence-0001"],
}]);

assert.throws(
  () => assertEditorialEvidencePacketNarrationAlignment({
    editorialEvidencePacket: reviewedPacket(),
    storySpine: spineFor("Seed Atlas recorded a strong second week."),
    now,
  }),
  /is not represented verbatim in one timed Story Spine sentence/,
  "a factual packet must not silently drift into paraphrased narration",
);

assert.throws(
  () => assertEditorialEvidencePacketNarrationAlignment({
    editorialEvidencePacket: reviewedPacket({
      approvedText: "Seed Atlas reports the weekly totals.",
      numericAnchor: "20 and 35",
    }),
    storySpine: spineFor("Seed Atlas reports the weekly totals."),
    now,
  }),
  /does not say its approved numeric anchor exactly/,
  "a matched claim must still retain every reviewed numeric anchor",
);

console.log("editorial evidence narration tests passed");
