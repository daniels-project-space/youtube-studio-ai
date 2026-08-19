import assert from "node:assert/strict";
import {
  assertCinematicClipReview,
  CINEMATIC_CLIP_REVIEW_VERSION,
} from "@/engine/cinematicClipReview";

const receipt = {
  version: CINEMATIC_CLIP_REVIEW_VERSION,
  reviewer: "non_google_vision" as const,
  sceneId: "cinematic-shot-railway-1",
  sampleOffsetsSec: [0.25, 2.5, 4.75],
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
}).sceneId, receipt.sceneId);
assert.throws(() => assertCinematicClipReview({ ...receipt, motionIntegrity: 0.2 }, {
  sceneId: receipt.sceneId,
  sampleOffsetsSec: receipt.sampleOffsetsSec,
  terminalStillKey: receipt.terminalStillKey,
}), /motion integrity/);
assert.throws(() => assertCinematicClipReview({ ...receipt, terminalFrameAlignment: 0.2 }, {
  sceneId: receipt.sceneId,
  sampleOffsetsSec: receipt.sampleOffsetsSec,
  terminalStillKey: receipt.terminalStillKey,
}), /terminal-frame alignment/);
assert.throws(() => assertCinematicClipReview({ ...receipt, sampleOffsetsSec: [0.2, 2.5, 4.75] }, {
  sceneId: receipt.sceneId,
  sampleOffsetsSec: receipt.sampleOffsetsSec,
}), /sample lineage/);
