import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  assertShortsOpeningEvidence,
  assertShortsOpeningEvidenceCertificateBinding,
  createShortsOpeningEvidence,
  planShortsOpeningCaptionEvidence,
} from "@/engine/shortsOpeningEvidence";
import {
  FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  assertFinalMasterReleaseCertificate,
  createFinalMasterReleaseCertificate,
} from "@/lib/finalMasterReleaseCertificate";
import {
  ON_SCREEN_TEXT_PROOF_VERSION,
  TESSERACT_LANGUAGE,
  TESSERACT_PAGE_SEGMENTATION_MODE,
  type OnScreenTextProof,
} from "@/lib/onScreenTextProof";
import {
  VISUAL_REVIEW_VERSION,
  type VisualReviewResult,
} from "@/lib/visualReview";

const masterSha256 = "a".repeat(64);
const text = "A clear opening hook";
const textSha256 = createHash("sha256").update(text, "utf8").digest("hex");
const captionPlan = planShortsOpeningCaptionEvidence([
  { startSec: 0, endSec: 1, text },
  { startSec: 1, endSec: 2.5, text: "Keeps attention moving" },
], 20);
assert(captionPlan, "timed captions must produce a first opening plan");

const onScreenText: OnScreenTextProof = {
  version: ON_SCREEN_TEXT_PROOF_VERSION,
  engine: {
    name: "tesseract" as const,
    version: "5.4.0",
    language: TESSERACT_LANGUAGE,
    pageSegmentationMode: TESSERACT_PAGE_SEGMENTATION_MODE,
  },
  source: { sha256: masterSha256, byteLength: 1_024 },
  cues: [{
    id: "short-caption-001",
    sampleSec: 0.5,
    expectedTextSha256: textSha256,
    expectedTokenCount: 4,
    recognizedText: text,
    recognizedTokenCount: 4,
    tokenCoverage: 1,
    minTokenCoverage: 0.8,
    passed: true,
  }],
  passed: true,
};

const review: Pick<
  VisualReviewResult,
  "ran" | "verdict" | "referenceCriteriaComplete" | "evidence" |
    "reviewFingerprint" | "reviewReceiptVersion" | "reviewReceiptFingerprint" | "sceneChangeTimes"
> = {
  ran: true,
  verdict: "pass" as const,
  referenceCriteriaComplete: true,
  evidence: {
    version: VISUAL_REVIEW_VERSION,
    source: { sha256: masterSha256, durationSec: 20 },
    frames: [
      {
        id: "f-caption",
        tSec: 0.1,
        r2Key: "owner/alice/runs/short/visual-review/frames/f-caption.jpg",
        contentSha256: "b".repeat(64),
        byteLength: 101,
        selectionReasons: ["overlay", "focus"],
      },
      {
        id: "f-scene",
        tSec: 1.2,
        r2Key: "owner/alice/runs/short/visual-review/frames/f-scene.jpg",
        contentSha256: "c".repeat(64),
        byteLength: 102,
        selectionReasons: ["scene"],
      },
    ],
    coverage: {
      maxGapSec: 1,
      maxAllowedGapSec: 1,
      focusedWindows: [],
    },
  },
  reviewFingerprint: "short-review-fingerprint",
  reviewReceiptVersion: "visual-review-receipt/v1",
  reviewReceiptFingerprint: "d".repeat(64),
  sceneChangeTimes: [4.4, 1.23],
};

const receipt = createShortsOpeningEvidence({
  finalMaster: { sha256: masterSha256, durationSec: 20 },
  review,
  visualReviewReleaseReceiptFingerprint: "e".repeat(64),
  caption: captionPlan,
  onScreenText,
});
assert.equal(receipt.firstSemanticVisual.tSec, 0);
assert.equal(receipt.firstSemanticVisual.reviewFrame.id, "f-caption");
assert.equal(receipt.firstHookOnScreenText?.tSec, 0);
assert.equal(receipt.firstHookOnScreenText?.endSec, 1);
assert.equal(receipt.firstVisualMotionChange.tSec, 1.23);
assert.equal(receipt.firstVisualMotionChange.reviewFrame.id, "f-scene");
assert.doesNotThrow(() => assertShortsOpeningEvidence(receipt));

assert.doesNotThrow(() => assertShortsOpeningEvidenceCertificateBinding({
  evidence: receipt,
  finalMaster: { sha256: masterSha256, durationSec: 20 },
  visualReview: {
    reviewFingerprint: review.reviewFingerprint,
    reviewReceiptVersion: review.reviewReceiptVersion,
    reviewReceiptFingerprint: review.reviewReceiptFingerprint,
    releaseReceiptFingerprint: "e".repeat(64),
    evidenceFrameArtifacts: review.evidence.frames.map((frame) => ({
      id: frame.id,
      tSec: frame.tSec,
      r2Key: frame.r2Key,
      contentSha256: frame.contentSha256,
      byteLength: frame.byteLength,
    })),
  },
  onScreenText,
}));

