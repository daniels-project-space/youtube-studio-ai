import assert from "node:assert/strict";

import {
  CINEMATIC_FINAL_MASTER_QA_EVIDENCE_VERSION,
  assertCinematicFinalMasterQaEvidence,
  cinematicFinalMasterQaPlan,
  reviewCinematicFinalMasterQaEvidence,
  type CinematicFinalMasterQaReviewer,
} from "@/lib/cinematicQaEvidenceContract";
import { CINEMATIC_CASE_SEQUENCE_VERSION } from "@/engine/cinematicCaseSequence";
import type { CinematicCaseSequenceInput, CinematicCreativeLocks, CinematicEditDecisionList } from "@/engine/cinematicCaseSequence";
import type { VisualReviewEvidence } from "@/lib/visualReview";

const fingerprint = "a".repeat(64);
const master = "b".repeat(64);
const review = "c".repeat(24);

const sequence = {
  cast: [{
    id: "mannequin-detective",
    role: "investigator",
    silhouette: "tall narrow silhouette",
    wardrobeSignature: "dark herringbone coat and red scarf",
    palette: ["charcoal", "red"],
    keyProp: "folded case file",
    movementProfile: "controlled cautious movement",
    faceless: true,
    noLikeness: true,
  }],
  beats: [{
    id: "cinematic-beat-opening",
    narrativeRole: "cold_open",
    causalQuestion: "Why was the case file sealed?",
    claimIds: ["claim-motive"],
    sourceIds: ["source-court-archive"],
    shots: [{ id: "cinematic-shot-opening", t0: 0, castIds: ["mannequin-detective"], coveragePurpose: "evidence_insert", visualMode: "source_proof" }],
  }, {
    id: "cinematic-beat-reveal",
    narrativeRole: "reveal",
    causalQuestion: "What does the cited timeline change about the sealed file?",
    claimIds: ["claim-timeline"],
    sourceIds: ["source-court-archive"],
    storyPayoff: {
      coldOpenBeatId: "cinematic-beat-opening",
      answerOrReframe: "The cited timeline shows the seal followed a documented chronology, not an unexplained disappearance.",
      citedClaimIds: ["claim-timeline"],
      citedSourceIds: ["source-court-archive"],
    },
    shots: [{ id: "cinematic-shot-reveal", t0: 3, castIds: ["mannequin-detective"], coveragePurpose: "evidence_insert", visualMode: "source_proof" }],
  }],
} as unknown as Pick<CinematicCaseSequenceInput, "cast" | "beats">;

const creativeLocks = {
  version: CINEMATIC_CASE_SEQUENCE_VERSION,
  sequenceFingerprint: fingerprint,
  locks: [
    { id: "cinematic-shot-opening", startSec: 0, endSec: 3, expected: "A faceless detective finds the file.", acceptanceCriteria: ["faceless", "coat", "scarf", "file"] },
    { id: "cinematic-shot-reveal", startSec: 3, endSec: 6, expected: "The case-file contradiction lands.", acceptanceCriteria: ["faceless", "coat", "scarf", "reveal"] },
  ],
} as CinematicCreativeLocks;

const edl = {
  version: CINEMATIC_CASE_SEQUENCE_VERSION,
  sequenceFingerprint: fingerprint,
  durationSec: 6,
  edits: [
    { shotId: "cinematic-shot-opening", t0: 0, t1: 3, cutReason: "new_fact", tensionState: "question", narrationPurpose: "Open a question." },
    { shotId: "cinematic-shot-reveal", t0: 3, t1: 6, cutReason: "contradiction", tensionState: "reversal", narrationPurpose: "Turn the evidence." },
  ],
} as CinematicEditDecisionList;

