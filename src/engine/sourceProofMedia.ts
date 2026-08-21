import { z } from "zod";
import { sha256Hex } from "@/lib/sha256";

/**
 * A real source-proof image is evidence, not a prompt.  This contract keeps
 * its source, rights decision, immutable bytes, and approval receipt together
 * from a signed cinematic shot through the rendered-footage manifest.
 */
/**
 * v1 receipts remain parseable so historic evidence can be inspected, but
 * they cannot enter a new cinematic render or release path. v2 binds the
 * exact source citation that must be composed over the proof clip.
 */
export const LEGACY_SOURCE_PROOF_MEDIA_VERSION = "source-proof-media/v1";
export const SOURCE_PROOF_MEDIA_VERSION = "source-proof-media/v2";
export const LEGACY_SOURCE_PROOF_MEDIA_RECEIPT_VERSION = "source-proof-media-receipt/v1";
export const SOURCE_PROOF_MEDIA_RECEIPT_VERSION = "source-proof-media-receipt/v2";

const identifier = (prefix: string) =>
  z.string().trim().regex(new RegExp(`^${prefix}-[a-z0-9][a-z0-9_-]{1,119}$`));
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const httpsUrl = z.string().url().refine((value) => value.startsWith("https://"), "expected an https URL");
const httpLocator = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://") || value.startsWith("http://"), "expected an http(s) URL");
const citationText = z
  .string()
  .trim()
  .min(1)
  .max(480)
  .refine((value) => !/[\r\n]/.test(value), "citation label must be a single display line");

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
  // This schema is shared with Convex's V8 isolate through the Casefile
  // admission spine, where `node:crypto` is unavailable. `sha256Hex` is a
  // synchronous, byte-for-byte equivalent SHA-256 implementation with its own
  // Node equivalence vectors, so the durable receipt identity is unchanged.
  return sha256Hex(canonicalJson(value));
}

/**
 * Citation data is source evidence, not free overlay copy. It is sealed into
 * the source-proof provenance and derived from the admitted Casefile ledger.
 */
export const SourceProofCitationSchema = z
  .object({
    sourceId: identifier("source"),
    label: citationText,
    /** Preserve the exact Casefile source locator; legacy sources may be http. */
    locator: httpLocator,
  })
  .strict();
export type SourceProofCitation = z.infer<typeof SourceProofCitationSchema>;

const SourceProofMediaObligationBaseSchema = z
  .object({
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
  .strict();

export const LegacySourceProofMediaObligationSchema = SourceProofMediaObligationBaseSchema
  .extend({
    version: z.literal(LEGACY_SOURCE_PROOF_MEDIA_VERSION),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.provenanceFingerprint !== sourceProofMediaProvenanceFingerprint(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["provenanceFingerprint"],
        message: "legacy source-proof media provenance fingerprint does not bind this exact source, rights record, asset, and source packet",
      });
    }
  });

export const CurrentSourceProofMediaObligationSchema = SourceProofMediaObligationBaseSchema
  .extend({
    version: z.literal(SOURCE_PROOF_MEDIA_VERSION),
    /** Exact Casefile citation that the local compositor must visibly render. */
    citation: SourceProofCitationSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.citation.sourceId !== value.sourceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["citation", "sourceId"],
        message: "source-proof citation must name the exact approved source",
      });
    }
    if (value.provenanceFingerprint !== sourceProofMediaProvenanceFingerprint(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["provenanceFingerprint"],
        message: "source-proof media provenance fingerprint does not bind this exact source, rights record, asset, source packet, and citation",
      });
    }
  });

/** Parses current and historical durable evidence without promoting legacy proof. */
export const SourceProofMediaObligationSchema = z.union([
  LegacySourceProofMediaObligationSchema,
  CurrentSourceProofMediaObligationSchema,
]);

export type LegacySourceProofMediaObligation = z.infer<typeof LegacySourceProofMediaObligationSchema>;
export type CurrentSourceProofMediaObligation = z.infer<typeof CurrentSourceProofMediaObligationSchema>;
export type SourceProofMediaObligation =
  | LegacySourceProofMediaObligation
  | CurrentSourceProofMediaObligation;

type SourceProofMediaProvenanceInput = {
  version: typeof LEGACY_SOURCE_PROOF_MEDIA_VERSION | typeof SOURCE_PROOF_MEDIA_VERSION;
  sourceId: string;
  assetId: string;
  rightsEvidenceLocator: string;
  sourcePacketFingerprint: string;
  assetUrl: string;
  assetSha256: string;
  approvalReceiptId: string;
  citation?: SourceProofCitation;
};

/** Stable provenance fingerprint used in both signed planning and runtime receipts. */
export function sourceProofMediaProvenanceFingerprint(
  value: SourceProofMediaProvenanceInput,
): string {
  const citation = value.version === SOURCE_PROOF_MEDIA_VERSION ? value.citation : undefined;
  return fingerprint({
    version: value.version,
    sourceId: value.sourceId,
    assetId: value.assetId,
    rightsEvidenceLocator: value.rightsEvidenceLocator,
    sourcePacketFingerprint: value.sourcePacketFingerprint,
    assetUrl: value.assetUrl,
    assetSha256: value.assetSha256,
    approvalReceiptId: value.approvalReceiptId,
    ...(citation ? { citation } : {}),
  });
}

