import assert from "node:assert/strict";
import {
  admitCinematicFinalMasterQa,
  assertCinematicFinalMasterQaAdmission,
  assertCinematicFinalMasterQaProfile,
} from "@/engine/cinematicFinalMasterQaAdmission";
import {
  CinematicCreativeLocksSchema,
  CinematicEditDecisionListSchema,
} from "@/engine/cinematicCaseSequence";
import { MODULE_CONTRACTS } from "@/engine/moduleContracts";
import { configuredMaxCostUsd, manifestFromBlock } from "@/engine/moduleManifest";
import {
  cinematicFinalMasterQaReviewCost,
  qaVisualCost,
} from "@/engine/pricing";
import type { Block } from "@/engine/types";

const creativeLocks = CinematicCreativeLocksSchema.parse({
  version: "cinematic-case-sequence/v1",
  sequenceFingerprint: "a".repeat(64),
  locks: [
    {
      id: "cinematic-shot-one",
      startSec: 0,
      endSec: 5,
      expected: "faceless mannequin enters the evidence room",
      acceptanceCriteria: ["continuity", "citation", "faceless cast", "no likeness"],
    },
    {
      id: "cinematic-shot-two",
      startSec: 5,
      endSec: 10,
      expected: "the evidence changes the causal question",
      acceptanceCriteria: ["causal turn", "tension", "citation", "no likeness"],
    },
  ],
});

const editDecisionList = CinematicEditDecisionListSchema.parse({
  version: "cinematic-case-sequence/v1",
  sequenceFingerprint: "a".repeat(64),
  durationSec: 10,
  edits: [
    {
      shotId: "cinematic-shot-one",
      t0: 0,
      t1: 5,
      cutReason: "new_location",
      tensionState: "uncertainty",
      narrationPurpose: "Establish the unanswered question.",
    },
    {
      shotId: "cinematic-shot-two",
      t0: 5,
      t1: 10,
      cutReason: "reveal",
      tensionState: "reversal",
      narrationPurpose: "Show the evidence that reverses the assumption.",
    },
  ],
});

const admission = admitCinematicFinalMasterQa({ creativeLocks, editDecisionList });
assert.equal(admission.reviewer, "non_google_vision");
assert.equal(admission.lockCount, 2);
assert.equal(admission.cutCount, 1);
assert.equal(admission.reviewCallCount, 3);
assert.equal(admission.reviewCostUsd, cinematicFinalMasterQaReviewCost(3));

assert.deepEqual(
  assertCinematicFinalMasterQaAdmission({
    admission,
    creativeLocks,
    editDecisionList,
  }),
  admission,
);

assert.throws(
  () =>
    assertCinematicFinalMasterQaAdmission({
      admission: { ...admission, reviewCallCount: 2 },
      creativeLocks,
      editDecisionList,
    }),
  /no longer matches the admitted sequence/,
);

assert.doesNotThrow(() => assertCinematicFinalMasterQaProfile(undefined));
assert.doesNotThrow(() => assertCinematicFinalMasterQaProfile("production"));
assert.throws(
  () => assertCinematicFinalMasterQaProfile("draft"),
  /cannot use qaProfile=draft/,
  "a source-bound cinematic master must never report qaPassed without the independent final-master evidence receipt",
);

// A twelve-shot final master has 12 lock judgements and 11 cut judgements.
// Its exact receipt must fit the long-established $5 qa_visual ceiling, while
// a larger receipt is rejected rather than under-reserved or silently allowed
// to expand that authority.
const twelveShotReviewCost = cinematicFinalMasterQaReviewCost(23);
const qaVisual: Block = {
  id: "qa_visual",
  consumes: [],
  produces: ["master.quality_passed"],
  paid: true,
  run: async () => ({ "master.quality_passed": true }),
};
const qaManifest = manifestFromBlock(qaVisual, MODULE_CONTRACTS.qa_visual);
const normalEnvelope = configuredMaxCostUsd(qaManifest, {}, {
  entries: [],
  index: 0,
  store: {
    cinematicFinalMasterQaAdmission: {
      ...admission,
      lockCount: 12,
      cutCount: 11,
      reviewCallCount: 23,
      reviewCostUsd: twelveShotReviewCost,
    },
  },
});
assert.equal(normalEnvelope, qaVisualCost({}, twelveShotReviewCost));
assert.ok(normalEnvelope < 5);

const oversizedReviewCost = cinematicFinalMasterQaReviewCost(60);
assert.throws(
  () =>
    configuredMaxCostUsd(qaManifest, {}, {
      entries: [],
      index: 0,
      store: {
        cinematicFinalMasterQaAdmission: {
          ...admission,
          lockCount: 31,
          cutCount: 29,
          reviewCallCount: 60,
          reviewCostUsd: oversizedReviewCost,
        },
      },
    }),
  /configured envelope .* exceeds its absolute \$5\.00 ceiling/,
);

console.log("cinematic final-master QA admission tests passed");