const evidence: Pick<VisualReviewEvidence, "frames" | "coverage"> = {
  frames: [
    { id: "f1", tSec: 0.2, selectionReasons: ["focus"] },
    { id: "f2", tSec: 1.5, selectionReasons: ["focus"] },
    { id: "f3", tSec: 2.75, selectionReasons: ["focus"] },
    { id: "f4", tSec: 2.8, selectionReasons: ["focus"] },
    { id: "f5", tSec: 3.2, selectionReasons: ["focus"] },
    { id: "f6", tSec: 3.25, selectionReasons: ["focus"] },
    { id: "f7", tSec: 4.5, selectionReasons: ["focus"] },
    { id: "f8", tSec: 5.75, selectionReasons: ["focus"] },
  ],
  coverage: {
    maxGapSec: 1.3,
    maxAllowedGapSec: 6,
    focusedWindows: [],
    requiredFocusFrameCount: 8,
    missingFocusFrameCount: 0,
  },
};

const plan = cinematicFinalMasterQaPlan({ sequence, creativeLocks, editDecisionList: edl });
assert.equal(plan.locks.length, 2, "approved locks must become receipt requirements");
assert.equal(plan.cuts[0]?.atSec, 3, "EDL joins must use final-master timing");
assert.equal(plan.payoffs[0]?.shotId, "cinematic-shot-reveal", "the cited reveal's source-proof lock must carry the opening-question payoff");

const receipt = {
  version: CINEMATIC_FINAL_MASTER_QA_EVIDENCE_VERSION,
  sequenceFingerprint: fingerprint,
  finalMasterSha256: master,
  visualReviewFingerprint: review,
  reviewer: "non_google_vision",
  locks: [
    {
      shotId: "cinematic-shot-opening",
      acceptedCriteria: ["faceless", "coat", "scarf", "file"],
      startFrameId: "f1",
      middleFrameId: "f2",
      endFrameId: "f3",
      continuity: [{ castId: "mannequin-detective", faceless: true, noLikeness: true, silhouetteContinuous: true, wardrobeContinuous: true, paletteContinuous: true, keyPropContinuous: true, movementProfileContinuous: true }],
      pass: true,
    },
    {
      shotId: "cinematic-shot-reveal",
      acceptedCriteria: ["faceless", "coat", "scarf", "reveal"],
      startFrameId: "f6",
      middleFrameId: "f7",
      endFrameId: "f8",
      continuity: [{ castId: "mannequin-detective", faceless: true, noLikeness: true, silhouetteContinuous: true, wardrobeContinuous: true, paletteContinuous: true, keyPropContinuous: true, movementProfileContinuous: true }],
      pass: true,
    },
  ],
  claims: [
    { claimId: "claim-motive", shotId: "cinematic-shot-opening", evidenceFrameIds: ["f2"], onScreenCitationVisible: true, visualSupportVisible: true, pass: true },
    { claimId: "claim-timeline", shotId: "cinematic-shot-reveal", evidenceFrameIds: ["f7"], onScreenCitationVisible: true, visualSupportVisible: true, pass: true },
  ],
  payoffs: [{
    coldOpenBeatId: "cinematic-beat-opening",
    revealBeatId: "cinematic-beat-reveal",
    shotId: "cinematic-shot-reveal",
    citedClaimIds: ["claim-timeline"],
    citedSourceIds: ["source-court-archive"],
    evidenceFrameIds: ["f7"],
    causalQuestionAnsweredOrReframed: true,
    onScreenCitationVisible: true,
    visualSupportVisible: true,
    pass: true,
  }],
  cuts: [{ shotId: "cinematic-shot-reveal", cutReason: "contradiction", tensionState: "reversal", beforeFrameId: "f4", afterFrameId: "f5", causalTurnVisible: true, tensionTransitionVisible: true, pass: true }],
  pass: true,
};

assert.equal(
  assertCinematicFinalMasterQaEvidence({ receipt, plan, evidence, visualReviewFingerprint: review, finalMasterSha256: master }).pass,
  true,
  "a complete source-bound cinematic receipt must pass without calling a provider",
);

