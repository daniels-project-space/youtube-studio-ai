import assert from "node:assert/strict";

import {
  FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  createFinalMasterReleaseCertificate,
  createFinalMasterReleaseCertificateReference,
  finalMasterReleaseCertificateKey,
  visualReviewReleaseReceiptKey,
} from "@/lib/finalMasterReleaseCertificate";
import {
  deriveReleaseEvidenceProjection,
  normalizeReleaseEvidenceStatus,
  releaseEvidenceStatusLabel,
  type ReleaseEvidenceArtifact,
} from "@/lib/releaseEvidenceStatus";

const keyPrefix = "owner/alice/channel/casefile/";
const runId = "run-proof-01";
const masterSha256 = "a".repeat(64);
const reviewReceiptFingerprint = "b".repeat(64);
const releaseReceiptFingerprint = "c".repeat(64);
const reviewFingerprint = "review-fingerprint";
const evidenceManifestKey = `${keyPrefix}runs/${runId}/visual-review/${reviewFingerprint}/manifest.json`;
const evidenceFrameKeys = [
  `${keyPrefix}runs/${runId}/visual-review/${reviewFingerprint}/frames/f001.jpg`,
  `${keyPrefix}runs/${runId}/visual-review/${reviewFingerprint}/frames/f002.jpg`,
];
const evidenceFrameArtifacts = evidenceFrameKeys.map((r2Key, index) => ({
  r2Key,
  contentSha256: `${index + 1}`.repeat(64),
  byteLength: 100 + index,
}));

const certificate = createFinalMasterReleaseCertificate({
  version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  finalMaster: {
    r2Key: `${keyPrefix}runs/${runId}/final.mp4`,
    sha256: masterSha256,
    durationSec: 92.4,
  },
  visualReview: {
    evidenceManifestKey,
    evidenceFrameKeys,
    evidenceFrameArtifacts,
    receiptKey: visualReviewReleaseReceiptKey(keyPrefix, runId, releaseReceiptFingerprint),
    reviewFingerprint,
    reviewReceiptVersion: "visual-review-receipt/v1",
    reviewReceiptFingerprint,
    releaseReceiptFingerprint,
  },
});
const certificateKey = finalMasterReleaseCertificateKey(
  keyPrefix,
  runId,
  certificate.certificateFingerprint,
);
const certificateReference = createFinalMasterReleaseCertificateReference({
  keyPrefix,
  runId,
  certificateKey,
  certificate,
});

const qaStage = {
  status: "ok",
  outputs: {
    qaPassed: true,
    finalMasterSha256: masterSha256,
    reviewEvidence: {
      manifestKey: evidenceManifestKey,
      frames: evidenceFrameArtifacts,
    },
    reviewResult: {
      verdict: "pass",
      reviewReceiptVersion: "visual-review-receipt/v1",
      reviewReceiptFingerprint,
    },
    reviewFingerprint,
    reviewReceiptVersion: "visual-review-receipt/v1",
    reviewReceiptFingerprint,
    finalMasterReleaseCertificateKey: certificateKey,
  },
};

const completeArtifacts: ReleaseEvidenceArtifact[] = [
  {
    key: "videoKey",
    type: "R2ObjectKey",
    producerModule: "timeline_assemble",
    persistence: "reference",
    payload: certificate.finalMaster.r2Key,
  },
  {
    key: "finalMasterReleaseCertificate",
    type: "FinalMasterReleaseCertificate",
    producerModule: "qa_visual",
    // The full certificate can be summarized when narration/cinematic receipts
    // are large; status must not depend on an inline copy of it.
    persistence: "summary",
  },
  {
    key: "finalMasterReleaseCertificateReference",
    type: "FinalMasterReleaseCertificateReference",
    producerModule: "qa_visual",
    persistence: "reference",
    payload: certificateReference,
  },
  {
    key: "finalMasterReleaseCertificateKey",
    type: "R2ObjectKey",
    producerModule: "qa_visual",
    persistence: "reference",
    payload: certificateKey,
  },
];

assert.deepEqual(
  deriveReleaseEvidenceProjection({ runId, qaStage, artifacts: completeArtifacts }),
  {
    status: "release_evidence_recorded",
    certificateFingerprint: certificate.certificateFingerprint,
    certificateKey,
  },
  "only matching QA, certificate, master, and review-evidence lineage may be recorded",
);

const compactQaStage = {
  ...qaStage,
  outputs: {
    ...qaStage.outputs,
    reviewEvidence: {
      manifestKey: evidenceManifestKey,
      frameCount: evidenceFrameKeys.length,
      frameKeysFingerprint: certificateReference.visualReview.evidenceFrameKeysFingerprint,
      frameArtifactsFingerprint: certificateReference.visualReview.evidenceFrameArtifactsFingerprint,
    },
  },
};
assert.deepEqual(
  deriveReleaseEvidenceProjection({ runId, qaStage: compactQaStage, artifacts: completeArtifacts }),
  {
    status: "release_evidence_recorded",
    certificateFingerprint: certificate.certificateFingerprint,
    certificateKey,
  },
  "the bounded QA-stage review summary must preserve the same sealed release lineage",
);

