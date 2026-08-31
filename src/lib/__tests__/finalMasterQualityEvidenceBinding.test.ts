import assert from "node:assert/strict";

import { buildQualityEvidence } from "@/engine/qualityEvidence";
import {
  FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  assertFinalMasterReleaseCertificate,
  createFinalMasterReleaseCertificate,
  createFinalMasterReleaseCertificateReference,
  finalMasterReleaseCertificateKey,
  visualReviewReleaseReceiptKey,
} from "@/lib/finalMasterReleaseCertificate";
import {
  assertFinalMasterQualityEvidenceBinding,
  createFinalMasterQualityEvidenceBinding,
  deriveFinalMasterQualityEvidenceCoverage,
  deriveFinalMasterStoryMeasurementCoverage,
  finalMasterQualityEvidenceBindingFingerprint,
  type FinalMasterQualityEvidenceBinding,
} from "@/lib/finalMasterQualityEvidenceBinding";

const master = { sha256: "a".repeat(64), durationSec: 120 };
const visualReview = {
  reviewFingerprint: "visual-review-fingerprint",
  reviewReceiptVersion: "visual-review-release-receipt/v1",
  reviewReceiptFingerprint: "b".repeat(64),
  releaseReceiptFingerprint: "c".repeat(64),
};
const lane = { key: "narrated_documentary", renderer: "stock_footage" };

function completeQualityEvidence() {
  return buildQualityEvidence({
    episode: {
      lane,
      topic: "How locks changed canal trade",
      story: {
        source: "story-spine/v1",
        beatCount: 4,
        shotCount: 8,
        coverageRatio: 1,
      },
    },
    technical: { passed: true, evaluator: "render-validator", evidence: ["master streams validated"] },
    visual: { passed: true, evaluator: "visual-review", evidence: ["durable review passed"] },
    temporal: { passed: true, evaluator: "timing-review", evidence: ["pacing policy passed"] },
    narrative: { passed: true, evaluator: "story-validator", evidence: ["beat coverage passed"] },
    audio: {
      score: 8.1,
      minimumScore: 7,
      evaluator: "audio-aesthetics",
      evidence: ["final-master audio review passed"],
    },
    brand: { passed: true, evaluator: "identity-grader", evidence: ["channel grammar passed"] },
  });
}

function resign(
  binding: FinalMasterQualityEvidenceBinding,
  changes: Partial<Omit<FinalMasterQualityEvidenceBinding, "bindingFingerprint">>,
): FinalMasterQualityEvidenceBinding {
  const { bindingFingerprint: _ignored, ...unsigned } = { ...binding, ...changes };
  void _ignored;
  return {
    ...unsigned,
    bindingFingerprint: finalMasterQualityEvidenceBindingFingerprint(unsigned),
  };
}

const qualityEvidence = completeQualityEvidence();
const binding = createFinalMasterQualityEvidenceBinding({
  finalMaster: master,
  visualReview,
  contentLane: lane,
  programRoute: {
    routeFingerprint: "d".repeat(64),
    family: "narrated_stock",
    contentLaneKey: lane.key,
  },
  qualityEvidence,
});

assert.equal(binding.evidenceCoverage, "complete");
assert.equal(binding.storyMeasurementCoverage, "scope_undeclared");
assert.equal(deriveFinalMasterStoryMeasurementCoverage(qualityEvidence), "scope_undeclared");
assert.equal(binding.qualityEvidence.axes.audio.status, "pass");
assert.equal(binding.programRoute?.routeFingerprint, "d".repeat(64));
assert.equal("assessment" in binding, false, "coverage is not a reference-quality or outcome assessment");
assert.doesNotThrow(() => assertFinalMasterQualityEvidenceBinding({
  binding,
  finalMasterSha256: master.sha256,
  finalMasterDurationSec: master.durationSec,
  visualReviewFingerprint: visualReview.reviewFingerprint,
  visualReviewReceiptVersion: visualReview.reviewReceiptVersion,
  visualReviewReceiptFingerprint: visualReview.reviewReceiptFingerprint,
  visualReviewReleaseReceiptFingerprint: visualReview.releaseReceiptFingerprint,
}));

