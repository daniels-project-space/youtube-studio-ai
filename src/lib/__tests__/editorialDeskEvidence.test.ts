import assert from "node:assert/strict";
import {
  casefileEvidenceLocks,
  editorialEvidenceSummary,
} from "@/lib/editorialDeskEvidence";

const blankCase = casefileEvidenceLocks(null);
assert.equal(
  blankCase.filter((lock) => lock.recorded).length,
  0,
  "a missing case must not be shown as having recorded evidence",
);

const recordedCase = casefileEvidenceLocks({
  sourcePacketFingerprint: "source-fingerprint",
  workflow: {
    sourceBoundStorySpine: { storySpineFingerprint: "story-fingerprint" },
    narrativeEvidenceLedger: { contentFingerprint: "ledger-fingerprint" },
    referenceMechanicsPacket: { contentFingerprint: "mechanics-fingerprint" },
    cinematicDraft: {
      sequenceContentFingerprint: "sequence-fingerprint",
      content: {
        beats: [
          {
            shots: [
              { visualMode: "generated" },
              { visualMode: "source_proof", sourceProofMedia: { assetId: "asset-1" } },
            ],
          },
        ],
      },
    },
    cinematicAdmission: { generatedSceneCount: 4, release: "reviewed" },
  },
});

assert.equal(
  recordedCase.filter((lock) => lock.recorded).length,
  7,
  "every persisted Casefile binding should be visible independently",
);
assert.equal(
  recordedCase.find((lock) => lock.label === "Source-proof media")?.recorded,
  true,
  "source-proof media is only recorded when a persisted source-proof shot has media",
);

assert.deepEqual(
  editorialEvidenceSummary({
    sources: [{ id: "source-a" }, { id: "source-b" }],
    claims: [{ id: "claim-a" }, { id: "claim-b" }, { id: "claim-c" }],
    review: {
      reviewerId: "editor-7",
      reviewId: "review-9",
      reviewedAt: "2026-08-22T12:00:00.000Z",
    },
  }),
  {
    sourceCount: 2,
    claimCount: 3,
    reviewerId: "editor-7",
    reviewId: "review-9",
    reviewedAt: "2026-08-22T12:00:00.000Z",
  },
  "receipt summaries must only use fields persisted in the packet",
);

assert.deepEqual(
  editorialEvidenceSummary({ sources: "not-an-array", claims: null, review: {} }),
  { sourceCount: 0, claimCount: 0 },
  "malformed or absent packet fields must stay visibly unrecorded",
);

console.log("Editorial desk evidence projections passed");
