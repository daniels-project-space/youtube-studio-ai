import assert from "node:assert/strict";

import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import {
  channelProgramRouteRunSeed,
  channelProgramRouteRunSeedFingerprint,
  resolveChannelProgramRoute,
} from "@/engine/channelProgramRoute";
import { referenceQualityContractFor } from "@/engine/creative/referenceQuality";
import {
  assertReferenceQualityMechanicsLedger,
  createReferenceQualityMechanicsLedger,
  referenceQualityMechanicsLedgerFingerprint,
} from "@/engine/referenceQualityMechanicsRegistry";
import { buildQualityEvidence } from "@/engine/qualityEvidence";
import {
  FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  assertFinalMasterReleaseCertificate,
  createFinalMasterReleaseCertificate,
  createVisualReviewReleaseReceipt,
  visualReviewReleaseReceiptKey,
} from "@/lib/finalMasterReleaseCertificate";
import { createFinalMasterQualityEvidenceBinding } from "@/lib/finalMasterQualityEvidenceBinding";
import { createUnmeasuredReferenceQualityFinalMasterBinding } from "@/lib/referenceQualityFinalMasterBinding";

const finalMaster = { sha256: "a".repeat(64), durationSec: 3_600 };
const programBrief = createChannelProgramBrief({
  family: "music_loop",
  nicheKey: "lofi",
  locale: "en",
  concept: "An original instrumental focus loop with a calm, repeatable visual grammar.",
});
const routeSeed = channelProgramRouteRunSeed({
  route: resolveChannelProgramRoute(programBrief),
  programBrief,
});
const reviewReceipt = createVisualReviewReleaseReceipt({
  reviewFingerprint: "b".repeat(64),
  reviewReceiptVersion: "video-review/v5",
  reviewReceiptFingerprint: "c".repeat(64),
  verdict: "pass",
  summary: "The retained final-master review passed.",
  defects: [],
  focusWindows: [],
  referenceCriteria: [],
  referenceCriteriaComplete: true,
  evidence: {
    source: finalMaster,
    manifestKey: "owner/alice/runs/music-mechanics/visual-review/manifest.json",
    frameKeys: ["owner/alice/runs/music-mechanics/visual-review/frames/f001.jpg"],
    frameArtifacts: [{
      r2Key: "owner/alice/runs/music-mechanics/visual-review/frames/f001.jpg",
      contentSha256: "d".repeat(64),
      byteLength: 128,
    }],
  },
});
const lane = { key: "music_loop", renderer: "loop_clips" };
const qualityEvidence = buildQualityEvidence({
  episode: { lane, topic: "Late-night focus: slow electric piano" },
  audio: {
    score: 8.4,
    minimumScore: 7,
    evaluator: "final-master-audio-aesthetics",
    evidence: ["final master is continuous and meets the declared loudness standard"],
  },
});
const qualityBinding = createFinalMasterQualityEvidenceBinding({
  finalMaster,
  visualReview: {
    reviewFingerprint: reviewReceipt.reviewFingerprint,
    reviewReceiptVersion: reviewReceipt.reviewReceiptVersion,
    reviewReceiptFingerprint: reviewReceipt.reviewReceiptFingerprint,
    releaseReceiptFingerprint: reviewReceipt.releaseReceiptFingerprint,
  },
  contentLane: lane,
  programRoute: {
    routeFingerprint: routeSeed.routeFingerprint,
    family: routeSeed.family,
    contentLaneKey: routeSeed.contentLaneKey,
    programBriefFingerprint: routeSeed.programBriefFingerprint,
    routeSeedFingerprint: channelProgramRouteRunSeedFingerprint(routeSeed),
  },
  qualityEvidence,
});
const referenceQualityBinding = createUnmeasuredReferenceQualityFinalMasterBinding({
  contract: referenceQualityContractFor("music_loop"),
  finalMasterSha256: finalMaster.sha256,
  visualReviewFingerprint: reviewReceipt.reviewFingerprint,
  visualReviewReceiptFingerprint: reviewReceipt.reviewReceiptFingerprint,
});