assert.throws(
  () => assertFinalMasterQualityEvidenceBinding({
    binding,
    finalMasterSha256: "e".repeat(64),
    finalMasterDurationSec: master.durationSec,
    visualReviewFingerprint: visualReview.reviewFingerprint,
    visualReviewReceiptVersion: visualReview.reviewReceiptVersion,
    visualReviewReceiptFingerprint: visualReview.reviewReceiptFingerprint,
    visualReviewReleaseReceiptFingerprint: visualReview.releaseReceiptFingerprint,
  }),
  /different final master/,
  "binding cannot be reused for another final master",
);
assert.throws(
  () => assertFinalMasterQualityEvidenceBinding({
    binding,
    finalMasterSha256: master.sha256,
    finalMasterDurationSec: master.durationSec + 1,
    visualReviewFingerprint: visualReview.reviewFingerprint,
    visualReviewReceiptVersion: visualReview.reviewReceiptVersion,
    visualReviewReceiptFingerprint: visualReview.reviewReceiptFingerprint,
    visualReviewReleaseReceiptFingerprint: visualReview.releaseReceiptFingerprint,
  }),
  /different final master/,
  "binding cannot be reused for a master with different timing",
);
assert.throws(
  () => assertFinalMasterQualityEvidenceBinding({
    binding,
    finalMasterSha256: master.sha256,
    finalMasterDurationSec: master.durationSec,
    visualReviewFingerprint: visualReview.reviewFingerprint,
    visualReviewReceiptVersion: visualReview.reviewReceiptVersion,
    visualReviewReceiptFingerprint: visualReview.reviewReceiptFingerprint,
    visualReviewReleaseReceiptFingerprint: "e".repeat(64),
  }),
  /different visual-review receipt/,
  "binding cannot be reused with another visual-review receipt",
);
assert.throws(
  () => assertFinalMasterQualityEvidenceBinding({
    binding: resign(binding, {
      programRoute: { ...binding.programRoute!, contentLaneKey: "music_loop" },
    }),
    finalMasterSha256: master.sha256,
    finalMasterDurationSec: master.durationSec,
    visualReviewFingerprint: visualReview.reviewFingerprint,
    visualReviewReceiptVersion: visualReview.reviewReceiptVersion,
    visualReviewReceiptFingerprint: visualReview.reviewReceiptFingerprint,
    visualReviewReleaseReceiptFingerprint: visualReview.releaseReceiptFingerprint,
  }),
  /route does not match its content lane/,
  "a re-signed binding cannot move a route to a different lane",
);
assert.throws(
  () => assertFinalMasterQualityEvidenceBinding({
    binding: {
      ...binding,
      qualityEvidence: {
        ...binding.qualityEvidence,
        axes: {
          ...binding.qualityEvidence.axes,
          visual: { ...binding.qualityEvidence.axes.visual, evidence: ["substituted review"] },
        },
      },
    },
    finalMasterSha256: master.sha256,
    finalMasterDurationSec: master.durationSec,
    visualReviewFingerprint: visualReview.reviewFingerprint,
    visualReviewReceiptVersion: visualReview.reviewReceiptVersion,
    visualReviewReceiptFingerprint: visualReview.reviewReceiptFingerprint,
    visualReviewReleaseReceiptFingerprint: visualReview.releaseReceiptFingerprint,
  }),
  /binding fingerprint does not match/,
  "a quality receipt cannot be altered after sealing",
);

const partialQualityEvidence = buildQualityEvidence({
  episode: { lane, topic: "A partially reviewed master" },
  technical: { passed: true, evaluator: "render-validator", evidence: ["container valid"] },
});
assert.equal(deriveFinalMasterQualityEvidenceCoverage(partialQualityEvidence), "partial");
assert.equal(partialQualityEvidence.axes.audio.status, "not_measured");
assert.equal(partialQualityEvidence.axes.narrative.status, "not_measured");