assert.throws(
  () => assertCinematicFinalMasterQaEvidence({
    receipt: { ...receipt, locks: receipt.locks.map((lock) => lock.shotId === "cinematic-shot-reveal" ? { ...lock, continuity: [{ ...lock.continuity[0], wardrobeContinuous: false }] } : lock) },
    plan,
    evidence,
    visualReviewFingerprint: review,
    finalMasterSha256: master,
  }),
  /expected true/,
  "a wardrobe continuity failure must never be softened into a pass",
);

assert.throws(
  () => assertCinematicFinalMasterQaEvidence({
    receipt: { ...receipt, claims: receipt.claims.slice(0, 1) },
    plan,
    evidence,
    visualReviewFingerprint: review,
    finalMasterSha256: master,
  }),
  /missing approved claim coverage/,
  "every approved claim must be tied to final-master frames",
);

assert.throws(
  () => assertCinematicFinalMasterQaEvidence({
    receipt: { ...receipt, payoffs: [] },
    plan,
    evidence,
    visualReviewFingerprint: review,
    finalMasterSha256: master,
  }),
  /at least 1|story payoff receipt/i,
  "a final master cannot pass from attractive locks and cuts alone when its opening question has no cited payoff evidence",
);

assert.throws(
  () => assertCinematicFinalMasterQaEvidence({
    receipt: { ...receipt, cuts: [{ ...receipt.cuts[0], tensionState: "release" }] },
    plan,
    evidence,
    visualReviewFingerprint: review,
    finalMasterSha256: master,
  }),
  /causal\/tension state/,
  "a visually attractive but wrongly paced cut cannot certify the planned tension turn",
);

assert.throws(
  () => assertCinematicFinalMasterQaEvidence({
    receipt: { ...receipt, cuts: [{ ...receipt.cuts[0], beforeFrameId: "f5", afterFrameId: "f4" }] },
    plan,
    evidence,
    visualReviewFingerprint: review,
    finalMasterSha256: master,
  }),
  /distinct before and after frames/,
  "a cut receipt cannot fake a causal transition by reversing its before/after evidence",
);

assert.throws(
  () => assertCinematicFinalMasterQaEvidence({
    receipt,
    plan,
    evidence: { ...evidence, coverage: { ...evidence.coverage, missingFocusFrameCount: 1 } },
    visualReviewFingerprint: review,
    finalMasterSha256: master,
  }),
  /complete focused cut coverage/,
  "partial focus evidence cannot certify a cinematic EDL",
);

const continuity = {
  castId: "mannequin-detective",
  faceless: true,
  noLikeness: true,
  silhouetteContinuous: true,
  wardrobeContinuous: true,
  paletteContinuous: true,
  keyPropContinuous: true,
  movementProfileContinuous: true,
} as const;

function approvedLockJudgement(firstFrameSec: number): string {
  const opening = firstFrameSec < 3;
  return JSON.stringify({
    pass: true,
    acceptedCriteria: opening ? ["faceless", "coat", "scarf", "file"] : ["faceless", "coat", "scarf", "reveal"],
    continuity: [continuity],
    claims: [{
      claimId: opening ? "claim-motive" : "claim-timeline",
      onScreenCitationVisible: true,
      visualSupportVisible: true,
      pass: true,
    }],
    storyPayoffs: opening ? [] : [{
      coldOpenBeatId: "cinematic-beat-opening",
      revealBeatId: "cinematic-beat-reveal",
      causalQuestionAnsweredOrReframed: true,
      onScreenCitationVisible: true,
      visualSupportVisible: true,
      pass: true,
    }],
  });
}

