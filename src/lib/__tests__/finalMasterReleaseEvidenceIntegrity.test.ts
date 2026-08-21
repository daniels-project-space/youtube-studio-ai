import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  createFinalMasterReleaseCertificate,
  createVisualReviewReleaseReceipt,
  finalMasterReleaseCertificateKey,
  verifyFinalMasterReleaseEvidenceObjects,
  visualReviewReleaseReceiptKey,
} from "@/lib/finalMasterReleaseCertificate";
import { pruneRunObjectsWithVerifiedFinalMasterEvidence } from "@/trigger/blocks/lofiBlocks";

const keyPrefix = "owner/alice/channel/casefile/";
const runId = "run-byte-evidence";
const reviewFingerprint = "review-byte-evidence";
const masterSha256 = "a".repeat(64);

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function buildFixture() {
  const evidenceManifestKey = `${keyPrefix}runs/${runId}/visual-review/${reviewFingerprint}/manifest.json`;
  const frameBytes = [Buffer.from("review-frame-one"), Buffer.from("review-frame-two")];
  const frameArtifacts = frameBytes.map((bytes, index) => ({
    r2Key: `${keyPrefix}runs/${runId}/visual-review/${reviewFingerprint}/frames/f00${index + 1}.jpg`,
    contentSha256: sha256(bytes),
    byteLength: bytes.byteLength,
  }));
  const receipt = createVisualReviewReleaseReceipt({
    reviewFingerprint,
    reviewReceiptVersion: "visual-review-receipt/v1",
    reviewReceiptFingerprint: "b".repeat(64),
    verdict: "pass",
    summary: "Evidence-backed visual review passed.",
    defects: [],
    focusWindows: [],
    referenceCriteria: [],
    referenceCriteriaComplete: true,
    evidence: {
      source: { durationSec: 60, sha256: masterSha256 },
      manifestKey: evidenceManifestKey,
      frameKeys: frameArtifacts.map((frame) => frame.r2Key),
      frameArtifacts,
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
      durationSec: 60,
    },
    visualReview: {
      evidenceManifestKey,
      evidenceFrameKeys: frameArtifacts.map((frame) => frame.r2Key),
      evidenceFrameArtifacts: frameArtifacts,
      receiptKey,
      reviewFingerprint,
      reviewReceiptVersion: receipt.reviewReceiptVersion,
      reviewReceiptFingerprint: receipt.reviewReceiptFingerprint,
      releaseReceiptFingerprint: receipt.releaseReceiptFingerprint,
    },
  });
  const certificateKey = finalMasterReleaseCertificateKey(
    keyPrefix,
    runId,
    certificate.certificateFingerprint,
  );
  const objects = new Map<string, Buffer>([
    [certificateKey, Buffer.from(JSON.stringify(certificate))],
    [certificate.finalMaster.r2Key, Buffer.from("released master bytes")],
    [receiptKey, Buffer.from(JSON.stringify(receipt))],
    [evidenceManifestKey, Buffer.from(JSON.stringify({
      source: { durationSec: 60, sha256: masterSha256 },
      manifestKey: evidenceManifestKey,
      frames: frameArtifacts,
    }))],
    [frameArtifacts[0].r2Key, frameBytes[0]],
    [frameArtifacts[1].r2Key, frameBytes[1]],
    [`${keyPrefix}runs/${runId}/intermediates/scene-01.mp4`, Buffer.from("replaceable intermediate")],
  ]);
  return { certificate, certificateKey, frameArtifacts, frameBytes, objects };
}

function getObjectBytes(objects: Map<string, Buffer>) {
  return async (key: string): Promise<Uint8Array> => {
    const bytes = objects.get(key);
    if (!bytes) throw new Error("object not found");
    return bytes;
  };
}