const SourceProofMediaReceiptBaseSchema = z
  .object({
    /** The only cinematic shot that may use this source asset. */
    sceneId: identifier("cinematic-shot"),
    sequenceFingerprint: sha256,
    /** Rechecked from downloaded bytes immediately before Ken Burns rendering. */
    resolvedAssetSha256: sha256,
    /** Hash of the deterministic raw evidence clip actually passed to assembly. */
    sourceProofClipSha256: sha256,
    /** Durable R2 key of that exact raw evidence clip. */
    clipKey: z.string().trim().min(1).max(1_500),
    receiptFingerprint: sha256,
  })
  .strict();

export const LegacySourceProofMediaReceiptSchema = SourceProofMediaReceiptBaseSchema
  .extend({
    version: z.literal(LEGACY_SOURCE_PROOF_MEDIA_RECEIPT_VERSION),
    obligation: LegacySourceProofMediaObligationSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.resolvedAssetSha256 !== value.obligation.assetSha256) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resolvedAssetSha256"],
        message: "legacy source-proof receipt bytes do not match the approved asset SHA-256",
      });
    }
    if (value.receiptFingerprint !== sourceProofMediaReceiptFingerprint(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["receiptFingerprint"],
        message: "legacy source-proof media receipt fingerprint does not bind its exact clip and approved asset",
      });
    }
  });

export const CurrentSourceProofMediaReceiptSchema = SourceProofMediaReceiptBaseSchema
  .extend({
    version: z.literal(SOURCE_PROOF_MEDIA_RECEIPT_VERSION),
    obligation: CurrentSourceProofMediaObligationSchema,
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
        message: "source-proof media receipt fingerprint does not bind its exact clip, approved asset, and citation",
      });
    }
  });

/** Parses current and historical durable receipts without promoting legacy proof. */
export const SourceProofMediaReceiptSchema = z.union([
  LegacySourceProofMediaReceiptSchema,
  CurrentSourceProofMediaReceiptSchema,
]);

export type LegacySourceProofMediaReceipt = z.infer<typeof LegacySourceProofMediaReceiptSchema>;
export type CurrentSourceProofMediaReceipt = z.infer<typeof CurrentSourceProofMediaReceiptSchema>;
export type SourceProofMediaReceipt =
  | LegacySourceProofMediaReceipt
  | CurrentSourceProofMediaReceipt;

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
  obligation: CurrentSourceProofMediaObligation;
  resolvedAssetSha256: string;
  sourceProofClipSha256: string;
  clipKey: string;
}): CurrentSourceProofMediaReceipt {
  const withoutFingerprint: Omit<CurrentSourceProofMediaReceipt, "receiptFingerprint"> = {
    version: SOURCE_PROOF_MEDIA_RECEIPT_VERSION,
    sceneId: args.sceneId,
    sequenceFingerprint: args.sequenceFingerprint,
    obligation: args.obligation,
    resolvedAssetSha256: args.resolvedAssetSha256,
    sourceProofClipSha256: args.sourceProofClipSha256,
    clipKey: args.clipKey,
  };
  return CurrentSourceProofMediaReceiptSchema.parse({
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

/**
 * New cinematic work must use v2 proof with a sealed, renderable citation.
 * Legacy v1 remains available through the generic schemas above strictly for
 * read-only history inspection.
 */
export function assertCurrentSourceProofMediaObligation(value: unknown): CurrentSourceProofMediaObligation {
  const obligation = SourceProofMediaObligationSchema.parse(value);
  if (obligation.version !== SOURCE_PROOF_MEDIA_VERSION) {
    throw new Error(
      "legacy citation-less source-proof obligation is read-only history and cannot enter a new cinematic admission or release",
    );
  }
  return CurrentSourceProofMediaObligationSchema.parse(obligation);
}

export function assertCurrentSourceProofMediaReceipt(args: {
  receipt: unknown;
  sceneId: string;
  sequenceFingerprint: string;
  obligation?: unknown;
}): CurrentSourceProofMediaReceipt {
  const obligation = args.obligation === undefined
    ? undefined
    : assertCurrentSourceProofMediaObligation(args.obligation);
  const receipt = assertSourceProofMediaReceipt({
    receipt: args.receipt,
    sceneId: args.sceneId,
    sequenceFingerprint: args.sequenceFingerprint,
    ...(obligation ? { obligation } : {}),
  });
  if (receipt.version !== SOURCE_PROOF_MEDIA_RECEIPT_VERSION) {
    throw new Error(
      "legacy citation-less source-proof receipt is read-only history and cannot enter a new cinematic admission or release",
    );
  }
  return CurrentSourceProofMediaReceiptSchema.parse(receipt);
}