async function main(): Promise<void> {
  const reviewerCalls: Array<{ kind: "lock" | "cut"; frameIds: string[] }> = [];
  const nonGoogleReviewer: CinematicFinalMasterQaReviewer = async ({ kind, frames }) => {
    reviewerCalls.push({ kind, frameIds: frames.map((frame) => frame.id) });
    if (kind === "cut") {
      return JSON.stringify({
        pass: true,
        cutReason: "contradiction",
        tensionState: "reversal",
        causalTurnVisible: true,
        tensionTransitionVisible: true,
      });
    }
    return approvedLockJudgement(frames[0]?.tSec ?? Number.NaN);
  };

  const reviewedReceipt = await reviewCinematicFinalMasterQaEvidence({
    plan,
    evidence,
    framePaths: evidence.frames.map((frame) => `/tmp/cinematic-qa/${frame.id}.jpg`),
    visualReviewFingerprint: review,
    finalMasterSha256: master,
    reviewer: nonGoogleReviewer,
  });
  assert.equal(reviewedReceipt.pass, true, "an injected non-Google reviewer may certify an evidence-bound receipt");
  assert.deepEqual(
    reviewerCalls.map(({ kind, frameIds }) => ({ kind, frameCount: frameIds.length })),
    [{ kind: "lock", frameCount: 3 }, { kind: "lock", frameCount: 3 }, { kind: "cut", frameCount: 2 }],
    "the helper must review start/middle/end frames per lock and both sides of every cut",
  );
  assert.deepEqual(
    reviewedReceipt.claims.map((claim) => claim.claimId).sort(),
    ["claim-motive", "claim-timeline"],
    "the reviewer receipt must preserve all approved claims",
  );
  assert.equal(reviewedReceipt.cuts[0]?.tensionState, "reversal", "the cut attestation must preserve the planned tension turn");

  const incompleteReviewer: CinematicFinalMasterQaReviewer = async ({ kind, frames }) => {
    if (kind === "cut") {
      return JSON.stringify({
        pass: true,
        cutReason: "contradiction",
        tensionState: "reversal",
        causalTurnVisible: true,
        tensionTransitionVisible: true,
      });
    }
    return JSON.stringify({
      pass: true,
      acceptedCriteria: frames[0]?.tSec && frames[0].tSec < 3 ? ["faceless", "coat", "scarf", "file"] : ["faceless", "coat", "scarf", "reveal"],
      continuity: [continuity],
    });
  };
  await assert.rejects(
    reviewCinematicFinalMasterQaEvidence({
      plan,
      evidence,
      framePaths: evidence.frames.map((frame) => `/tmp/cinematic-qa/${frame.id}.jpg`),
      visualReviewFingerprint: review,
      finalMasterSha256: master,
      reviewer: incompleteReviewer,
    }),
    /claims|storyPayoffs/,
    "an incomplete lock judgement must fail closed before a receipt is created",
  );

  const payoffOmittingReviewer: CinematicFinalMasterQaReviewer = async ({ kind, frames }) => {
    if (kind === "cut") {
      return JSON.stringify({
        pass: true,
        cutReason: "contradiction",
        tensionState: "reversal",
        causalTurnVisible: true,
        tensionTransitionVisible: true,
      });
    }
    const judgement = JSON.parse(approvedLockJudgement(frames[0]?.tSec ?? Number.NaN));
    return JSON.stringify({ ...judgement, storyPayoffs: [] });
  };
  await assert.rejects(
    reviewCinematicFinalMasterQaEvidence({
      plan,
      evidence,
      framePaths: evidence.frames.map((frame) => `/tmp/cinematic-qa/${frame.id}.jpg`),
      visualReviewFingerprint: review,
      finalMasterSha256: master,
      reviewer: payoffOmittingReviewer,
    }),
    /payoffs|story payoff receipt/,
    "the final-master reviewer cannot silently omit the cited payoff for the opening question",
  );

  const malformedReviewer: CinematicFinalMasterQaReviewer = async () => "{not-json";
  await assert.rejects(
    reviewCinematicFinalMasterQaEvidence({
      plan,
      evidence,
      framePaths: evidence.frames.map((frame) => `/tmp/cinematic-qa/${frame.id}.jpg`),
      visualReviewFingerprint: review,
      finalMasterSha256: master,
      reviewer: malformedReviewer,
    }),
    /malformed JSON/,
    "a malformed reviewer response must fail closed before any final-master QA attestation",
  );

  console.log("cinematic final-master QA evidence contract test passed");
}

void main();