const ledgerWithoutQualityBinding = createReferenceQualityMechanicsLedger({
  route: routeSeed,
  finalMaster,
  visualRelease: reviewReceipt,
  referenceQualityBinding,
});
assert.equal(
  ledgerWithoutQualityBinding.evidence.find((item) => item.requirementId === "audio-continuity")?.measurementState,
  "unmeasured",
  "a generic visual review or static reference contract cannot imply music audio continuity",
);

const ledger = createReferenceQualityMechanicsLedger({
  route: routeSeed,
  finalMaster,
  visualRelease: reviewReceipt,
  referenceQualityBinding,
  finalMasterQualityEvidenceBinding: qualityBinding,
});
const audioContinuity = ledger.evidence.find((item) => item.requirementId === "audio-continuity");
assert.deepEqual(
  audioContinuity && {
    measurementState: audioContinuity.measurementState,
    proofScope: audioContinuity.measurementState === "measured" ? audioContinuity.proofScope : undefined,
    proofKind: audioContinuity.measurementState === "measured" ? audioContinuity.proofKind : undefined,
  },
  {
    measurementState: "measured",
    proofScope: "final_master",
    proofKind: "final-master-ambient-audio-quality/v1",
  },
  "only the exact sealed, passing final-master audio axis measures music continuity",
);
assert.equal(ledger.assessment, "partially_measured", "unmeasured rhythm and presentation facts remain honest");

const { ledgerFingerprint: _ignored, ...tamperedUnsigned } = structuredClone(ledger);
void _ignored;
const tampered = {
  ...tamperedUnsigned,
  evidence: tamperedUnsigned.evidence.map((item) =>
    item.requirementId === "audio-continuity" && item.measurementState === "measured"
      ? { ...item, proofFingerprint: "e".repeat(64) }
      : item,
  ),
} as Omit<typeof ledger, "ledgerFingerprint">;
const reSignedTampered = {
  ...tampered,
  ledgerFingerprint: referenceQualityMechanicsLedgerFingerprint(tampered),
};
assert.throws(
  () => assertReferenceQualityMechanicsLedger({
    ledger: reSignedTampered,
    referenceQualityBinding,
    finalMasterQualityEvidenceBinding: qualityBinding,
  }),
  /ambient audio continuity proof does not match/,
  "a self-fingerprinted ledger cannot substitute an ambient audio proof",
);

const sleepBrief = createChannelProgramBrief({
  family: "sleep",
  nicheKey: "lifestyle",
  locale: "en",
  concept: "A gentle, original night soundscape with a stable visual rhythm.",
});
const sleepRouteSeed = channelProgramRouteRunSeed({
  route: resolveChannelProgramRoute(sleepBrief),
  programBrief: sleepBrief,
});
const sleepLane = { key: "ambient_guided", renderer: "stock_footage" };
const sleepQualityBinding = createFinalMasterQualityEvidenceBinding({
  finalMaster,
  visualReview: {
    reviewFingerprint: reviewReceipt.reviewFingerprint,
    reviewReceiptVersion: reviewReceipt.reviewReceiptVersion,
    reviewReceiptFingerprint: reviewReceipt.reviewReceiptFingerprint,
    releaseReceiptFingerprint: reviewReceipt.releaseReceiptFingerprint,
  },
  contentLane: sleepLane,
  programRoute: {
    routeFingerprint: sleepRouteSeed.routeFingerprint,
    family: sleepRouteSeed.family,
    contentLaneKey: sleepRouteSeed.contentLaneKey,
    programBriefFingerprint: sleepRouteSeed.programBriefFingerprint,
    routeSeedFingerprint: channelProgramRouteRunSeedFingerprint(sleepRouteSeed),
  },
  qualityEvidence: buildQualityEvidence({
    episode: { lane: sleepLane, topic: "Deep sleep: steady rain and distant thunder" },
    audio: {
      score: 8.2,
      minimumScore: 7,
      evaluator: "final-master-audio-aesthetics",
      evidence: ["final master has continuous audio and meets the declared loudness standard"],
    },
  }),
});
const sleepReferenceQualityBinding = createUnmeasuredReferenceQualityFinalMasterBinding({
  contract: referenceQualityContractFor("sleep"),
  finalMasterSha256: finalMaster.sha256,
  visualReviewFingerprint: reviewReceipt.reviewFingerprint,
  visualReviewReceiptFingerprint: reviewReceipt.reviewReceiptFingerprint,
});
const sleepLedger = createReferenceQualityMechanicsLedger({
  route: sleepRouteSeed,
  finalMaster,
  visualRelease: reviewReceipt,
  referenceQualityBinding: sleepReferenceQualityBinding,
  finalMasterQualityEvidenceBinding: sleepQualityBinding,
});
const sleepAudioContinuity = sleepLedger.evidence.find((item) => item.requirementId === "audio-continuity");
assert.deepEqual(
  sleepAudioContinuity && {
    measurementState: sleepAudioContinuity.measurementState,
    proofKind: sleepAudioContinuity.measurementState === "measured"
      ? sleepAudioContinuity.proofKind
      : undefined,
  },
  { measurementState: "measured", proofKind: "final-master-ambient-audio-quality/v1" },
  "a passing, route-bound final-master audio axis measures sleep continuity without pretending it is narration",
);

