import assert from "node:assert/strict";

import {
  FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  FINAL_MASTER_RELEASE_CERTIFICATE_REFERENCE_VERSION,
  assertFinalMasterReleaseCertificate,
  assertReleaseCertificateVisualReviewBindings,
  createFinalMasterReleaseCertificate,
  createFinalMasterReleaseCertificateReference,
  createVisualReviewReleaseReceipt,
  finalMasterReleaseEvidenceFrameKeysFingerprint,
  finalMasterReleaseCertificateKey,
  parseFinalMasterReleaseCertificateBytes,
  retainedFinalMasterReleaseObjectKeys,
  visualReviewReleaseReceiptKey,
} from "@/lib/finalMasterReleaseCertificate";
import {
  FASTER_WHISPER_VERSION,
  FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
  finalMasterNarrationTranscriptAuditObjectKey,
  NARRATION_TRANSCRIPT_MODEL_ID,
  NARRATION_TRANSCRIPT_MODEL_REVISION,
  NARRATION_TRANSCRIPT_PROOF_VERSION,
  prepareFinalMasterNarrationTranscriptAudit,
  sealFinalMasterNarrationSemanticEvidence,
  type NarrationTranscriptProof,
} from "@/lib/narrationTranscriptProof";
import { createUnmeasuredReferenceQualityFinalMasterBinding } from "@/lib/referenceQualityFinalMasterBinding";
import { referenceQualityContractFor } from "@/engine/creative/referenceQuality";

const keyPrefix = "owner/alice/channel/casefile/";
const runId = "run-proof-01";
const masterSha256 = "a".repeat(64);
const narrationSourceSha256 = "d".repeat(64);
const approvedNarrationTextSha256 = "e".repeat(64);
const reviewReceiptFingerprint = "b".repeat(64);
const evidenceManifestKey = `${keyPrefix}runs/${runId}/visual-review/review-fingerprint/manifest.json`;
const frameKeys = [
  `${keyPrefix}runs/${runId}/visual-review/review-fingerprint/frames/f001.jpg`,
  `${keyPrefix}runs/${runId}/visual-review/review-fingerprint/frames/f002.jpg`,
];

function passingTranscriptProof(sourceSha256: string): NarrationTranscriptProof {
  return {
    schemaVersion: NARRATION_TRANSCRIPT_PROOF_VERSION,
    provider: "faster-whisper",
    model: {
      id: NARRATION_TRANSCRIPT_MODEL_ID,
      revision: NARRATION_TRANSCRIPT_MODEL_REVISION,
      packageVersion: FASTER_WHISPER_VERSION,
      computeType: "int8-cpu",
    },
    source: { sha256: sourceSha256, byteLength: 128 },
    expected: { textSha256: approvedNarrationTextSha256, wordCount: 10 },
    transcript: {
      text: "Narration is intelligible in the released master.",
      wordCount: 1,
      words: [{ text: "Narration", startMs: 0, endMs: 250 }],
    },
    assessment: {
      wordErrorRate: 0.1,
      lexicalRecall: 0.95,
      missingNumericTerms: [],
      thresholds: { maxWordErrorRate: 0.18, minLexicalRecall: 0.92 },
      passed: true,
    },
  };
}

function sealNarrationAudit(
  audit: ReturnType<typeof prepareFinalMasterNarrationTranscriptAudit>,
) {
  return sealFinalMasterNarrationSemanticEvidence({
    version: "final-master-narration-semantic-evidence/v1",
    finalMaster: audit.audit.finalMaster,
    narration: audit.audit.narration,
    sourceTranscript: audit.sourceTranscript,
    finalMasterTranscript: audit.finalMasterTranscript,
    auditArtifact: {
      version: FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
      r2Key: finalMasterNarrationTranscriptAuditObjectKey(keyPrefix, runId, audit.contentSha256),
      contentSha256: audit.contentSha256,
      byteLength: audit.bytes.byteLength,
    },
  });
}

