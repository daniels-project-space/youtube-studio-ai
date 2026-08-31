import assert from "node:assert/strict";

import {
  channelProgramRouteRunSeed,
  channelProgramRouteRunSeedFingerprint,
  resolveChannelProgramRoute,
} from "@/engine/channelProgramRoute";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { createReferenceQualityMechanicsLedger } from "@/engine/referenceQualityMechanicsRegistry";
import { syntheticScenarioContract } from "@/engine/syntheticScenario";
import { buildQualityEvidence } from "@/engine/qualityEvidence";
import {
  FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  assertFinalMasterReleaseCertificate,
  createFinalMasterReleaseCertificate,
  createVisualReviewReleaseReceipt,
  visualReviewReleaseReceiptKey,
} from "@/lib/finalMasterReleaseCertificate";
import { createFinalMasterQualityEvidenceBinding } from "@/lib/finalMasterQualityEvidenceBinding";

const programBrief = createChannelProgramBrief({
  family: "illustrated_explainer",
  nicheKey: "educational",
  locale: "en",
  concept: "A disclosed fictional decision laboratory with an original educational viewer promise.",
  programIntent: { kind: "fictional_scenario", profile: "ai_decision" },
});
const route = resolveChannelProgramRoute(programBrief);
const routeSeed = channelProgramRouteRunSeed({ route, programBrief });
const finalMaster = { sha256: "a".repeat(64), durationSec: 72 };
const reviewReceipt = createVisualReviewReleaseReceipt({
  reviewFingerprint: "b".repeat(64),
  reviewReceiptVersion: "video-review/v5",
  reviewReceiptFingerprint: "c".repeat(64),
  verdict: "pass",
  summary: "The retained visual review passed.",
  defects: [],
  focusWindows: [],
  referenceCriteria: [],
  referenceCriteriaComplete: true,
  evidence: {
    source: finalMaster,
    manifestKey: "owner/alice/runs/mechanics-certificate/visual-review/manifest.json",
    frameKeys: ["owner/alice/runs/mechanics-certificate/visual-review/frames/f001.jpg"],
    frameArtifacts: [{
      r2Key: "owner/alice/runs/mechanics-certificate/visual-review/frames/f001.jpg",
      contentSha256: "d".repeat(64),
      byteLength: 128,
    }],
  },
});
const mechanics = createReferenceQualityMechanicsLedger({
  route: routeSeed,
  finalMaster,
  visualRelease: reviewReceipt,
  syntheticScenario: syntheticScenarioContract("ai_decision"),
});
const lane = { key: routeSeed.contentLaneKey, renderer: "illustrated_explainer" };
const qualityEvidence = buildQualityEvidence({
  episode: { lane, topic: "A fictional city makes one difficult water-allocation choice" },
  technical: { passed: true, evaluator: "render-validator", evidence: ["master streams are valid"] },
});

function qualityBinding(routeSeedFingerprint = channelProgramRouteRunSeedFingerprint(routeSeed)) {
  return createFinalMasterQualityEvidenceBinding({
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
      routeSeedFingerprint,
    },
    qualityEvidence,
  });
}

function certificateInput(binding = qualityBinding()) {
  return {
    version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
    finalMaster: {
      r2Key: "owner/alice/runs/mechanics-certificate/final.mp4",
      ...finalMaster,
      byteLength: 2_048,
    },
    visualReview: {
      evidenceManifestKey: reviewReceipt.evidence.manifestKey,
      evidenceFrameKeys: reviewReceipt.evidence.frameKeys,
      evidenceFrameArtifacts: reviewReceipt.evidence.frameArtifacts,
      receiptKey: visualReviewReleaseReceiptKey(
        "owner/alice/",
        "mechanics-certificate",
        reviewReceipt.releaseReceiptFingerprint,
      ),
      reviewFingerprint: reviewReceipt.reviewFingerprint,
      reviewReceiptVersion: reviewReceipt.reviewReceiptVersion,
      reviewReceiptFingerprint: reviewReceipt.reviewReceiptFingerprint,
      releaseReceiptFingerprint: reviewReceipt.releaseReceiptFingerprint,
    },
    qualityEvidence: binding,
  } as const;
}

const certificate = createFinalMasterReleaseCertificate({
  ...certificateInput(),
  referenceQualityMechanics: mechanics,
});
assert.doesNotThrow(() => assertFinalMasterReleaseCertificate(certificate));
assert.equal(
  certificate.referenceQualityMechanics?.routeSeedFingerprint,
  channelProgramRouteRunSeedFingerprint(routeSeed),
  "the certificate seals the complete route seed rather than only its public projection",
);

assert.throws(
  () => createFinalMasterReleaseCertificate({
    ...certificateInput(qualityBinding("e".repeat(64))),
    referenceQualityMechanics: mechanics,
  }),
  /route does not match the final-QA route binding/,
  "a self-fingerprinted mechanics ledger cannot be replayed with a different QA route seed",
);

const noRouteSibling = createFinalMasterQualityEvidenceBinding({
  finalMaster,
  visualReview: {
    reviewFingerprint: reviewReceipt.reviewFingerprint,
    reviewReceiptVersion: reviewReceipt.reviewReceiptVersion,
    reviewReceiptFingerprint: reviewReceipt.reviewReceiptFingerprint,
    releaseReceiptFingerprint: reviewReceipt.releaseReceiptFingerprint,
  },
  contentLane: lane,
  qualityEvidence,
});
assert.throws(
  () => createFinalMasterReleaseCertificate({
    ...certificateInput(noRouteSibling),
    referenceQualityMechanics: mechanics,
  }),
  /requires the matching final-QA program route binding/,
  "ledger-bearing certificates fail closed when a legacy QA binding lacks its route sibling",
);

const legacyCertificate = createFinalMasterReleaseCertificate(certificateInput());
assert.doesNotThrow(
  () => assertFinalMasterReleaseCertificate(legacyCertificate),
  "historical certificates remain readable when the optional mechanics ledger is absent",
);

console.log("reference-quality mechanics certificate tests passed");