const keyPrefix = "owner/alice/";
const runId = "music-mechanics";
const certificate = createFinalMasterReleaseCertificate({
  version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  finalMaster: {
    r2Key: `${keyPrefix}runs/${runId}/final.mp4`,
    ...finalMaster,
    byteLength: 4_096,
  },
  visualReview: {
    evidenceManifestKey: reviewReceipt.evidence.manifestKey,
    evidenceFrameKeys: reviewReceipt.evidence.frameKeys,
    evidenceFrameArtifacts: reviewReceipt.evidence.frameArtifacts,
    receiptKey: visualReviewReleaseReceiptKey(keyPrefix, runId, reviewReceipt.releaseReceiptFingerprint),
    reviewFingerprint: reviewReceipt.reviewFingerprint,
    reviewReceiptVersion: reviewReceipt.reviewReceiptVersion,
    reviewReceiptFingerprint: reviewReceipt.reviewReceiptFingerprint,
    releaseReceiptFingerprint: reviewReceipt.releaseReceiptFingerprint,
  },
  qualityEvidence: qualityBinding,
  referenceQuality: referenceQualityBinding,
  referenceQualityMechanics: ledger,
});
assert.doesNotThrow(() => assertFinalMasterReleaseCertificate(certificate));
assert.throws(
  () => createFinalMasterReleaseCertificate({
    version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
    finalMaster: {
      r2Key: `${keyPrefix}runs/${runId}/tampered-final.mp4`,
      ...finalMaster,
      byteLength: 4_096,
    },
    visualReview: {
      evidenceManifestKey: reviewReceipt.evidence.manifestKey,
      evidenceFrameKeys: reviewReceipt.evidence.frameKeys,
      evidenceFrameArtifacts: reviewReceipt.evidence.frameArtifacts,
      receiptKey: visualReviewReleaseReceiptKey(keyPrefix, runId, reviewReceipt.releaseReceiptFingerprint),
      reviewFingerprint: reviewReceipt.reviewFingerprint,
      reviewReceiptVersion: reviewReceipt.reviewReceiptVersion,
      reviewReceiptFingerprint: reviewReceipt.reviewReceiptFingerprint,
      releaseReceiptFingerprint: reviewReceipt.releaseReceiptFingerprint,
    },
    qualityEvidence: qualityBinding,
    referenceQuality: referenceQualityBinding,
    referenceQualityMechanics: reSignedTampered,
  }),
  /ambient audio continuity proof does not match/,
  "certificate creation repeats the exact final-master ambient proof verification",
);

console.log("reference-quality music audio evidence tests passed");
