import assert from "node:assert/strict";

import {
  FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  assertFinalMasterReleaseCertificate,
  assertReleaseCertificateVisualReviewBindings,
  createFinalMasterReleaseCertificate,
  createVisualReviewReleaseReceipt,
  finalMasterReleaseCertificateKey,
  parseFinalMasterReleaseCertificateBytes,
  retainedFinalMasterReleaseObjectKeys,
  visualReviewReleaseReceiptKey,
} from "@/lib/finalMasterReleaseCertificate";

const keyPrefix = "owner/alice/channel/casefile/";
const runId = "run-proof-01";
const masterSha256 = "a".repeat(64);
const reviewReceiptFingerprint = "b".repeat(64);
const evidenceManifestKey = `${keyPrefix}runs/${runId}/visual-review/review-fingerprint/manifest.json`;
const frameKeys = [
  `${keyPrefix}runs/${runId}/visual-review/review-fingerprint/frames/f001.jpg`,
  `${keyPrefix}runs/${runId}/visual-review/review-fingerprint/frames/f002.jpg`,
];
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
    finalMasterMeters: { integratedLufs: -16.2, windowMeanDb: -21.1 },
  },
});

const certificateKey = finalMasterReleaseCertificateKey(
  keyPrefix,
  runId,
  certificate.certificateFingerprint,
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
    ...frameKeys,
    certificateKey,
  ])].sort(),
  "cleanup must retain the final master, certificate, receipt, evidence manifest, and every evidence frame",
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
