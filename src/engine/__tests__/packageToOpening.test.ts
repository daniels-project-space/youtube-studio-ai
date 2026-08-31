import assert from "node:assert/strict";

import {
  assertPackageToOpeningPlanBinding,
  assertPackageToOpeningReceiptCertificateBinding,
  createPackageToOpeningOmission,
  createPackageToOpeningPlan,
  createPackageToOpeningReceipt,
  packageToOpeningOpeningCriterion,
  PACKAGE_TO_OPENING_ANCHOR_CRITERION_ID,
  requireAutomaticPackageToOpeningReceipt,
} from "@/engine/packageToOpening";

const title = "Why the River Changed Course";
const thumbnailDescription = "A clear river delta at dawn, one bright red route marker, no text baked into the image, high contrast documentary composition.";
const topic = "How a river changed its course";
const route = { version: "narrated-stock/foundation/v1", family: "narrated_stock" };
const script = {
  hook: "At dawn, the river took a path nobody expected.",
  hookLoop: "The map says one thing. The river says another.",
};

const plan = createPackageToOpeningPlan({
  title,
  thumbnailDescription,
  topic,
  route,
  script,
  family: "narrated_stock",
  contentLane: { key: "narrated_documentary" },
});

assert.equal(plan.declaredPromiseAnchor.source, "script_hook_loop");
assert.equal(plan.plannedOpeningAnchor.source, "script_cold_open");
const openingCriterion = packageToOpeningOpeningCriterion({
  plan,
  topic,
  script,
  family: "narrated_stock",
  contentLane: { key: "narrated_documentary" },
});
assert.equal(openingCriterion.id, PACKAGE_TO_OPENING_ANCHOR_CRITERION_ID);
assert.match(openingCriterion.criterion, /At dawn, the river took a path nobody expected/);
assert.doesNotThrow(
  () => assertPackageToOpeningPlanBinding({
    plan,
    title,
    thumbnailDescription,
    topic,
    route,
    script,
    family: "narrated_stock",
    contentLane: { key: "narrated_documentary" },
  }),
  "the exact frozen package and opening inputs must rebind at the paid-thumbnail boundary",
);

assert.throws(
  () => assertPackageToOpeningPlanBinding({
    plan,
    title: `${title} (updated)`,
    thumbnailDescription,
    topic,
    route,
    script,
  }),
  /no longer matches the current package or opening inputs/,
  "a changed title must not reuse the pre-thumbnail promise plan",
);
assert.throws(
  () => assertPackageToOpeningPlanBinding({
    plan,
    title,
    thumbnailDescription,
    topic,
    route,
    script: { ...script, hook: "A substituted opening." },
  }),
  /no longer matches the current package or opening inputs/,
  "a regenerated cold open must not inherit an earlier package promise plan",
);

const visualReview = {
  reviewFingerprint: "review-v1",
  reviewReceiptVersion: "visual-review-release-receipt/v1",
  reviewReceiptFingerprint: "a".repeat(64),
  releaseReceiptFingerprint: "b".repeat(64),
  evidenceFrameArtifacts: [
    {
      id: "opening-frame",
      tSec: 3,
      r2Key: "owner/a/channel/b/runs/run-1/visual-review/opening.jpg",
      contentSha256: "c".repeat(64),
      byteLength: 123,
    },
    {
      id: "late-frame",
      tSec: 32,
      r2Key: "owner/a/channel/b/runs/run-1/visual-review/late.jpg",
      contentSha256: "d".repeat(64),
      byteLength: 124,
    },
  ],
};
const receipt = createPackageToOpeningReceipt({
  plan,
  finalMaster: { sha256: "e".repeat(64), durationSec: 60 },
  thumbnail: {
    r2Key: "owner/a/channel/b/runs/run-1/thumbnail.webp",
    sha256: "f".repeat(64),
    byteLength: 456,
  },
  visualReview,
});
assert.equal(receipt.structuralBinding, "verified");
assert.equal(receipt.reviewObservation, "not_measured");
assert.equal(receipt.visualReview.openingWitness.id, "opening-frame");
assert.doesNotThrow(
  () => assertPackageToOpeningReceiptCertificateBinding({
    receipt,
    finalMaster: { sha256: "e".repeat(64), durationSec: 60 },
    visualReview,
  }),
  "the receipt must bind the actual master and an existing durable opening review frame",
);
assert.throws(
  () => assertPackageToOpeningReceiptCertificateBinding({
    receipt,
    finalMaster: { sha256: "e".repeat(64), durationSec: 60 },
    visualReview: { ...visualReview, evidenceFrameArtifacts: [visualReview.evidenceFrameArtifacts[1]] },
  }),
  /opening witness is not retained/,
  "a certificate cannot retain an opening witness outside the final review artifact set",
);
assert.throws(
  () => createPackageToOpeningReceipt({
    plan,
    finalMaster: { sha256: "e".repeat(64), durationSec: 60 },
    thumbnail: {
      r2Key: "owner/a/channel/b/runs/run-1/thumbnail.webp",
      sha256: "f".repeat(64),
      byteLength: 456,
    },
    visualReview: { ...visualReview, evidenceFrameArtifacts: [visualReview.evidenceFrameArtifacts[1]] },
  }),
  /opening window/,
  "v1 must retain an explicit omission rather than pretending a late review frame proves the opening",
);

