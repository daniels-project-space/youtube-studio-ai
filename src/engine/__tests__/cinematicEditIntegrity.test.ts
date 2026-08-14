import assert from "node:assert/strict";
import { CINEMATIC_CASE_SEQUENCE_VERSION } from "@/engine/cinematicCaseSequence";
import {
  evaluateAuthoredShotEditIntegrity,
  evaluateCinematicEditIntegrity,
  CINEMATIC_EDIT_INTEGRITY_VERSION,
} from "@/engine/cinematicEditIntegrity";
import type { ShotRenderManifest } from "@/engine/renderArtifacts";
import {
  DEFAULT_SHOT_ANALYSIS_CONFIG,
  OPENCV_PYTHON_HEADLESS_VERSION,
  PYSCENEDETECT_HEADLESS_VERSION,
  type ShotAnalysisReceipt,
} from "@/lib/shotAnalysis";

const fingerprint = "a".repeat(64);
const analysis: ShotAnalysisReceipt = {
  schemaVersion: "1.0.0",
  provider: "pyscenedetect",
  detector: "adaptive",
  versions: { scenedetectHeadless: PYSCENEDETECT_HEADLESS_VERSION, opencvPythonHeadless: OPENCV_PYTHON_HEADLESS_VERSION },
  config: DEFAULT_SHOT_ANALYSIS_CONFIG,
  source: { sha256: "b".repeat(64), byteLength: 1_024 },
  scenes: [
    { startFrame: 0, endFrameExclusive: 150, startSec: 0, endSecExclusive: 5 },
    { startFrame: 150, endFrameExclusive: 240, startSec: 5, endSecExclusive: 8 },
    { startFrame: 240, endFrameExclusive: 330, startSec: 8, endSecExclusive: 11 },
    { startFrame: 330, endFrameExclusive: 420, startSec: 11, endSecExclusive: 14 },
  ],
};
const editDecisionList = {
  version: CINEMATIC_CASE_SEQUENCE_VERSION,
  sequenceFingerprint: fingerprint,
  durationSec: 6,
  edits: [
    { shotId: "cinematic-shot-one", t0: 0, t1: 3, cutReason: "new_fact" as const, tensionState: "question" as const, narrationPurpose: "Open." },
    { shotId: "cinematic-shot-two", t0: 3, t1: 6, cutReason: "contradiction" as const, tensionState: "reversal" as const, narrationPurpose: "Turn." },
    { shotId: "cinematic-shot-three", t0: 6, t1: 9, cutReason: "physical_action" as const, tensionState: "release" as const, narrationPurpose: "Resolve." },
  ],
};

const receipt = evaluateCinematicEditIntegrity({ editDecisionList, shotAnalysis: analysis, bodyOffsetSec: 5 });
assert.equal(receipt.version, CINEMATIC_EDIT_INTEGRITY_VERSION);
assert.equal(receipt.pass, true, "final-master markers at 5s and 8s should satisfy narration cuts shifted by a 5s intro");
assert.deepEqual(receipt.cuts.map((cut) => cut.expectedSec), [8, 11]);
assert.equal(receipt.matchedCutCount, 2);

const missed = evaluateCinematicEditIntegrity({
  editDecisionList,
  shotAnalysis: { ...analysis, scenes: analysis.scenes.slice(0, 2) },
  bodyOffsetSec: 5,
});
assert.equal(missed.pass, false, "a final master that omits a planned causal cut must not be called intact");
assert.equal(missed.cuts[1]?.matched, false);

const authored = {
  items: [
    { shotId: "shot-0001", t0: 0, t1: 3, clipKey: "a.mp4" },
    { shotId: "shot-0002", t0: 3, t1: 6, clipKey: "b.mp4" },
    { shotId: "shot-0003", t0: 6, t1: 9, clipKey: "c.mp4" },
  ],
} as ShotRenderManifest;
const authoredReceipt = evaluateAuthoredShotEditIntegrity({ manifest: authored, shotAnalysis: analysis, bodyOffsetSec: 5 });
assert.equal(authoredReceipt.pass, true, "the shared LTX render manifest must receive the same final-master cut proof");
assert.deepEqual(authoredReceipt.cuts.map((cut) => cut.expectedSec), [8, 11]);
assert.equal(authoredReceipt.planFingerprint.length, 64);

console.log("cinematic edit-integrity test passed");