const finalMasterNarrationAudit = prepareFinalMasterNarrationTranscriptAudit({
  version: FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
  finalMaster: { sha256: masterSha256, durationSec: 92.4 },
  narration: {
    sourceSha256: narrationSourceSha256,
    expectedTextSha256: approvedNarrationTextSha256,
    startSec: 2,
    durationSec: 60,
  },
  sourceTranscript: passingTranscriptProof(narrationSourceSha256),
  finalMasterTranscript: passingTranscriptProof(masterSha256),
});
const finalMasterNarration = sealNarrationAudit(finalMasterNarrationAudit);

const receipt = createVisualReviewReleaseReceipt({
  reviewFingerprint: "review-fingerprint",
  reviewReceiptVersion: "visual-review-receipt/v1",
  reviewReceiptFingerprint,
  verdict: "pass",
  summary: "Evidence-backed visual review passed.",
  defects: [],
  focusWindows: [],
  referenceCriteria: [],
  referenceCriteriaComplete: true,
  evidence: {
    source: { durationSec: 92.4, sha256: masterSha256 },
    manifestKey: evidenceManifestKey,
    frameKeys,
  },
});
const receiptKey = visualReviewReleaseReceiptKey(
  keyPrefix,
  runId,
  receipt.releaseReceiptFingerprint,
);

