import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  createFinalMasterReleaseCertificate,
  createVisualReviewReleaseReceipt,
  finalMasterReleaseCertificateFingerprint,
  finalMasterReleaseCertificateKey,
  verifyFinalMasterReleaseEvidenceForLocalUpload,
  verifyFinalMasterReleaseEvidenceObjects,
  visualReviewReleaseReceiptKey,
} from "@/lib/finalMasterReleaseCertificate";
import {
  createPackageToOpeningPlan,
  createPackageToOpeningReceipt,
} from "@/engine/packageToOpening";
import { pruneRunObjectsWithVerifiedFinalMasterEvidence } from "@/lib/runArtifactPrune";

const keyPrefix = "owner/alice/channel/casefile/";
const runId = "run-byte-evidence";
const parentReviewFingerprint = "review-byte-evidence";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function buildFixture(kind: "parent" | "short" = "parent") {
  const isShort = kind === "short";
  const reviewFingerprint = isShort
    ? `${parentReviewFingerprint}-short`
    : parentReviewFingerprint;
  const masterName = isShort ? "short.mp4" : "final.mp4";
  const masterBytes = Buffer.from(`${kind}-released-master-bytes`);
  const masterSha256 = sha256(masterBytes);
  const evidenceManifestKey = `${keyPrefix}runs/${runId}/visual-review/${reviewFingerprint}/manifest.json`;
  const frameBytes = [
    Buffer.from(`${kind}-review-frame-one`),
    Buffer.from(`${kind}-review-frame-two`),
  ];
  const frameArtifacts = frameBytes.map((bytes, index) => ({
    id: `${kind}-frame-${index + 1}`,
    tSec: index === 0 ? 3 : 36,
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
  const thumbnailBytes = Buffer.from(`${kind}-package-thumbnail-bytes`);
  const thumbnailKey = `${keyPrefix}runs/${runId}/${kind}-thumbnail.webp`;
  const packagePlan = createPackageToOpeningPlan({
    title: `${kind} released title`,
    thumbnailDescription: `${kind} thumbnail uses a single clear, high-contrast subject and no baked text for a readable package image.`,
    topic: `${kind} released topic`,
    route: { version: "test-route/v1", family: "narrated_stock" },
    script: { hook: `${kind} opening hook`, hookLoop: `${kind} declared promise` },
  });
  const packageToOpening = createPackageToOpeningReceipt({
    plan: packagePlan,
    finalMaster: { sha256: masterSha256, durationSec: 60 },
    thumbnail: {
      r2Key: thumbnailKey,
      sha256: sha256(thumbnailBytes),
      byteLength: thumbnailBytes.byteLength,
    },
    visualReview: {
      reviewFingerprint,
      reviewReceiptVersion: receipt.reviewReceiptVersion,
      reviewReceiptFingerprint: receipt.reviewReceiptFingerprint,
      releaseReceiptFingerprint: receipt.releaseReceiptFingerprint,
      evidenceFrameArtifacts: frameArtifacts,
    },
  });
  const certificate = createFinalMasterReleaseCertificate({
    version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
    finalMaster: {
      r2Key: `${keyPrefix}runs/${runId}/${masterName}`,
      sha256: masterSha256,
      byteLength: masterBytes.byteLength,
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
    packageToOpening,
  });
  const certificateKey = finalMasterReleaseCertificateKey(
    keyPrefix,
    runId,
    certificate.certificateFingerprint,
  );
  const objects = new Map<string, Buffer>([
    [certificateKey, Buffer.from(JSON.stringify(certificate))],
    [certificate.finalMaster.r2Key, masterBytes],
    [thumbnailKey, thumbnailBytes],
    [receiptKey, Buffer.from(JSON.stringify(receipt))],
    [evidenceManifestKey, Buffer.from(JSON.stringify({
      source: { durationSec: 60, sha256: masterSha256 },
      manifestKey: evidenceManifestKey,
      frames: frameArtifacts,
    }))],
    [frameArtifacts[0].r2Key, frameBytes[0]],
    [frameArtifacts[1].r2Key, frameBytes[1]],
    [
      `${keyPrefix}runs/${runId}/intermediates/${kind}-scene-01.mp4`,
      Buffer.from("replaceable intermediate"),
    ],
  ]);
  return {
    certificate,
    certificateKey,
    frameArtifacts,
    frameBytes,
    masterBytes,
    thumbnailKey,
    thumbnailBytes,
    objects,
  };
}

function getObjectBytes(objects: Map<string, Buffer>) {
  return async (key: string): Promise<Uint8Array> => {
    const bytes = objects.get(key);
    if (!bytes) throw new Error("object not found");
    return bytes;
  };
}

function getObjectIntegrity(objects: Map<string, Buffer>) {
  return async (key: string) => {
    const bytes = objects.get(key);
    if (!bytes) throw new Error("object not found");
    return { sha256: sha256(bytes), byteLength: bytes.byteLength };
  };
}

function headObjectMetadata(objects: Map<string, Buffer>) {
  return async (key: string) => {
    const bytes = objects.get(key);
    return bytes ? { contentLength: bytes.byteLength } : null;
  };
}

async function localUploadVerifierAvoidsR2MasterRestream(): Promise<void> {
  const valid = buildFixture();
  const directory = await mkdtemp(join(tmpdir(), "ysa-local-release-evidence-"));
  const filePath = join(directory, "final.mp4");
  try {
    await writeFile(filePath, valid.masterBytes);
    // The upload verifier is allowed to use the exact local source instead of
    // re-streaming the master, but every compact proof object stays durable.
    const reads: string[] = [];
    const heads: string[] = [];
    await assert.doesNotReject(
      () => verifyFinalMasterReleaseEvidenceForLocalUpload({
        certificate: valid.certificate,
        filePath,
        getObjectBytes: async (key) => {
          reads.push(key);
          return getObjectBytes(valid.objects)(key);
        },
        headObjectMetadata: async (key) => {
          heads.push(key);
          return headObjectMetadata(valid.objects)(key);
        },
      }),
      "the exact local upload source may satisfy the sealed master receipt without a duplicate R2 stream",
    );
    assert.equal(
      reads.includes(valid.certificate.finalMaster.r2Key),
      false,
      "local upload verification must not fetch the full master from R2 again",
    );
    assert.deepEqual(
      heads,
      [valid.certificate.finalMaster.r2Key],
      "local upload verification retains a lightweight durable-object availability fence",
    );
    assert.equal(
      reads.length,
      valid.frameArtifacts.length + 3,
      "the local fast path must still re-read the durable review receipt, manifest, every reviewed frame, and package thumbnail",
    );

    const legacyInput = {
      version: valid.certificate.version,
      finalMaster: {
        r2Key: valid.certificate.finalMaster.r2Key,
        sha256: valid.certificate.finalMaster.sha256,
        durationSec: valid.certificate.finalMaster.durationSec,
      },
      visualReview: valid.certificate.visualReview,
    };
    const legacyCertificate = {
      ...legacyInput,
      certificateFingerprint: finalMasterReleaseCertificateFingerprint(legacyInput),
    };
    await assert.rejects(
      () => verifyFinalMasterReleaseEvidenceForLocalUpload({
        certificate: legacyCertificate,
        filePath,
        getObjectBytes: getObjectBytes(valid.objects),
        headObjectMetadata: headObjectMetadata(valid.objects),
      }),
      /lacks a byte-bound final-master receipt/,
      "legacy certificates without a byte-bound master remain ineligible for the local upload fast path",
    );

    // A retry recomputes local bytes rather than trusting a stale digest from
    // the first attempt, so a same-length replacement cannot be uploaded.
    await writeFile(filePath, Buffer.alloc(valid.masterBytes.byteLength, 0x5a));
    await assert.rejects(
      () => verifyFinalMasterReleaseEvidenceForLocalUpload({
        certificate: valid.certificate,
        filePath,
        getObjectBytes: getObjectBytes(valid.objects),
        headObjectMetadata: headObjectMetadata(valid.objects),
      }),
      /local final-master upload source bytes do not match receipt/,
      "a same-length local replacement must fail on a later upload retry",
    );

    const missingFrame = buildFixture();
    await writeFile(filePath, missingFrame.masterBytes);
    missingFrame.objects.delete(missingFrame.frameArtifacts[0].r2Key);
    await assert.rejects(
      () => verifyFinalMasterReleaseEvidenceForLocalUpload({
        certificate: missingFrame.certificate,
        filePath,
        getObjectBytes: getObjectBytes(missingFrame.objects),
        headObjectMetadata: headObjectMetadata(missingFrame.objects),
      }),
      /evidence frame is unavailable/,
      "the local master fast path must still fail closed when any retained review frame disappeared",
    );

    const missingMaster = buildFixture();
    await writeFile(filePath, missingMaster.masterBytes);
    missingMaster.objects.delete(missingMaster.certificate.finalMaster.r2Key);
    await assert.rejects(
      () => verifyFinalMasterReleaseEvidenceForLocalUpload({
        certificate: missingMaster.certificate,
        filePath,
        getObjectBytes: getObjectBytes(missingMaster.objects),
        headObjectMetadata: headObjectMetadata(missingMaster.objects),
      }),
      /final-master release object is unavailable/,
      "the upload fast path must preserve the durable R2 availability fence",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function pruneFixture(
  fixture: ReturnType<typeof buildFixture>,
  additionalFixtures: Array<ReturnType<typeof buildFixture>> = [],
) {
  const objects = new Map(fixture.objects);
  for (const additional of additionalFixtures) {
    for (const [key, bytes] of additional.objects) objects.set(key, bytes);
  }
  const deleteCalls: string[][] = [];
  const result = await pruneRunObjectsWithVerifiedFinalMasterEvidence({
    keyPrefix,
    runId,
    certificateKey: fixture.certificateKey,
    certificate: fixture.certificate,
    ...(additionalFixtures.length > 0
      ? {
          additionalCertificates: additionalFixtures.map((additional) => ({
            certificateKey: additional.certificateKey,
            certificate: additional.certificate,
          })),
        }
      : {}),
    keepNames: ["final.mp4", "thumbnail.jpg"],
    getObjectBytes: getObjectBytes(objects),
    getObjectIntegrity: getObjectIntegrity(objects),
    listObjects: async (prefix) => [...objects.keys()].filter((key) => key.startsWith(prefix)),
    deleteObjects: async (keys) => {
      deleteCalls.push([...keys]);
      return keys.length;
    },
  });
  return { result, deleteCalls, objects };
}

async function main() {
  await localUploadVerifierAvoidsR2MasterRestream();

  const valid = buildFixture();
  await assert.doesNotReject(
    () => verifyFinalMasterReleaseEvidenceObjects({
      certificate: valid.certificate,
      getObjectBytes: getObjectBytes(valid.objects),
      getObjectIntegrity: getObjectIntegrity(valid.objects),
    }),
    "the exact persisted review-frame bytes must satisfy the sealed evidence receipt",
  );

  const missing = buildFixture();
  missing.objects.delete(missing.frameArtifacts[0].r2Key);
  await assert.rejects(
    () => verifyFinalMasterReleaseEvidenceObjects({
      certificate: missing.certificate,
      getObjectBytes: getObjectBytes(missing.objects),
      getObjectIntegrity: getObjectIntegrity(missing.objects),
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
      getObjectIntegrity: getObjectIntegrity(overwrittenSameLength.objects),
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
      getObjectIntegrity: getObjectIntegrity(differentLength.objects),
    }),
    /frame bytes do not match receipt/,
    "a different-byte-length frame must not satisfy the original review receipt",
  );

  const missingMaster = buildFixture();
  missingMaster.objects.delete(missingMaster.certificate.finalMaster.r2Key);
  await assert.rejects(
    () => verifyFinalMasterReleaseEvidenceObjects({
      certificate: missingMaster.certificate,
      getObjectBytes: getObjectBytes(missingMaster.objects),
      getObjectIntegrity: getObjectIntegrity(missingMaster.objects),
    }),
    /final-master release object is unavailable/,
    "a missing stored final master must stop release evidence verification",
  );

  const missingThumbnail = buildFixture();
  missingThumbnail.objects.delete(missingThumbnail.thumbnailKey);
  await assert.rejects(
    () => verifyFinalMasterReleaseEvidenceObjects({
      certificate: missingThumbnail.certificate,
      getObjectBytes: getObjectBytes(missingThumbnail.objects),
      getObjectIntegrity: getObjectIntegrity(missingThumbnail.objects),
    }),
    /package-to-opening thumbnail is unavailable/,
    "a missing package thumbnail must stop a later release retry",
  );

  const overwrittenThumbnail = buildFixture();
  overwrittenThumbnail.objects.set(
    overwrittenThumbnail.thumbnailKey,
    Buffer.alloc(overwrittenThumbnail.thumbnailBytes.byteLength, 0x5a),
  );
  await assert.rejects(
    () => verifyFinalMasterReleaseEvidenceObjects({
      certificate: overwrittenThumbnail.certificate,
      getObjectBytes: getObjectBytes(overwrittenThumbnail.objects),
      getObjectIntegrity: getObjectIntegrity(overwrittenThumbnail.objects),
    }),
    /package-to-opening thumbnail bytes do not match the sealed receipt/,
    "a same-length thumbnail replacement must not masquerade as the selected package art",
  );

  const replacedMaster = buildFixture();
  replacedMaster.objects.set(
    replacedMaster.certificate.finalMaster.r2Key,
    Buffer.alloc(replacedMaster.masterBytes.byteLength, 0x5a),
  );
  await assert.rejects(
    () => verifyFinalMasterReleaseEvidenceObjects({
      certificate: replacedMaster.certificate,
      getObjectBytes: getObjectBytes(replacedMaster.objects),
      getObjectIntegrity: getObjectIntegrity(replacedMaster.objects),
    }),
    /final-master release object bytes do not match receipt/,
    "a same-length replacement must not masquerade as the reviewed final master",
  );

  const mismatchedMaster = buildFixture();
  mismatchedMaster.objects.set(
    mismatchedMaster.certificate.finalMaster.r2Key,
    Buffer.concat([mismatchedMaster.masterBytes, Buffer.from(" changed")]),
  );
  await assert.rejects(
    () => verifyFinalMasterReleaseEvidenceObjects({
      certificate: mismatchedMaster.certificate,
      getObjectBytes: getObjectBytes(mismatchedMaster.objects),
      getObjectIntegrity: getObjectIntegrity(mismatchedMaster.objects),
    }),
    /final-master release object bytes do not match receipt/,
    "a byte-length mismatch must not satisfy the final-master receipt",
  );

  const validCleanup = await pruneFixture(buildFixture());
  assert.equal(validCleanup.result.cleaned, true, "cleanup may proceed only after all evidence bytes revalidate");
  assert.deepEqual(
    validCleanup.deleteCalls,
    [[`${keyPrefix}runs/${runId}/intermediates/parent-scene-01.mp4`]],
    "cleanup must retain the certificate, receipt, manifest, frames, and final master",
  );

  const parentForDerivativeCleanup = buildFixture();
  const shortForDerivativeCleanup = buildFixture("short");
  const derivativeCleanup = await pruneFixture(
    parentForDerivativeCleanup,
    [shortForDerivativeCleanup],
  );
  assert.equal(
    derivativeCleanup.result.cleaned,
    true,
    "cleanup may proceed when parent and independently certified derivative evidence both revalidate",
  );
  assert.deepEqual(
    derivativeCleanup.deleteCalls,
    [[
      `${keyPrefix}runs/${runId}/intermediates/parent-scene-01.mp4`,
      `${keyPrefix}runs/${runId}/intermediates/short-scene-01.mp4`,
    ]],
    "cleanup must retain the derivative master and every one of its evidence objects",
  );
  assert(
    derivativeCleanup.result.retainedReleaseEvidence.includes(shortForDerivativeCleanup.certificate.finalMaster.r2Key),
    "the certified derivative master itself must survive cleanup",
  );

  const parentWithBrokenDerivative = buildFixture();
  const brokenDerivative = buildFixture("short");
  brokenDerivative.objects.delete(brokenDerivative.frameArtifacts[0].r2Key);
  const brokenDerivativeCleanup = await pruneFixture(
    parentWithBrokenDerivative,
    [brokenDerivative],
  );
  assert.equal(
    brokenDerivativeCleanup.result.cleaned,
    false,
    "a missing derivative evidence frame must stop cleanup before any object is deleted",
  );
  assert.equal(brokenDerivativeCleanup.result.removedObjects, 0);
  assert.deepEqual(
    brokenDerivativeCleanup.deleteCalls,
    [],
    "cleanup must preserve the whole run namespace when derivative proof is incomplete",
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

  const replacedMasterCleanupFixture = buildFixture();
  replacedMasterCleanupFixture.objects.set(
    replacedMasterCleanupFixture.certificate.finalMaster.r2Key,
    Buffer.alloc(replacedMasterCleanupFixture.masterBytes.byteLength, 0x44),
  );
  const replacedMasterCleanup = await pruneFixture(replacedMasterCleanupFixture);
  assert.equal(
    replacedMasterCleanup.result.cleaned,
    false,
    "cleanup must fail closed when the stored final master was replaced",
  );
  assert.equal(replacedMasterCleanup.result.removedObjects, 0);
  assert.deepEqual(
    replacedMasterCleanup.deleteCalls,
    [],
    "cleanup must not delete anything when final-master bytes diverge",
  );
}

main().then(() => console.log("final-master release evidence integrity tests passed"));
