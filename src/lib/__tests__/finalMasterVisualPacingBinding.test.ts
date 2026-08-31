import assert from "node:assert/strict";

import { laneQualityPolicy } from "@/engine/contentLane";
import {
  assertFinalMasterVisualPacingBinding,
  createFinalMasterVisualPacingBinding,
  finalMasterVisualPacingBindingFingerprint,
} from "@/lib/finalMasterVisualPacingBinding";

const finalMaster = { sha256: "a".repeat(64), durationSec: 12 };
const visualReview = {
  reviewFingerprint: "review-123",
  reviewReceiptVersion: "video-review/v5",
  reviewReceiptFingerprint: "b".repeat(64),
  releaseReceiptFingerprint: "c".repeat(64),
};
const qualityEvidence = {
  bindingFingerprint: "d".repeat(64),
  qualityEvidenceFingerprint: "e".repeat(64),
};
const shortPolicy = laneQualityPolicy("short_form").visualPacing;

const passingShortPacing = {
  source: "ffmpeg/select-scene" as const,
  ran: true,
  usable: true,
  enforced: true,
  verdict: "pass" as const,
  signal: "scene_rhythm_observed" as const,
  durationSec: finalMaster.durationSec,
  policy: shortPolicy,
  changeTimestampsSec: [3, 6, 9],
  changeCount: 3,
  rawHoldIntervals: [
    { startSec: 0, endSec: 3, durationSec: 3 },
    { startSec: 3, endSec: 6, durationSec: 3 },
    { startSec: 6, endSec: 9, durationSec: 3 },
    { startSec: 9, endSec: 12, durationSec: 3 },
  ],
  evaluatedHoldIntervals: [
    { startSec: 0, endSec: 3, durationSec: 3 },
    { startSec: 3, endSec: 6, durationSec: 3 },
    { startSec: 6, endSec: 9, durationSec: 3 },
    { startSec: 9, endSec: 12, durationSec: 3 },
  ],
  excludedWindows: [],
  maxHoldSec: 3,
  medianHoldSec: 3,
  meetsPolicy: true,
};

const binding = createFinalMasterVisualPacingBinding({
  finalMaster,
  contentLane: { key: "short_form", renderer: "stock_footage" },
  visualReview,
  qualityEvidence,
  visualPacing: passingShortPacing,
});
assert.doesNotThrow(() => assertFinalMasterVisualPacingBinding({
  binding,
  finalMaster,
  visualReview,
  qualityEvidence,
}));

assert.throws(
  () => createFinalMasterVisualPacingBinding({
    finalMaster,
    contentLane: { key: "short_form", renderer: "stock_footage" },
    visualReview,
    qualityEvidence,
    visualPacing: { ...passingShortPacing, policy: laneQualityPolicy("cinematic_ai").visualPacing },
  }),
  /does not use the released lane policy/,
  "a receipt cannot claim a softer pacing policy than the released lane owns",
);

const { bindingFingerprint: _ignored, ...tamperedUnsigned } = structuredClone(binding);
void _ignored;
const reSignedWrongMaster = {
  ...tamperedUnsigned,
  finalMaster: { ...tamperedUnsigned.finalMaster, sha256: "f".repeat(64) },
} as Omit<typeof binding, "bindingFingerprint">;
const tamperedBinding = {
  ...reSignedWrongMaster,
  bindingFingerprint: finalMasterVisualPacingBindingFingerprint(reSignedWrongMaster),
};
assert.throws(
  () => assertFinalMasterVisualPacingBinding({
    binding: tamperedBinding,
    finalMaster,
    visualReview,
    qualityEvidence,
  }),
  /different released master/,
  "a self-fingerprinted pacing receipt cannot be replayed for different final-master bytes",
);

const ambientPolicy = laneQualityPolicy("ambient_guided").visualPacing;
assert.doesNotThrow(() => createFinalMasterVisualPacingBinding({
  finalMaster,
  contentLane: { key: "ambient_guided", renderer: "stock_footage" },
  visualReview,
  qualityEvidence,
  visualPacing: {
    ...passingShortPacing,
    policy: ambientPolicy,
    enforced: false,
    verdict: "not_required",
    signal: "pacing_exempt_static_visual_bed",
    changeTimestampsSec: [],
    changeCount: 0,
    rawHoldIntervals: [],
    evaluatedHoldIntervals: [],
    maxHoldSec: 0,
    medianHoldSec: 0,
    meetsPolicy: null,
  },
}), "ambient lanes retain an explicit policy exemption instead of faking a fast-cut measurement");

console.log("final-master visual-pacing binding tests passed");