const certificate = createFinalMasterReleaseCertificate({
  version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  finalMaster: {
    r2Key: `${keyPrefix}runs/${runId}/final.mp4`,
    sha256: masterSha256,
    durationSec: 92.4,
  },
  visualReview: {
    evidenceManifestKey,
    evidenceFrameKeys: frameKeys,
    receiptKey,
    reviewFingerprint: "review-fingerprint",
    reviewReceiptVersion: "visual-review-receipt/v1",
    reviewReceiptFingerprint,
    releaseReceiptFingerprint: receipt.releaseReceiptFingerprint,
  },
  cinematic: {
    receiptFingerprint: "c".repeat(64),
    receipt: { version: "cinematic-final-master-qa-evidence/v2", pass: true },
  },
  audio: {
    finalMix: { correlation: 0.88, narrationStartSec: 2 },
    finalMasterNarration,
    finalMasterMeters: { integratedLufs: -16.2, windowMeanDb: -21.1 },
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

assert.deepEqual(
  certificateReference,
  {
    version: FINAL_MASTER_RELEASE_CERTIFICATE_REFERENCE_VERSION,
    certificateKey,
    certificateFingerprint: certificate.certificateFingerprint,
    finalMaster: certificate.finalMaster,
    visualReview: {
      evidenceManifestKey,
      evidenceFrameCount: frameKeys.length,
      evidenceFrameKeysFingerprint: finalMasterReleaseEvidenceFrameKeysFingerprint(frameKeys),
      receiptKey,
      reviewFingerprint: "review-fingerprint",
      reviewReceiptVersion: "visual-review-receipt/v1",
      reviewReceiptFingerprint,
      releaseReceiptFingerprint: receipt.releaseReceiptFingerprint,
    },
  },
  "the compact reference must retain the R2 certificate address and the master/review lineage without copying receipts",
);

assert.equal(
  certificateKey,
  `${keyPrefix}runs/${runId}/release-certificates/${certificate.certificateFingerprint}.json`,
  "certificate storage key must be derived from its payload fingerprint",
);
assert.deepEqual(
  parseFinalMasterReleaseCertificateBytes(Buffer.from(JSON.stringify(certificate))),
  certificate,
  "a durable certificate round-trip must preserve its content binding",
);
assert.doesNotThrow(
  () => assertFinalMasterReleaseCertificate(certificate),
  "a frozen legacy release certificate without the new reference binding must remain resumable/readable",
);

const retained = retainedFinalMasterReleaseObjectKeys({
  keyPrefix,
  runId,
  certificateKey,
  certificate,
});
assert.deepEqual(
  retained,
  [...new Set([
    certificate.finalMaster.r2Key,
    evidenceManifestKey,
    receiptKey,
    finalMasterNarration.auditArtifact.r2Key,
    ...frameKeys,
    certificateKey,
  ])].sort(),
  "cleanup must retain the final master, certificate, receipt, narration audit, evidence manifest, and every evidence frame",
);

assert.doesNotThrow(() => assertReleaseCertificateVisualReviewBindings({
  certificate,
  receipt,
  evidenceManifest: {
    source: { durationSec: 92.4, sha256: masterSha256 },
    manifestKey: evidenceManifestKey,
    frames: frameKeys.map((r2Key) => ({ r2Key })),
  },
}));

assert.throws(
  () => assertFinalMasterReleaseCertificate({ ...certificate, finalMaster: { ...certificate.finalMaster, sha256: "d".repeat(64) } }),
  /fingerprint does not match/,
  "a certificate must fail closed if its master binding changes",
);
assert.throws(
  () => assertReleaseCertificateVisualReviewBindings({
    certificate,
    receipt: { ...receipt, summary: "tampered verdict detail" },
    evidenceManifest: {
      source: { durationSec: 92.4, sha256: masterSha256 },
      manifestKey: evidenceManifestKey,
      frames: frameKeys.map((r2Key) => ({ r2Key })),
    },
  }),
  /release receipt fingerprint does not match/,
  "upload must reject a retained receipt whose verdict-bearing content changed",
);
assert.throws(
  () => retainedFinalMasterReleaseObjectKeys({
    keyPrefix,
    runId,
    certificateKey,
    certificate: {
      ...certificate,
      visualReview: {
        ...certificate.visualReview,
        evidenceFrameKeys: ["owner/alice/channel/another/runs/other/visual-review/f001.jpg"],
      },
    },
  }),
  /fingerprint does not match|escapes the scoped run namespace/,
  "cleanup must reject a certificate that tries to retain evidence outside its run namespace",
);

const { certificateFingerprint: _certificateFingerprint, ...certificateInput } = certificate;
void _certificateFingerprint;
const referenceReviewFingerprint = "e".repeat(64);
const certificateWithReferenceQuality = createFinalMasterReleaseCertificate({
  ...certificateInput,
  visualReview: {
    ...certificateInput.visualReview,
    reviewFingerprint: referenceReviewFingerprint,
  },
  referenceQuality: createUnmeasuredReferenceQualityFinalMasterBinding({
    contract: referenceQualityContractFor("illustrated_explainer"),
    finalMasterSha256: masterSha256,
    visualReviewFingerprint: referenceReviewFingerprint,
    visualReviewReceiptFingerprint: reviewReceiptFingerprint,
  }),
});
assert.doesNotThrow(
  () => assertFinalMasterReleaseCertificate(certificateWithReferenceQuality),
  "a certificate must validate its sealed reference contract against the exact master and visual-review receipt",
);
assert.throws(
  () => createFinalMasterReleaseCertificate({
    ...certificateInput,
    referenceQuality: createUnmeasuredReferenceQualityFinalMasterBinding({
      contract: referenceQualityContractFor("illustrated_explainer"),
      finalMasterSha256: "d".repeat(64),
      visualReviewFingerprint: referenceReviewFingerprint,
      visualReviewReceiptFingerprint: reviewReceiptFingerprint,
    }),
    visualReview: {
      ...certificateInput.visualReview,
      reviewFingerprint: referenceReviewFingerprint,
    },
  }),
  /different final master/,
  "certificate creation must fail closed when the reference contract is attached to different master bytes",
);
const mismatchedFinalMasterNarration = sealNarrationAudit(prepareFinalMasterNarrationTranscriptAudit({
  version: FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
  finalMaster: { ...finalMasterNarration.finalMaster, sha256: "f".repeat(64) },
  narration: finalMasterNarration.narration,
  sourceTranscript: passingTranscriptProof(narrationSourceSha256),
  finalMasterTranscript: passingTranscriptProof("f".repeat(64)),
}));
assert.throws(
  () => createFinalMasterReleaseCertificate({
    ...certificateInput,
    audio: {
      ...certificateInput.audio,
      finalMasterNarration: mismatchedFinalMasterNarration,
    },
  }),
  /belongs to a different released master/,
  "certificate creation must reject a narration audition receipt for other master bytes",
);
const mismatchedFinalMasterNarrationTiming = sealNarrationAudit(prepareFinalMasterNarrationTranscriptAudit({
  version: FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
  finalMaster: { ...finalMasterNarration.finalMaster, durationSec: 91.5 },
  narration: finalMasterNarration.narration,
  sourceTranscript: passingTranscriptProof(narrationSourceSha256),
  finalMasterTranscript: passingTranscriptProof(masterSha256),
}));
assert.throws(
  () => createFinalMasterReleaseCertificate({
    ...certificateInput,
    audio: {
      ...certificateInput.audio,
      finalMasterNarration: mismatchedFinalMasterNarrationTiming,
    },
  }),
  /duration does not match the released master/,
  "certificate creation must reject a narration audition receipt with different master timing",
);
const nonContentAddressedReceiptCertificate = createFinalMasterReleaseCertificate({
  ...certificateInput,
  visualReview: {
    ...certificate.visualReview,
    receiptKey: `${keyPrefix}runs/${runId}/visual-review/receipts/${"d".repeat(64)}.json`,
  },
});
assert.throws(
  () => retainedFinalMasterReleaseObjectKeys({
    keyPrefix,
    runId,
    certificateKey: finalMasterReleaseCertificateKey(
      keyPrefix,
      runId,
      nonContentAddressedReceiptCertificate.certificateFingerprint,
    ),
    certificate: nonContentAddressedReceiptCertificate,
  }),
  /visual-review receipt key is not content-addressed/,
  "upload and cleanup must reject a receipt path that is not derived from its receipt fingerprint",
);
const nonContentAddressedFinalMasterNarration = sealFinalMasterNarrationSemanticEvidence({
  version: finalMasterNarration.version,
  finalMaster: finalMasterNarration.finalMaster,
  narration: finalMasterNarration.narration,
  sourceTranscript: finalMasterNarration.sourceTranscript,
  finalMasterTranscript: finalMasterNarration.finalMasterTranscript,
  auditArtifact: {
    ...finalMasterNarration.auditArtifact,
    r2Key: `${keyPrefix}runs/${runId}/narration-transcript-audits/${"f".repeat(64)}.json`,
  },
});
const nonContentAddressedNarrationAuditCertificate = createFinalMasterReleaseCertificate({
  ...certificateInput,
  audio: {
    ...certificateInput.audio,
    finalMasterNarration: nonContentAddressedFinalMasterNarration,
  },
});
assert.throws(
  () => retainedFinalMasterReleaseObjectKeys({
    keyPrefix,
    runId,
    certificateKey: finalMasterReleaseCertificateKey(
      keyPrefix,
      runId,
      nonContentAddressedNarrationAuditCertificate.certificateFingerprint,
    ),
    certificate: nonContentAddressedNarrationAuditCertificate,
  }),
  /narration transcript audit key is not content-addressed/,
  "cleanup must retain only the content-addressed narration transcript audit for this release",
);

assert.throws(
  () => assertReleaseCertificateVisualReviewBindings({
    certificate,
    receipt,
    evidenceManifest: {
      source: { durationSec: 92.4, sha256: "d".repeat(64) },
      manifestKey: evidenceManifestKey,
      frames: frameKeys.map((r2Key) => ({ r2Key })),
    },
  }),
  /does not match its visual-review evidence manifest/,
  "upload must reject visual-review evidence that is not bound to the released master",
);

console.log("final-master release certificate tests passed");