const certificate = createFinalMasterReleaseCertificate({
  version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  finalMaster: {
    r2Key: "owner/alice/runs/short/short.mp4",
    sha256: masterSha256,
    byteLength: 4_096,
    durationSec: 20,
  },
  visualReview: {
    evidenceManifestKey: "owner/alice/runs/short/visual-review/manifest.json",
    evidenceFrameKeys: review.evidence.frames.map((frame) => frame.r2Key!),
    evidenceFrameArtifacts: review.evidence.frames.map((frame) => ({
      id: frame.id,
      tSec: frame.tSec,
      r2Key: frame.r2Key!,
      contentSha256: frame.contentSha256!,
      byteLength: frame.byteLength!,
    })),
    receiptKey: "owner/alice/runs/short/visual-review/receipts/review.json",
    reviewFingerprint: review.reviewFingerprint,
    reviewReceiptVersion: review.reviewReceiptVersion,
    reviewReceiptFingerprint: review.reviewReceiptFingerprint,
    releaseReceiptFingerprint: "e".repeat(64),
  },
  onScreenText,
  shortsOpeningEvidence: receipt,
});
assert.doesNotThrow(
  () => assertFinalMasterReleaseCertificate(certificate),
  "the Short-only opening receipt must be cryptographically bound into its final certificate",
);
const { certificateFingerprint: _shortCertificateFingerprint, ...shortCertificateInput } = certificate;
void _shortCertificateFingerprint;
assert.throws(
  () => createFinalMasterReleaseCertificate({
    ...shortCertificateInput,
    visualReview: {
      ...certificate.visualReview,
      evidenceFrameArtifacts: certificate.visualReview.evidenceFrameArtifacts!.map((frame) =>
        frame.id === "f-scene" ? { ...frame, tSec: 1.5 } : frame,
      ),
    },
  }),
  /visual\/motion frame is absent/,
  "certificate creation must reject a Short opening receipt whose reviewed motion frame was replaced",
);

assert.throws(
  () => createShortsOpeningEvidence({
    finalMaster: { sha256: masterSha256, durationSec: 20 },
    review: { ...review, sceneChangeTimes: [] },
    visualReviewReleaseReceiptFingerprint: "e".repeat(64),
    caption: captionPlan,
    onScreenText,
  }),
  /lacks an existing thresholded visual\/motion change/,
  "a static/unknown scene detector result must not invent a first motion timing",
);

assert.throws(
  () => createShortsOpeningEvidence({
    finalMaster: { sha256: masterSha256, durationSec: 20 },
    review: {
      ...review,
      evidence: {
        ...review.evidence,
        frames: review.evidence.frames.map((frame) =>
          frame.id === "f-scene" ? { ...frame, selectionReasons: ["focus"] } : frame,
        ),
      },
    },
    visualReviewReleaseReceiptFingerprint: "e".repeat(64),
    caption: captionPlan,
    onScreenText,
  }),
  /lacks a durable review frame for the first detected visual\/motion change/,
  "a detector time without a retained reviewed scene frame is not certificate authority",
);

assert.throws(
  () => createShortsOpeningEvidence({
    finalMaster: { sha256: masterSha256, durationSec: 20 },
    review: {
      ...review,
      evidence: {
        ...review.evidence,
        frames: review.evidence.frames.map((frame) =>
          frame.id === "f-caption" ? { ...frame, selectionReasons: ["focus"] } : frame,
        ),
      },
    },
    visualReviewReleaseReceiptFingerprint: "e".repeat(64),
    caption: captionPlan,
    onScreenText,
  }),
  /lacks a durable reviewed overlay frame/,
  "a caption plan without a reviewer-selected overlay frame must fail closed",
);

assert.throws(
  () => assertShortsOpeningEvidenceCertificateBinding({
    evidence: receipt,
    finalMaster: { sha256: masterSha256, durationSec: 20 },
    visualReview: {
      reviewFingerprint: review.reviewFingerprint,
      reviewReceiptVersion: review.reviewReceiptVersion,
      reviewReceiptFingerprint: review.reviewReceiptFingerprint,
      releaseReceiptFingerprint: "e".repeat(64),
      evidenceFrameArtifacts: [
        { ...review.evidence.frames[0], r2Key: "owner/alice/runs/short/visual-review/frames/forged.jpg" },
        review.evidence.frames[1],
      ],
    },
    onScreenText,
  }),
  /semantic visual frame is absent/,
  "a certificate cannot relabel a different durable review frame as the opening anchor",
);

const transcriptOnly = createShortsOpeningEvidence({
  finalMaster: { sha256: masterSha256, durationSec: 20 },
  review: {
    ...review,
    evidence: {
      ...review.evidence,
      frames: [
        { ...review.evidence.frames[0], id: "f-cue", selectionReasons: ["cue"] },
        review.evidence.frames[1],
      ],
    },
  },
  visualReviewReleaseReceiptFingerprint: "e".repeat(64),
});
assert.equal(transcriptOnly.firstSemanticVisual.source, "transcript_cue");
assert.equal(transcriptOnly.firstHookOnScreenText, undefined, "text timing remains absent when no timed text authority exists");

assert.throws(
  () => planShortsOpeningCaptionEvidence([
    { startSec: 0, endSec: 1, text },
    { startSec: 0, endSec: 2, text: "Ambiguous opening caption" },
  ], 20),
  /ambiguous first caption timing/,
  "two equally early text cues must not be arbitrarily ordered into a hook receipt",
);

console.log("Shorts opening evidence tests passed");
