import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  GENERATED_FOOTAGE_SCENE_MANIFEST_VERSION,
  GeneratedFootageSceneManifestSchema,
} from "@/engine/generatedFootageManifest";
import {
  SOURCE_PROOF_MEDIA_VERSION,
  assertSourceProofMediaReceipt,
  createSourceProofMediaReceipt,
  sourceProofMediaProvenanceFingerprint,
  type SourceProofMediaObligation,
} from "@/engine/sourceProofMedia";
import {
  assertSourceProofMediaClipBytes,
  resolveApprovedSourceProofMedia,
} from "@/lib/sourceProofMedia";

const sequenceFingerprint = "a".repeat(64);
const sceneId = "cinematic-shot-proof-media-001";
const assetBytes = Buffer.from("approved court archive image bytes");
const clipBytes = Buffer.from("deterministic ken-burns evidence clip bytes");

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function obligation(assetSha256 = sha256(assetBytes)): SourceProofMediaObligation {
  const value: SourceProofMediaObligation = {
    version: SOURCE_PROOF_MEDIA_VERSION,
    sourceId: "source-court-archive",
    assetId: "asset-court-archive-verdict-finding",
    rightsEvidenceLocator: "https://court.example.org/rights/verdict-archive-license",
    sourcePacketFingerprint: "b".repeat(64),
    assetUrl: "https://court.example.org/media/verdict-finding.jpg",
    assetSha256,
    approvalReceiptId: "source-proof-receipt-verdict-archive-001",
    provenanceFingerprint: "0".repeat(64),
  };
  value.provenanceFingerprint = sourceProofMediaProvenanceFingerprint(value);
  return value;
}

async function main() {
  const approved = obligation();
  const localBytes = new Map<string, Uint8Array>([
    ["/tmp/source-proof-asset", assetBytes],
  ]);
  const persisted: Array<{ key: string; bytes: Uint8Array }> = [];
  let createCalls = 0;
  const resolved = await resolveApprovedSourceProofMedia({
    sceneId,
    sequenceFingerprint,
    obligation: approved,
    durationSec: 4,
    assetPath: "/tmp/source-proof-asset",
    clipPath: "/tmp/source-proof-clip.mp4",
    clipKey: "runs/test/source-proof/cinematic-shot-proof-media-001.mp4",
    downloadAsset: async (_url, destination) => destination,
    readBytes: async (path) => {
      const bytes = localBytes.get(path);
      if (!bytes) throw new Error(`missing test bytes at ${path}`);
      return bytes;
    },
    createEvidenceClip: async (_assetPath, destination) => {
      createCalls += 1;
      localBytes.set(destination, clipBytes);
      return destination;
    },
    putEvidenceClip: async (key, bytes) => {
      persisted.push({ key, bytes });
      return key;
    },
  });

  assert.equal(createCalls, 1, "approved bytes must be turned into exactly one evidence clip");
  assert.deepEqual(persisted, [{ key: resolved.receipt.clipKey, bytes: clipBytes }]);
  assert.equal(resolved.receipt.obligation.assetId, approved.assetId);
  assert.equal(resolved.receipt.resolvedAssetSha256, approved.assetSha256);
  assert.equal(resolved.receipt.sourceProofClipSha256, sha256(clipBytes));
  assert.equal(
    assertSourceProofMediaReceipt({
      receipt: resolved.receipt,
      sceneId,
      sequenceFingerprint,
      obligation: approved,
    }).receiptFingerprint,
    resolved.receipt.receiptFingerprint,
  );
  assert.equal(
    assertSourceProofMediaClipBytes({
      receipt: resolved.receipt,
      sceneId,
      sequenceFingerprint,
      bytes: clipBytes,
    }).clipKey,
    resolved.receipt.clipKey,
  );
  assert.throws(
    () => assertSourceProofMediaClipBytes({
      receipt: resolved.receipt,
      sceneId,
      sequenceFingerprint,
      bytes: Buffer.from("altered persisted evidence clip"),
    }),
    /SHA-256 mismatch at assembly/i,
    "assembly must reject an R2 object changed after the source-proof receipt",
  );

  // A source-proof manifest is valid without LTX keyframe/clip reviews. The
  // receipt makes that exception explicit and rejects a synthetic substitute.
  const manifest = GeneratedFootageSceneManifestSchema.parse({
    version: GENERATED_FOOTAGE_SCENE_MANIFEST_VERSION,
    source: "cinematic_case_sequence",
    sequenceFingerprint,
    exactOrder: true,
    durationSec: 4,
    items: [{
      sceneId,
      clipKey: resolved.receipt.clipKey,
      t0: 0,
      t1: 4,
      continuitySeed: 17,
      sourceProofMediaReceipt: resolved.receipt,
    }],
  });
  assert.equal(manifest.items[0]?.sourceProofMediaReceipt?.sourceProofClipSha256, sha256(clipBytes));

  const mutatedReceipt = structuredClone(resolved.receipt);
  mutatedReceipt.clipKey = "runs/test/source-proof/substitute.mp4";
  assert.throws(
    () => GeneratedFootageSceneManifestSchema.parse({ ...manifest, items: [{ ...manifest.items[0], sourceProofMediaReceipt: mutatedReceipt }] }),
    /source-proof|fingerprint/i,
    "a durable manifest must reject a receipt whose clip bytes/key were altered after approval",
  );
  const validReceiptForDifferentClip = createSourceProofMediaReceipt({
    sceneId,
    sequenceFingerprint,
    obligation: approved,
    resolvedAssetSha256: approved.assetSha256,
    sourceProofClipSha256: resolved.receipt.sourceProofClipSha256,
    clipKey: "runs/test/source-proof/another-approved-looking-clip.mp4",
  });
  assert.throws(
    () => GeneratedFootageSceneManifestSchema.parse({
      ...manifest,
      items: [{ ...manifest.items[0], sourceProofMediaReceipt: validReceiptForDifferentClip }],
    }),
    /exact clip key persisted in this footage manifest/i,
    "a valid source-proof receipt still cannot be bound to a different manifest clip key",
  );

  let rejectedCreateCalls = 0;
  let rejectedPutCalls = 0;
  const wrongBytes = obligation("c".repeat(64));
  await assert.rejects(
    () => resolveApprovedSourceProofMedia({
      sceneId,
      sequenceFingerprint,
      obligation: wrongBytes,
      durationSec: 4,
      assetPath: "/tmp/source-proof-asset",
      clipPath: "/tmp/source-proof-clip.mp4",
      clipKey: "runs/test/source-proof/cinematic-shot-proof-media-001.mp4",
      downloadAsset: async (_url, destination) => destination,
      readBytes: async () => assetBytes,
      createEvidenceClip: async () => {
        rejectedCreateCalls += 1;
        return "/tmp/should-not-exist.mp4";
      },
      putEvidenceClip: async (key) => {
        rejectedPutCalls += 1;
        return key;
      },
    }),
    /SHA-256 mismatch.*refusing any substitute/i,
  );
  assert.equal(rejectedCreateCalls, 0, "changed source bytes must fail before creating a clip");
  assert.equal(rejectedPutCalls, 0, "changed source bytes must fail before persisting a clip");

  console.log("source-proof media resolver and manifest fail-closed test passed");
}

void main();
