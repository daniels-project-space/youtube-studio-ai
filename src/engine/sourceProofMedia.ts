import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * A real source-proof image is evidence, not a prompt.  This contract keeps
 * its source, rights decision, immutable bytes, and approval receipt together
 * from a signed cinematic shot through the rendered-footage manifest.
 */
export const SOURCE_PROOF_MEDIA_VERSION = "source-proof-media/v1";
export const SOURCE_PROOF_MEDIA_RECEIPT_VERSION = "source-proof-media-receipt/v1";

const identifier = (prefix: string) =>
  z.string().trim().regex(new RegExp(`^${prefix}-[a-z0-9][a-z0-9_-]{1,119}$`));
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const httpsUrl = z.string().url().refine((value) => value.startsWith("https://"), "expected an https URL");

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export const SourceProofMediaObligationSchema = z
  .object({
    version: z.literal(SOURCE_PROOF_MEDIA_VERSION),
    /** Exact admitted Casefile source, never a search query. */
    sourceId: identifier("source"),
    /** Exact approved visual asset from that source's visual-use ledger. */
    assetId: identifier("asset"),
    /** Must be the same rights evidence attached to the visual-media ledger entry. */
    rightsEvidenceLocator: httpsUrl,
    /** Prevents reusing an approved asset against a different source packet. */
    sourcePacketFingerprint: sha256,
    /** Immutable approved source-image location; arbitrary search is forbidden. */
    assetUrl: httpsUrl,
    /** Immutable bytes expected from assetUrl. */
    assetSha256: sha256,
    /** Human approval record for this exact visual asset. */
    approvalReceiptId: identifier("source-proof-receipt"),
    /** Deterministic fingerprint of source/right/asset provenance below. */
    provenanceFingerprint: sha256,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.provenanceFingerprint !== sourceProofMediaProvenanceFingerprint(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["provenanceFingerprint"],
        message: "source-proof media provenance fingerprint does not bind this exact source, rights record, asset, and source packet",
      });
    }
  });

export type SourceProofMediaObligation = z.infer<typeof SourceProofMediaObligationSchema>;

/** Stable provenance fingerprint used in both signed planning and runtime receipts. */
export function sourceProofMediaProvenanceFingerprint(
  value: Pick<
    SourceProofMediaObligation,
    | "version"
    | "sourceId"
    | "assetId"
    | "rightsEvidenceLocator"
    | "sourcePacketFingerprint"
    | "assetUrl"
    | "assetSha256"
    | "approvalReceiptId"
  >,
): string {
  return fingerprint({
    version: value.version,
    sourceId: value.sourceId,
    assetId: value.assetId,
    rightsEvidenceLocator: value.rightsEvidenceLocator,
    sourcePacketFingerprint: value.sourcePacketFingerprint,
    assetUrl: value.assetUrl,
    assetSha256: value.assetSha256,
    approvalReceiptId: value.approvalReceiptId,
  });
}

export const SourceProofMediaReceiptSchema = z
  .object({
    version: z.literal(SOURCE_PROOF_MEDIA_RECEIPT_VERSION),
    /** The only cinematic shot that may use this source asset. */
    sceneId: identifier("cinematic-shot"),
    sequenceFingerprint: sha256,
    obligation: SourceProofMediaObligationSchema,
    /** Rechecked from downloaded bytes immediately before Ken Burns rendering. */
    resolvedAssetSha256: sha256,
    /** Hash of the deterministic evidence clip actually passed to assembly. */
    sourceProofClipSha256: sha256,
    /** Durable R2 key of that exact evidence clip. */
    clipKey: z.string().trim().min(1).max(1_500),
    receiptFingerprint: sha256,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.resolvedAssetSha256 !== value.obligation.assetSha256) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resolvedAssetSha256"],
        message: "source-proof receipt bytes do not match the approved asset SHA-256",
      });
    }
    if (value.receiptFingerprint !== sourceProofMediaReceiptFingerprint(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["receiptFingerprint"],
        message: "source-proof media receipt fingerprint does not bind its exact clip and approved asset",
      });
    }
  });

export type SourceProofMediaReceipt = z.infer<typeof SourceProofMediaReceiptSchema>;

export function sourceProofMediaReceiptFingerprint(
  value: Omit<SourceProofMediaReceipt, "receiptFingerprint"> | SourceProofMediaReceipt,
): string {
  return fingerprint({
    version: value.version,
    sceneId: value.sceneId,
    sequenceFingerprint: value.sequenceFingerprint,
    obligation: value.obligation,
    resolvedAssetSha256: value.resolvedAssetSha256,
    sourceProofClipSha256: value.sourceProofClipSha256,
    clipKey: value.clipKey,
  });
}

export function createSourceProofMediaReceipt(args: {
  sceneId: string;
  sequenceFingerprint: string;
  obligation: SourceProofMediaObligation;
  resolvedAssetSha256: string;
  sourceProofClipSha256: string;
  clipKey: string;
}): SourceProofMediaReceipt {
  const withoutFingerprint: Omit<SourceProofMediaReceipt, "receiptFingerprint"> = {
    version: SOURCE_PROOF_MEDIA_RECEIPT_VERSION,
    sceneId: args.sceneId,
    sequenceFingerprint: args.sequenceFingerprint,
    obligation: args.obligation,
    resolvedAssetSha256: args.resolvedAssetSha256,
    sourceProofClipSha256: args.sourceProofClipSha256,
    clipKey: args.clipKey,
  };
  return SourceProofMediaReceiptSchema.parse({
    ...withoutFingerprint,
    receiptFingerprint: sourceProofMediaReceiptFingerprint(withoutFingerprint),
  });
}

/**
 * Verifies that a persisted receipt is attached to the exact approved scene
 * and sequence.  The caller may additionally supply the signed obligation to
 * prevent an asset receipt being replayed on another source-proof shot.
 */
export function assertSourceProofMediaReceipt(args: {
  receipt: unknown;
  sceneId: string;
  sequenceFingerprint: string;
  obligation?: unknown;
}): SourceProofMediaReceipt {
  const receipt = SourceProofMediaReceiptSchema.parse(args.receipt);
  if (receipt.sceneId !== args.sceneId) {
    throw new Error(`source-proof media receipt belongs to ${receipt.sceneId}, not cinematic scene ${args.sceneId}`);
  }
  if (receipt.sequenceFingerprint !== args.sequenceFingerprint) {
    throw new Error("source-proof media receipt belongs to a different cinematic sequence");
  }
  if (args.obligation !== undefined) {
    const obligation = SourceProofMediaObligationSchema.parse(args.obligation);
    if (canonicalJson(receipt.obligation) !== canonicalJson(obligation)) {
      throw new Error("source-proof media receipt does not preserve the signed source/right/asset obligation");
    }
  }
  return receipt;
}