const unmeasuredQualityEvidence = buildQualityEvidence({
  episode: { lane, topic: "A master with no evaluator receipts" },
});
assert.equal(deriveFinalMasterQualityEvidenceCoverage(unmeasuredQualityEvidence), "unmeasured");
assert.equal(unmeasuredQualityEvidence.axes.visual.status, "not_measured");

const keyPrefix = "owner/alice/channel/quality-evidence/";
const runId = "run-quality-evidence";
const frameKey = `${keyPrefix}runs/${runId}/visual-review/frames/f001.jpg`;
const evidenceManifestKey = `${keyPrefix}runs/${runId}/visual-review/manifest.json`;
const certificate = createFinalMasterReleaseCertificate({
  version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  finalMaster: {
    r2Key: `${keyPrefix}runs/${runId}/final.mp4`,
    ...master,
    byteLength: 1_024,
  },
  visualReview: {
    evidenceManifestKey,
    evidenceFrameKeys: [frameKey],
    evidenceFrameArtifacts: [{
      r2Key: frameKey,
      contentSha256: "f".repeat(64),
      byteLength: 128,
    }],
    receiptKey: visualReviewReleaseReceiptKey(keyPrefix, runId, visualReview.releaseReceiptFingerprint),
    ...visualReview,
  },
  qualityEvidence: binding,
});
assert.doesNotThrow(() => assertFinalMasterReleaseCertificate(certificate));
assert.throws(
  () => createFinalMasterReleaseCertificate({
    version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
    finalMaster: {
      r2Key: `${keyPrefix}runs/${runId}/mismatched-final.mp4`,
      ...master,
      byteLength: 1_024,
    },
    visualReview: {
      evidenceManifestKey,
      evidenceFrameKeys: [frameKey],
      evidenceFrameArtifacts: [{
        r2Key: frameKey,
        contentSha256: "f".repeat(64),
        byteLength: 128,
      }],
      receiptKey: visualReviewReleaseReceiptKey(keyPrefix, runId, visualReview.releaseReceiptFingerprint),
      ...visualReview,
    },
    qualityEvidence: resign(binding, {
      finalMaster: { ...master, sha256: "e".repeat(64) },
    }),
  }),
  /different final master/,
  "certificate creation fails rather than accepting a binding for other master bytes",
);

const certificateKey = finalMasterReleaseCertificateKey(
  keyPrefix,
  runId,
  certificate.certificateFingerprint,
);
const reference = createFinalMasterReleaseCertificateReference({
  keyPrefix,
  runId,
  certificateKey,
  certificate,
});
assert.deepEqual(reference.qualityEvidence, {
  bindingFingerprint: binding.bindingFingerprint,
  qualityEvidenceFingerprint: binding.qualityEvidenceFingerprint,
  evidenceCoverage: "complete",
  storyMeasurementCoverage: "scope_undeclared",
});

const legacyCertificate = createFinalMasterReleaseCertificate({
  version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  finalMaster: {
    r2Key: `${keyPrefix}runs/${runId}/legacy-final.mp4`,
    ...master,
    byteLength: 1_024,
  },
  visualReview: {
    evidenceManifestKey,
    evidenceFrameKeys: [frameKey],
    evidenceFrameArtifacts: [{
      r2Key: frameKey,
      contentSha256: "f".repeat(64),
      byteLength: 128,
    }],
    receiptKey: visualReviewReleaseReceiptKey(keyPrefix, runId, visualReview.releaseReceiptFingerprint),
    ...visualReview,
  },
});
assert.doesNotThrow(
  () => assertFinalMasterReleaseCertificate(legacyCertificate),
  "a certificate without the new optional binding remains readable",
);

console.log("final-master quality-evidence binding tests passed");
