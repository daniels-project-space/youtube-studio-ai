import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  createFinalMasterReleaseCertificate,
  createVisualReviewReleaseReceipt,
  finalMasterReleaseCertificateKey,
  retainedFinalMasterReleaseObjectKeys,
  verifyFinalMasterReleaseEvidenceObjects,
  visualReviewReleaseReceiptKey,
} from "@/lib/finalMasterReleaseCertificate";
import {
  THIRD_PARTY_STOCK_EVIDENCE_VERSION,
  approvedThirdPartyStockSource,
  assertThirdPartyStockEvidenceManifest,
  assertThirdPartyStockEvidenceMatchesFootageKeys,
  createThirdPartyStockEvidenceReference,
  thirdPartyStockEvidenceManifestKey,
  thirdPartyStockEvidenceManifestSha256,
} from "@/lib/thirdPartyStockEvidence";

const keyPrefix = "owner/alice/channel/documentary/";
const runId = "run-stock-evidence";
const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

const footageKeys = [
  `${keyPrefix}footage/run/${runId}/clip_0.mp4`,
  `${keyPrefix}footage/run/${runId}/clip_1.mp4`,
];
const pexels = approvedThirdPartyStockSource({
  provider: "pexels",
  assetId: 1093662,
  assetUrl: "https://www.pexels.com/video/water-crashing-over-the-rocks-1093662/",
});
assert.equal(pexels.license.attribution.licenseStatus, "not_required");
assert.equal(pexels.license.attribution.apiGuidanceStatus, "recommended");
assert.equal(pexels.license.attribution.applicationStatus, "not_automatically_applied");
assert.match(pexels.license.attribution.caveat, /does not assert/i);
const manifest = {
  version: THIRD_PARTY_STOCK_EVIDENCE_VERSION,
  inputs: [
    {
      ordinal: 0,
      footageKey: footageKeys[0],
      footageSha256: "a".repeat(64),
      origin: "third_party_stock" as const,
      source: pexels,
      acquiredAt: 1_785_000_000_000,
    },
    {
      ordinal: 1,
      footageKey: footageKeys[1],
      footageSha256: "b".repeat(64),
      origin: "studio_generated" as const,
      sourceLabel: "signature_clip",
    },
  ],
};

const parsedManifest = assertThirdPartyStockEvidenceManifest(manifest);
assert.equal(
  parsedManifest.inputs[0].origin,
  "third_party_stock",
  "a selected stock input keeps a typed third-party origin",
);
assert.equal(
  (parsedManifest.inputs[0] as Extract<typeof parsedManifest.inputs[number], { origin: "third_party_stock" }>).source.assetId,
  "1093662",
  "the provider asset id is durable identity rather than a rendition URL",
);
assert.doesNotThrow(
  () => assertThirdPartyStockEvidenceMatchesFootageKeys({ manifest, footageKeys }),
  "the evidence sidecar must bind every staged footage input by exact ordinal/key",
);
assert.throws(
  () => assertThirdPartyStockEvidenceMatchesFootageKeys({ manifest, footageKeys: [...footageKeys].reverse() }),
  /does not match staged footage/,
  "a swapped staged-input order must fail before compose rather than silently misbind rights evidence",
);
assert.throws(
  () => assertThirdPartyStockEvidenceManifest({
    ...manifest,
    inputs: [{
      ...manifest.inputs[0],
      source: {
        ...pexels,
        license: { ...pexels.license, termsSnapshot: `${pexels.license.termsSnapshot}\ntampered` },
      },
    }, manifest.inputs[1]],
  }),
  /license snapshot hash mismatch/,
  "a license snapshot is sealed to its own hash",
);

const manifestSha256 = thirdPartyStockEvidenceManifestSha256(parsedManifest);
const manifestKey = thirdPartyStockEvidenceManifestKey(keyPrefix, runId, manifestSha256);
const stockEvidence = createThirdPartyStockEvidenceReference({ manifestKey, manifest });