const { certificateFingerprint: _certificateFingerprint, ...certificateInput } = certificate;
void _certificateFingerprint;
const oversizedCertificate = createFinalMasterReleaseCertificate({
  ...certificateInput,
  audio: { transcript: { canonicalProof: "x".repeat(120_000) } },
});
const oversizedCertificateKey = finalMasterReleaseCertificateKey(
  keyPrefix,
  runId,
  oversizedCertificate.certificateFingerprint,
);
const oversizedCertificateReference = createFinalMasterReleaseCertificateReference({
  keyPrefix,
  runId,
  certificateKey: oversizedCertificateKey,
  certificate: oversizedCertificate,
});
assert.ok(JSON.stringify(oversizedCertificate).length > 100_000);
assert.ok(JSON.stringify(oversizedCertificateReference).length < 5_000);
assert.deepEqual(
  deriveReleaseEvidenceProjection({
    runId,
    qaStage: {
      ...qaStage,
      outputs: {
        ...qaStage.outputs,
        finalMasterReleaseCertificateKey: oversizedCertificateKey,
      },
    },
    artifacts: [
      {
        key: "videoKey",
        type: "R2ObjectKey",
        producerModule: "timeline_assemble",
        persistence: "reference",
        payload: oversizedCertificate.finalMaster.r2Key,
      },
      {
        key: "finalMasterReleaseCertificate",
        type: "FinalMasterReleaseCertificate",
        producerModule: "qa_visual",
        persistence: "summary",
      },
      {
        key: "finalMasterReleaseCertificateReference",
        type: "FinalMasterReleaseCertificateReference",
        producerModule: "qa_visual",
        persistence: "reference",
        payload: oversizedCertificateReference,
      },
      {
        key: "finalMasterReleaseCertificateKey",
        type: "R2ObjectKey",
        producerModule: "qa_visual",
        persistence: "reference",
        payload: oversizedCertificateKey,
      },
    ],
  }),
  {
    status: "release_evidence_recorded",
    certificateFingerprint: oversizedCertificate.certificateFingerprint,
    certificateKey: oversizedCertificateKey,
  },
  "a summarized >100KB certificate remains auditable through its compact R2 reference artifact",
);

assert.equal(
  deriveReleaseEvidenceProjection({
    runId,
    qaStage: { status: "ok", outputs: { qaPassed: true } },
    artifacts: [],
  }).status,
  "legacy_unverified",
  "qaPassed alone must remain explicitly unverified",
);

assert.equal(
  deriveReleaseEvidenceProjection({
    runId,
    qaStage,
    artifacts: completeArtifacts.filter((artifact) => artifact.key !== "videoKey"),
  }).status,
  "evidence_incomplete",
  "a certificate cannot be promoted without a retained matching final-master artifact",
);

assert.equal(
  deriveReleaseEvidenceProjection({
    runId,
    qaStage: {
      ...qaStage,
      outputs: {
        ...qaStage.outputs,
        reviewEvidence: {
          ...qaStage.outputs.reviewEvidence,
          frames: [
            evidenceFrameArtifacts[0],
            {
              r2Key: `${keyPrefix}runs/${runId}/visual-review/${reviewFingerprint}/frames/substituted.jpg`,
              contentSha256: "d".repeat(64),
              byteLength: 101,
            },
          ],
        },
      },
    },
    artifacts: completeArtifacts,
  }).status,
  "evidence_incomplete",
  "a same-count in-run frame substitution cannot satisfy the certificate's sealed frame-set digest",
);

const olderCertificate = createFinalMasterReleaseCertificate({
  ...certificateInput,
  finalMaster: {
    ...certificateInput.finalMaster,
    sha256: "d".repeat(64),
  },
});
const olderCertificateKey = finalMasterReleaseCertificateKey(
  keyPrefix,
  runId,
  olderCertificate.certificateFingerprint,
);
const olderCertificateReference = createFinalMasterReleaseCertificateReference({
  keyPrefix,
  runId,
  certificateKey: olderCertificateKey,
  certificate: olderCertificate,
});
assert.deepEqual(
  deriveReleaseEvidenceProjection({
    runId,
    qaStage,
    artifacts: [
      {
        key: "finalMasterReleaseCertificateReference",
        type: "FinalMasterReleaseCertificateReference",
        producerModule: "qa_visual",
        persistence: "reference",
        payload: olderCertificateReference,
      },
      ...completeArtifacts,
    ],
  }),
  {
    status: "release_evidence_recorded",
    certificateFingerprint: certificate.certificateFingerprint,
    certificateKey,
  },
  "a repaired QA stage selects its matching certificate reference rather than an older immutable artifact",
);

assert.equal(
  deriveReleaseEvidenceProjection({
    runId,
    qaStage,
    artifacts: completeArtifacts.map((artifact) =>
      artifact.key === "finalMasterReleaseCertificateReference"
        ? {
            ...artifact,
            payload: {
              ...certificateReference,
              finalMaster: {
                ...certificateReference.finalMaster,
                r2Key: `${keyPrefix}runs/other-run/final.mp4`,
              },
            },
          }
        : artifact,
    ),
  }).status,
  "evidence_incomplete",
  "cross-run compact certificate references must never receive a recorded status",
);

assert.equal(
  deriveReleaseEvidenceProjection({
    runId,
    qaStage: { status: "failed", outputs: qaStage.outputs },
    artifacts: completeArtifacts,
  }).status,
  "not_ready",
  "an unsuccessful QA stage cannot retain a passing release projection",
);

assert.equal(normalizeReleaseEvidenceStatus(undefined), "legacy_unverified");
assert.match(releaseEvidenceStatusLabel(undefined), /unverified/i);

console.log("release-evidence status tests passed");
