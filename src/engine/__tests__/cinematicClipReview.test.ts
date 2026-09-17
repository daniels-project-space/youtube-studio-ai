import assert from "node:assert/strict";
import {
  assertCinematicClipReview,
  CINEMATIC_CLIP_REVIEW_VERSION,
  MINIMAX_H3_OPENING_MOTION_QA_CONTRACT,
} from "@/engine/cinematicClipReview";

const receipt = {
  version: CINEMATIC_CLIP_REVIEW_VERSION,
  reviewer: "non_google_vision" as const,
  sceneId: "cinematic-shot-railway-1",
  sampleOffsetsSec: [0.25, 2.5, 4.75],
  expectedCastIds: ["mannequin-investigator"],
  forbidAdditionalPeople: true as const,
  onlyExpectedCastVisible: true as const,
  openingMotion: {
    contract: MINIMAX_H3_OPENING_MOTION_QA_CONTRACT,
    source: "ffmpeg/freezedetect" as const,
    verdict: "pass" as const,
    durationSec: 5,
    maxFreezeFraction: 0.1,
    maxStaticHoldSec: 0.5,
    maxOpeningFrozenHoldSec: 0.25,
    maxFrozenHoldSec: 0,
    openingFrozenHoldSec: 0,
    frozenIntervals: [],
    violatingIntervals: [],
  },
  semanticAlignment: 0.9,
  motionIntegrity: 0.9,
  continuity: 0.9,
  endBeat: 0.9,
  artifactFree: 0.9,
  terminalStillKey: "cinematic/railway-1-terminal.png",
  terminalFrameAlignment: 0.9,
  textWatermarkFree: true as const,
  pass: true as const,
  notes: ["The coat, timetable, station light, and dolly movement stay consistent through the end frame."],
};

assert.equal(assertCinematicClipReview(receipt, {
  sceneId: receipt.sceneId,
  sampleOffsetsSec: receipt.sampleOffsetsSec,
  terminalStillKey: receipt.terminalStillKey,
  expectedCastIds: receipt.expectedCastIds,
  forbidAdditionalPeople: true,
}).sceneId, receipt.sceneId);
assert.throws(() => assertCinematicClipReview({ ...receipt, motionIntegrity: 0.2 }, {
  sceneId: receipt.sceneId,
  sampleOffsetsSec: receipt.sampleOffsetsSec,
  terminalStillKey: receipt.terminalStillKey,
  expectedCastIds: receipt.expectedCastIds,
  forbidAdditionalPeople: true,
}), /motion integrity/);
assert.throws(() => assertCinematicClipReview({ ...receipt, terminalFrameAlignment: 0.2 }, {
  sceneId: receipt.sceneId,
  sampleOffsetsSec: receipt.sampleOffsetsSec,
  terminalStillKey: receipt.terminalStillKey,
  expectedCastIds: receipt.expectedCastIds,
  forbidAdditionalPeople: true,
}), /terminal-frame alignment/);
assert.throws(() => assertCinematicClipReview({ ...receipt, sampleOffsetsSec: [0.2, 2.5, 4.75] }, {
  sceneId: receipt.sceneId,
  sampleOffsetsSec: receipt.sampleOffsetsSec,
  expectedCastIds: receipt.expectedCastIds,
  forbidAdditionalPeople: true,
}), /sample lineage/);
assert.throws(() => assertCinematicClipReview({ ...receipt, expectedCastIds: ["mannequin-unapproved"] }, {
  sceneId: receipt.sceneId,
  sampleOffsetsSec: receipt.sampleOffsetsSec,
  terminalStillKey: receipt.terminalStillKey,
  expectedCastIds: receipt.expectedCastIds,
  forbidAdditionalPeople: true,
}), /cast contract/, "an undeclared extra mannequin cannot receive a moving-clip receipt");
assert.throws(() => assertCinematicClipReview({
  ...receipt,
  openingMotion: { ...receipt.openingMotion, openingFrozenHoldSec: 0.5 },
}, {
  sceneId: receipt.sceneId,
  sampleOffsetsSec: receipt.sampleOffsetsSec,
  terminalStillKey: receipt.terminalStillKey,
  expectedCastIds: receipt.expectedCastIds,
  forbidAdditionalPeople: true,
}), /opening remained static/, "a static H3 opening cannot receive a moving-clip receipt");