const masterBytes = Buffer.from("released master bytes");
const masterSha256 = digest(masterBytes);
const evidenceManifestKey = `${keyPrefix}runs/${runId}/visual-review/manifest.json`;
const frameBytes = Buffer.from("review frame bytes");
const frameKey = `${keyPrefix}runs/${runId}/visual-review/frames/f001.jpg`;
const receipt = createVisualReviewReleaseReceipt({
  reviewFingerprint: "review-stock-evidence",
  reviewReceiptVersion: "visual-review-receipt/v1",
  reviewReceiptFingerprint: "c".repeat(64),
  verdict: "pass",
  summary: "Visual review passed.",
  defects: [],
  focusWindows: [],
  referenceCriteria: [],
  referenceCriteriaComplete: true,
  evidence: {
    source: { durationSec: 60, sha256: masterSha256 },
    manifestKey: evidenceManifestKey,
    frameKeys: [frameKey],
    frameArtifacts: [{ r2Key: frameKey, contentSha256: digest(frameBytes), byteLength: frameBytes.byteLength }],
  },
});
const receiptKey = visualReviewReleaseReceiptKey(keyPrefix, runId, receipt.releaseReceiptFingerprint);
const certificate = createFinalMasterReleaseCertificate({
  version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  finalMaster: {
    r2Key: `${keyPrefix}runs/${runId}/final.mp4`,
    sha256: masterSha256,
    byteLength: masterBytes.byteLength,
    durationSec: 60,
  },
  visualReview: {
    evidenceManifestKey,
    evidenceFrameKeys: [frameKey],
    evidenceFrameArtifacts: [{ r2Key: frameKey, contentSha256: digest(frameBytes), byteLength: frameBytes.byteLength }],
    receiptKey,
    reviewFingerprint: receipt.reviewFingerprint,
    reviewReceiptVersion: receipt.reviewReceiptVersion,
    reviewReceiptFingerprint: receipt.reviewReceiptFingerprint,
    releaseReceiptFingerprint: receipt.releaseReceiptFingerprint,
  },
  thirdPartyStockEvidence: stockEvidence,
});
const certificateKey = finalMasterReleaseCertificateKey(keyPrefix, runId, certificate.certificateFingerprint);
const retained = retainedFinalMasterReleaseObjectKeys({ keyPrefix, runId, certificateKey, certificate });
assert.ok(retained.includes(manifestKey), "release retention must keep the compact stock-evidence sidecar");
assert.equal(
  retained.some((key) => footageKeys.includes(key)),
  false,
  "release retention must not retain raw source footage merely because it is described by the evidence sidecar",
);

async function verifyCertificateEvidence(): Promise<void> {
  const objects = new Map<string, Buffer>([
    [certificate.finalMaster.r2Key, masterBytes],
    [receiptKey, Buffer.from(JSON.stringify(receipt))],
    [evidenceManifestKey, Buffer.from(JSON.stringify({
      source: { durationSec: 60, sha256: masterSha256 },
      manifestKey: evidenceManifestKey,
      frames: [{ r2Key: frameKey, contentSha256: digest(frameBytes), byteLength: frameBytes.byteLength }],
    }))],
    [frameKey, frameBytes],
    [manifestKey, Buffer.from(JSON.stringify(manifest))],
  ]);
  const getObjectBytes = async (key: string): Promise<Uint8Array> => {
    const bytes = objects.get(key);
    if (!bytes) throw new Error("object missing");
    return bytes;
  };
  const getObjectIntegrity = async (key: string) => {
    const bytes = objects.get(key);
    if (!bytes) throw new Error("object missing");
    return { sha256: digest(bytes), byteLength: bytes.byteLength };
  };
  await assert.doesNotReject(
    () => verifyFinalMasterReleaseEvidenceObjects({ certificate, getObjectBytes, getObjectIntegrity }),
    "the release verifier must re-read and validate the bound rights-evidence sidecar",
  );
  objects.set(manifestKey, Buffer.from(JSON.stringify({ ...manifest, inputs: [...manifest.inputs].reverse() })));
  await assert.rejects(
    () => verifyFinalMasterReleaseEvidenceObjects({ certificate, getObjectBytes, getObjectIntegrity }),
    /third-party stock evidence manifest bytes do not match certificate reference/,
    "a post-certificate evidence rewrite must fail closed before upload or cleanup",
  );
}

verifyCertificateEvidence()
  .then(() => console.log("thirdPartyStockEvidence.test.ts: provider-free stock rights evidence and release binding verified"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