async function pruneFixture(fixture: ReturnType<typeof buildFixture>) {
  const deleteCalls: string[][] = [];
  const result = await pruneRunObjectsWithVerifiedFinalMasterEvidence({
    keyPrefix,
    runId,
    certificateKey: fixture.certificateKey,
    certificate: fixture.certificate,
    keepNames: ["final.mp4", "thumbnail.jpg"],
    getObjectBytes: getObjectBytes(fixture.objects),
    listObjects: async (prefix) => [...fixture.objects.keys()].filter((key) => key.startsWith(prefix)),
    deleteObjects: async (keys) => {
      deleteCalls.push([...keys]);
      return keys.length;
    },
  });
  return { result, deleteCalls };
}

async function main() {
  const valid = buildFixture();
  await assert.doesNotReject(
    () => verifyFinalMasterReleaseEvidenceObjects({
      certificate: valid.certificate,
      getObjectBytes: getObjectBytes(valid.objects),
    }),
    "the exact persisted review-frame bytes must satisfy the sealed evidence receipt",
  );

  const missing = buildFixture();
  missing.objects.delete(missing.frameArtifacts[0].r2Key);
  await assert.rejects(
    () => verifyFinalMasterReleaseEvidenceObjects({
      certificate: missing.certificate,
      getObjectBytes: getObjectBytes(missing.objects),
    }),
    /evidence frame is unavailable/,
    "a missing retained frame must stop release evidence verification",
  );

  const overwrittenSameLength = buildFixture();
  overwrittenSameLength.objects.set(
    overwrittenSameLength.frameArtifacts[0].r2Key,
    Buffer.alloc(overwrittenSameLength.frameBytes[0].byteLength, 0x5a),
  );
  await assert.rejects(
    () => verifyFinalMasterReleaseEvidenceObjects({
      certificate: overwrittenSameLength.certificate,
      getObjectBytes: getObjectBytes(overwrittenSameLength.objects),
    }),
    /frame bytes do not match receipt/,
    "an overwritten same-length frame must not masquerade as reviewed evidence",
  );

  const differentLength = buildFixture();
  differentLength.objects.set(
    differentLength.frameArtifacts[1].r2Key,
    Buffer.concat([differentLength.frameBytes[1], Buffer.from(" changed")]),
  );
  await assert.rejects(
    () => verifyFinalMasterReleaseEvidenceObjects({
      certificate: differentLength.certificate,
      getObjectBytes: getObjectBytes(differentLength.objects),
    }),
    /frame bytes do not match receipt/,
    "a different-byte-length frame must not satisfy the original review receipt",
  );

  const validCleanup = await pruneFixture(buildFixture());
  assert.equal(validCleanup.result.cleaned, true, "cleanup may proceed only after all evidence bytes revalidate");
  assert.deepEqual(
    validCleanup.deleteCalls,
    [[`${keyPrefix}runs/${runId}/intermediates/scene-01.mp4`]],
    "cleanup must retain the certificate, receipt, manifest, frames, and final master",
  );

  const missingCleanupFixture = buildFixture();
  missingCleanupFixture.objects.delete(missingCleanupFixture.frameArtifacts[0].r2Key);
  const missingCleanup = await pruneFixture(missingCleanupFixture);
  assert.equal(missingCleanup.result.cleaned, false, "cleanup must fail closed when a frame disappeared");
  assert.equal(missingCleanup.result.removedObjects, 0);
  assert.deepEqual(missingCleanup.deleteCalls, [], "cleanup must delete nothing when evidence is missing");

  const overwrittenCleanupFixture = buildFixture();
  overwrittenCleanupFixture.objects.set(
    overwrittenCleanupFixture.frameArtifacts[0].r2Key,
    Buffer.alloc(overwrittenCleanupFixture.frameBytes[0].byteLength, 0x33),
  );
  const overwrittenCleanup = await pruneFixture(overwrittenCleanupFixture);
  assert.equal(overwrittenCleanup.result.cleaned, false, "cleanup must fail closed when a frame was overwritten");
  assert.equal(overwrittenCleanup.result.removedObjects, 0);
  assert.deepEqual(overwrittenCleanup.deleteCalls, [], "cleanup must preserve every object on a byte-validation gap");
}

main().then(() => console.log("final-master release evidence integrity tests passed"));
