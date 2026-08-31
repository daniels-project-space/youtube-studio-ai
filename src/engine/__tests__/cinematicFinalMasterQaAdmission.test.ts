import assert from "node:assert/strict";
import {
  admitCinematicFinalMasterQa,
  assertCinematicFinalMasterAudioAesthetics,
  assertCinematicFinalMasterQaAdmission,
  assertCinematicFinalMasterQaProfile,
  cinematicFinalMasterQaVisualReviewPlan,
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
assert.equal(
  assertCinematicFinalMasterAudioAesthetics(true, 8.4),
  8.4,
  "a finite final-master aesthetics score is retained as QA evidence",
);
assert.throws(
  () => assertCinematicFinalMasterAudioAesthetics(false, undefined),
  /requires audioQa=true/,
  "a cinematic final master cannot opt out of independently scored audio",
);
assert.throws(
  () => assertCinematicFinalMasterAudioAesthetics(true, undefined),
  /loudness alone is insufficient/,
  "an unavailable aesthetics scorer must not downgrade Casefile audio QA to loudness-only",
);
assert.throws(
  () => assertCinematicFinalMasterAudioAesthetics(true, 10.1),
  /finite 0\.\.10 audio aesthetics/,
  "a malformed out-of-range scorer value must not become a passing production-quality score",
);

// The pre-render reservation receives the same sealed complete-focus plan as
// qa_visual execution. It must add that exact 2fps schedule to the bounded
// broad/reactive allowance rather than pricing only the lock/cut receipt.
const visualReviewPlan = cinematicFinalMasterQaVisualReviewPlan({
  admission,
  creativeLocks,
  editDecisionList,
});
assert.ok(visualReviewPlan.completeFocusFrameCount > 0);
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
    cinematicFinalMasterQaAdmission: admission,
    cinematicCreativeLocks: creativeLocks,
    cinematicEditDecisionList: editDecisionList,
  },
});
assert.equal(
  normalEnvelope,
  qaVisualCost({}, admission.reviewCostUsd, visualReviewPlan.completeFocusFrameCount),
  "store-backed cinematic reservation and qa_visual runtime pricing must share the sealed focus plan",
);
assert.ok(normalEnvelope < 5);

// A large sealed reveal is admitted as a complete 2fps plan, then rejected by
// qa_visual's absolute $5 ceiling before a future Novita renderer may start.
const oversizedCreativeLocks = CinematicCreativeLocksSchema.parse({
  version: "cinematic-case-sequence/v1",
  sequenceFingerprint: "c".repeat(64),
  locks: [
    {
      id: "cinematic-shot-one",
      startSec: 0,
      endSec: 1,
      expected: "opening evidence state",
      acceptanceCriteria: ["continuity", "citation", "faceless cast", "no likeness"],
    },
    {
      id: "cinematic-shot-two",
      startSec: 1,
      endSec: 450.5,
      expected: "long evidence reveal",
      acceptanceCriteria: ["continuity", "citation", "faceless cast", "no likeness"],
    },
  ],
});
const oversizedEditDecisionList = CinematicEditDecisionListSchema.parse({
  version: "cinematic-case-sequence/v1",
  sequenceFingerprint: "c".repeat(64),
  durationSec: 450.5,
  edits: [
    {
      shotId: "cinematic-shot-one",
      t0: 0,
      t1: 1,
      cutReason: "new_location",
      tensionState: "uncertainty",
      narrationPurpose: "Establish the question.",
    },
    {
      shotId: "cinematic-shot-two",
      t0: 1,
      t1: 450.5,
      cutReason: "reveal",
      tensionState: "reversal",
      narrationPurpose: "Show the complete evidence reveal.",
    },
  ],
});
const oversizedAdmission = admitCinematicFinalMasterQa({
  creativeLocks: oversizedCreativeLocks,
  editDecisionList: oversizedEditDecisionList,
});
const oversizedPlan = cinematicFinalMasterQaVisualReviewPlan({
  admission: oversizedAdmission,
  creativeLocks: oversizedCreativeLocks,
  editDecisionList: oversizedEditDecisionList,
});
assert.ok(oversizedPlan.completeFocusFrameCount >= 900);
assert.throws(
  () =>
    configuredMaxCostUsd(qaManifest, {}, {
      entries: [],
      index: 0,
      store: {
        cinematicFinalMasterQaAdmission: oversizedAdmission,
        cinematicCreativeLocks: oversizedCreativeLocks,
        cinematicEditDecisionList: oversizedEditDecisionList,
      },
    }),
  /configured envelope .* exceeds its absolute \$5\.00 ceiling/,
);

console.log("cinematic final-master QA admission tests passed");
