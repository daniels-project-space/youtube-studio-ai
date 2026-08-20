import { createHash } from "node:crypto";

import {
  assertSourceProofMediaReceipt,
  createSourceProofMediaReceipt,
  SourceProofMediaObligationSchema,
  type SourceProofMediaReceipt,
} from "@/engine/sourceProofMedia";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Re-check the durable R2 evidence clip immediately before it enters the
 * authored cinematic timeline. This closes the object-store mutation window
 * between the original source-proof receipt and final assembly.
 */
export function assertSourceProofMediaClipBytes(args: {
  receipt: unknown;
  sceneId: string;
  sequenceFingerprint: string;
  bytes: Uint8Array;
}): SourceProofMediaReceipt {
  const receipt = assertSourceProofMediaReceipt({
    receipt: args.receipt,
    sceneId: args.sceneId,
    sequenceFingerprint: args.sequenceFingerprint,
  });
  const actualSha256 = sha256(args.bytes);
  if (actualSha256 !== receipt.sourceProofClipSha256) {
    throw new Error(
      `source-proof clip ${args.sceneId} SHA-256 mismatch at assembly; refusing altered evidence media`,
    );
  }
  return receipt;
}

/**
 * Resolve one signed source-proof visual into a deterministic evidence clip.
 *
 * This has no generated-video dependency by design. The approved bytes are
 * hash-checked before the Ken Burns pass; any missing, altered, or unwritable
 * asset throws, leaving no route to an LTX or search-result substitute.
 */
export async function resolveApprovedSourceProofMedia(args: {
  sceneId: string;
  sequenceFingerprint: string;
  obligation: unknown;
  durationSec: number;
  assetPath: string;
  clipPath: string;
  clipKey: string;
  downloadAsset: (url: string, destination: string) => Promise<string>;
  readBytes: (path: string) => Promise<Uint8Array>;
  createEvidenceClip: (assetPath: string, clipPath: string, durationSec: number) => Promise<string>;
  putEvidenceClip: (key: string, bytes: Uint8Array) => Promise<string>;
}): Promise<{ localPath: string; receipt: SourceProofMediaReceipt }> {
  const obligation = SourceProofMediaObligationSchema.parse(args.obligation);
  const downloadedPath = await args.downloadAsset(obligation.assetUrl, args.assetPath);
  const assetBytes = await args.readBytes(downloadedPath);
  const resolvedAssetSha256 = sha256(assetBytes);
  if (resolvedAssetSha256 !== obligation.assetSha256) {
    throw new Error(
      `source-proof media ${obligation.assetId} SHA-256 mismatch; expected approved bytes and refusing any substitute`,
    );
  }
  const localPath = await args.createEvidenceClip(downloadedPath, args.clipPath, args.durationSec);
  const clipBytes = await args.readBytes(localPath);
  const sourceProofClipSha256 = sha256(clipBytes);
  const persistedKey = await args.putEvidenceClip(args.clipKey, clipBytes);
  if (persistedKey !== args.clipKey) {
    throw new Error("source-proof media persistence returned an unexpected clip key");
  }
  return {
    localPath,
    receipt: createSourceProofMediaReceipt({
      sceneId: args.sceneId,
      sequenceFingerprint: args.sequenceFingerprint,
      obligation,
      resolvedAssetSha256,
      sourceProofClipSha256,
      clipKey: persistedKey,
    }),
  };
}