const measuredReceipt = createPackageToOpeningReceipt({
  plan,
  finalMaster: { sha256: "e".repeat(64), durationSec: 60 },
  thumbnail: {
    r2Key: "owner/a/channel/b/runs/run-1/thumbnail.webp",
    sha256: "f".repeat(64),
    byteLength: 456,
  },
  visualReview: {
    ...visualReview,
    referenceCriteria: [{
      id: PACKAGE_TO_OPENING_ANCHOR_CRITERION_ID,
      scope: "frame",
      verdict: "pass",
      evidenceFrameIds: ["opening-frame"],
    }],
  },
});
assert.equal(measuredReceipt.reviewObservation, "opening_anchor_measured");
assert.deepEqual(
  measuredReceipt.openingAnchorMeasurement?.evidenceFrames.map((frame) => frame.id),
  ["opening-frame"],
  "the semantic opening receipt may cite only retained opening-window evidence",
);
assert.throws(
  () => createPackageToOpeningReceipt({
    plan,
    finalMaster: { sha256: "e".repeat(64), durationSec: 60 },
    thumbnail: {
      r2Key: "owner/a/channel/b/runs/run-1/thumbnail.webp",
      sha256: "f".repeat(64),
      byteLength: 456,
    },
    visualReview: {
      ...visualReview,
      referenceCriteria: [{
        id: PACKAGE_TO_OPENING_ANCHOR_CRITERION_ID,
        scope: "frame",
        verdict: "pass",
        evidenceFrameIds: ["late-frame"],
      }],
    },
  }),
  /lacks a cited durable frame in the opening window/,
  "a semantic opening pass cannot cite a later frame",
);

const measuredReceiptWithTwoOpeningFrames = createPackageToOpeningReceipt({
  plan,
  finalMaster: { sha256: "e".repeat(64), durationSec: 60 },
  thumbnail: {
    r2Key: "owner/a/channel/b/runs/run-1/thumbnail.webp",
    sha256: "f".repeat(64),
    byteLength: 456,
  },
  visualReview: {
    ...visualReview,
    evidenceFrameArtifacts: [
      ...visualReview.evidenceFrameArtifacts,
      {
        id: "opening-support-frame",
        tSec: 8,
        r2Key: "owner/a/channel/b/runs/run-1/visual-review/opening-support.jpg",
        contentSha256: "9".repeat(64),
        byteLength: 125,
      },
    ],
    referenceCriteria: [{
      id: PACKAGE_TO_OPENING_ANCHOR_CRITERION_ID,
      scope: "frame",
      verdict: "pass",
      evidenceFrameIds: ["opening-frame", "opening-support-frame"],
    }],
  },
});
assert.throws(
  () => assertPackageToOpeningReceiptCertificateBinding({
    receipt: measuredReceiptWithTwoOpeningFrames,
    finalMaster: { sha256: "e".repeat(64), durationSec: 60 },
    visualReview,
  }),
  /opening-anchor evidence frame is not retained/,
  "a measured package receipt must retain every frame cited for the opening promise, not only its generic opening witness",
);

const omission = createPackageToOpeningOmission({
  reasonCode: "opening_review_frame_unavailable",
  planFingerprint: plan.planFingerprint,
});
assert.equal(omission.mode, "omitted");
assert.throws(
  () => requireAutomaticPackageToOpeningReceipt({ receipt }),
  /requires a final-master opening-anchor measurement/,
  "structural package evidence alone must not authorize an automatic release",
);
assert.doesNotThrow(
  () => requireAutomaticPackageToOpeningReceipt({ receipt: measuredReceipt }),
  "a measured, retained opening anchor authorizes the automatic release gate",
);
assert.throws(
  () => requireAutomaticPackageToOpeningReceipt({ receipt: undefined, omission }),
  /automatic release requires package-to-opening evidence; an omission is not sufficient/,
  "an automatic route cannot turn a missing opening witness into a publishable release",
);
assert.throws(
  () => requireAutomaticPackageToOpeningReceipt({ receipt: undefined }),
  /automatic release requires a final package-to-opening receipt/,
  "the automatic baseline fails closed when no package-opening evidence exists",
);

console.log("package-to-opening tests passed");
