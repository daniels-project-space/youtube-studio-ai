/**
 * Durable, content-addressed proof that a released master is the exact file
 * inspected by final QA.  The certificate deliberately records only receipts
 * and storage references; it never authorizes a provider or a publication.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

import { canonicalJson } from "@/lib/canonicalJson";
import {
  assertReferenceQualityFinalMasterBinding,
  ReferenceQualityFinalMasterBindingSchema,
} from "@/lib/referenceQualityFinalMasterBinding";
import {
  assertFinalMasterNarrationSemanticEvidence,
  finalMasterNarrationTranscriptAuditObjectKey,
  FinalMasterNarrationSemanticEvidenceSchema,
} from "@/lib/narrationTranscriptProof";

export const FINAL_MASTER_RELEASE_CERTIFICATE_VERSION =
  "final-master-release-certificate/v1" as const;
/**
 * Compact Convex-safe pointer to the immutable R2 certificate. This deliberately
 * excludes cinematic/audio payloads so provenance survives when the complete
 * certificate is too large for an inline runArtifact payload.
 */
export const FINAL_MASTER_RELEASE_CERTIFICATE_REFERENCE_VERSION =
  "final-master-release-certificate-reference/v1" as const;
export const VISUAL_REVIEW_RELEASE_RECEIPT_VERSION =
  "visual-review-release-receipt/v1" as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, "expected SHA-256");
const objectKey = z.string().trim().min(1).max(2_000);
const finite = z.number().finite();

const visualReviewReceiptSchema = z.object({
  version: z.literal(VISUAL_REVIEW_RELEASE_RECEIPT_VERSION),
  reviewFingerprint: z.string().trim().min(1).max(256),
  reviewReceiptVersion: z.string().trim().min(1).max(128),
  reviewReceiptFingerprint: sha256,
  /** Content hash of this retained receipt, including its human-readable verdict. */
  releaseReceiptFingerprint: sha256,
  verdict: z.literal("pass"),
  summary: z.string().trim().min(1).max(20_000),
  defects: z.array(z.unknown()).max(10_000),
  focusWindows: z.array(z.unknown()).max(10_000),
  referenceCriteria: z.array(z.unknown()).max(10_000),
  referenceCriteriaComplete: z.literal(true),
  evidence: z.object({
    source: z.object({
      durationSec: finite.positive(),
      sha256,
    }).strict(),
    manifestKey: objectKey,
    frameKeys: z.array(objectKey).min(1).max(20_000),
  }).strict(),
}).strict();

export type VisualReviewReleaseReceipt = z.infer<typeof visualReviewReceiptSchema>;

export const FinalMasterReleaseCertificateSchema = z.object({
  version: z.literal(FINAL_MASTER_RELEASE_CERTIFICATE_VERSION),
  finalMaster: z.object({
    r2Key: objectKey,
    sha256,
    durationSec: finite.positive(),
  }).strict(),
  visualReview: z.object({
    evidenceManifestKey: objectKey,
    evidenceFrameKeys: z.array(objectKey).min(1).max(20_000),
    receiptKey: objectKey,
    reviewFingerprint: z.string().trim().min(1).max(256),
    reviewReceiptVersion: z.string().trim().min(1).max(128),
    reviewReceiptFingerprint: sha256,
    releaseReceiptFingerprint: sha256,
  }).strict(),
  /**
   * Exact static reference contract selected for this master. v1 can only
   * record explicitly unmeasured evidence; it must never imply approval.
   */
  referenceQuality: ReferenceQualityFinalMasterBindingSchema.optional(),
  /** Present only when the source-bound Casefile final-master reviewer ran. */
  cinematic: z.object({
    receiptFingerprint: sha256,
    receipt: z.unknown(),
  }).strict().optional(),
  /** Existing final-mix and narration receipts, when that lane produces them. */
  audio: z.object({
    narrationPerformance: z.unknown().optional(),
    finalMix: z.unknown().optional(),
    transcript: z.unknown().optional(),
    cueTiming: z.unknown().optional(),
    /** Local final-master speech audition, bound to the approved narration text. */
    finalMasterNarration: FinalMasterNarrationSemanticEvidenceSchema.optional(),
    finalMasterMeters: z.unknown().optional(),
    qualityAxis: z.unknown().optional(),
  }).strict().optional(),
  certificateFingerprint: sha256,
}).strict();

export const FinalMasterReleaseCertificateReferenceSchema = z.object({
  version: z.literal(FINAL_MASTER_RELEASE_CERTIFICATE_REFERENCE_VERSION),
  certificateKey: objectKey,
  certificateFingerprint: sha256,
  finalMaster: z.object({
    r2Key: objectKey,
    sha256,
    durationSec: finite.positive(),
  }).strict(),
  visualReview: z.object({
    evidenceManifestKey: objectKey,
    evidenceFrameCount: z.number().int().positive().max(20_000),
    evidenceFrameKeysFingerprint: sha256,
    receiptKey: objectKey,
    reviewFingerprint: z.string().trim().min(1).max(256),
    reviewReceiptVersion: z.string().trim().min(1).max(128),
    reviewReceiptFingerprint: sha256,
    releaseReceiptFingerprint: sha256,
  }).strict(),
}).strict();

export type FinalMasterReleaseCertificate = z.infer<typeof FinalMasterReleaseCertificateSchema>;
export type FinalMasterReleaseCertificateReference = z.infer<
  typeof FinalMasterReleaseCertificateReferenceSchema
>;

export type FinalMasterReleaseCertificateInput = Omit<
  FinalMasterReleaseCertificate,
  "certificateFingerprint"
>;

function normalizePrefix(keyPrefix: string): string {
  const normalized = keyPrefix.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalized) throw new Error("final-master release certificate requires a non-empty key prefix");
  return `${normalized}/`;
}

function runPrefix(keyPrefix: string, runId: string): string {
  const id = runId.trim();
  if (!id || /[\\/\u0000-\u001f]/.test(id)) {
    throw new Error("final-master release certificate requires a safe run id");
  }
  return `${normalizePrefix(keyPrefix)}runs/${id}/`;
}

function certificatePayload(value: FinalMasterReleaseCertificateInput): string {
  return canonicalJson(value);
}

export function finalMasterReleaseCertificateFingerprint(
  value: FinalMasterReleaseCertificateInput,
): string {
  return createHash("sha256")
    .update(`${FINAL_MASTER_RELEASE_CERTIFICATE_VERSION}\n${certificatePayload(value)}`)
    .digest("hex");
}

/** Build a deterministic certificate. Its key is derived from this fingerprint. */
export function createFinalMasterReleaseCertificate(
  input: FinalMasterReleaseCertificateInput,
): FinalMasterReleaseCertificate {
  const normalized = FinalMasterReleaseCertificateSchema.omit({ certificateFingerprint: true }).parse(input);
  const certificateFingerprint = finalMasterReleaseCertificateFingerprint(normalized);
  return assertFinalMasterReleaseCertificate({ ...normalized, certificateFingerprint });
}

/** The receipt sits beside the immutable visual-review evidence and is retained with it. */
export function visualReviewReleaseReceiptKey(
  keyPrefix: string,
  runId: string,
  releaseReceiptFingerprint: string,
): string {
  if (!sha256.safeParse(releaseReceiptFingerprint).success) {
    throw new Error("visual-review release receipt requires a SHA-256 receipt fingerprint");
  }
  return `${runPrefix(keyPrefix, runId)}visual-review/receipts/${releaseReceiptFingerprint}.json`;
}

export function finalMasterReleaseCertificateKey(
  keyPrefix: string,
  runId: string,
  certificateFingerprint: string,
): string {
  if (!sha256.safeParse(certificateFingerprint).success) {
    throw new Error("final-master release certificate requires a SHA-256 certificate fingerprint");
  }
  return `${runPrefix(keyPrefix, runId)}release-certificates/${certificateFingerprint}.json`;
}

/** A bounded digest preserves the complete review-frame set without copying it. */
export function finalMasterReleaseEvidenceFrameKeysFingerprint(keys: readonly string[]): string {
  const normalized = z.array(objectKey).min(1).max(20_000).parse([...keys]).sort();
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("final-master release certificate reference requires unique evidence frame keys");
  }
  return createHash("sha256").update(canonicalJson(normalized)).digest("hex");
}

type VisualReviewReleaseReceiptInput = Omit<
  VisualReviewReleaseReceipt,
  "version" | "releaseReceiptFingerprint"
>;

export function visualReviewReleaseReceiptFingerprint(
  value: VisualReviewReleaseReceiptInput,
): string {
  return createHash("sha256")
    .update(`${VISUAL_REVIEW_RELEASE_RECEIPT_VERSION}\n${canonicalJson(value)}`)
    .digest("hex");
}

export function createVisualReviewReleaseReceipt(input: VisualReviewReleaseReceiptInput): VisualReviewReleaseReceipt {
  const normalized = visualReviewReceiptSchema
    .omit({ version: true, releaseReceiptFingerprint: true })
    .parse(input);
  return visualReviewReceiptSchema.parse({
    version: VISUAL_REVIEW_RELEASE_RECEIPT_VERSION,
    ...normalized,
    releaseReceiptFingerprint: visualReviewReleaseReceiptFingerprint(normalized),
  });
}

/**
 * Parse and verify a certificate received from durable storage.  The fingerprint
 * check makes a syntactically valid but edited certificate fail closed.
 */
export function assertFinalMasterReleaseCertificate(value: unknown): FinalMasterReleaseCertificate {
  const certificate = FinalMasterReleaseCertificateSchema.parse(value);
  const { certificateFingerprint, ...unsigned } = certificate;
  const expected = finalMasterReleaseCertificateFingerprint(unsigned);
  if (certificateFingerprint !== expected) {
    throw new Error("final-master release certificate fingerprint does not match its payload");
  }
  if (certificate.referenceQuality) {
    assertReferenceQualityFinalMasterBinding({
      binding: certificate.referenceQuality,
      finalMasterSha256: certificate.finalMaster.sha256,
      visualReviewFingerprint: certificate.visualReview.reviewFingerprint,
      visualReviewReceiptFingerprint: certificate.visualReview.reviewReceiptFingerprint,
    });
  }
  if (certificate.audio?.finalMasterNarration) {
    const narrationEvidence = assertFinalMasterNarrationSemanticEvidence(
      certificate.audio.finalMasterNarration,
    );
    if (narrationEvidence.finalMaster.sha256 !== certificate.finalMaster.sha256) {
      throw new Error("final-master narration semantic evidence belongs to a different released master");
    }
    if (narrationEvidence.finalMaster.durationSec !== certificate.finalMaster.durationSec) {
      throw new Error("final-master narration semantic evidence duration does not match the released master");
    }
  }
  return certificate;
}

export function parseFinalMasterReleaseCertificateBytes(bytes: Uint8Array): FinalMasterReleaseCertificate {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error("final-master release certificate is not valid JSON");
  }
  return assertFinalMasterReleaseCertificate(decoded);
}

export function assertVisualReviewReleaseReceipt(value: unknown): VisualReviewReleaseReceipt {
  const receipt = visualReviewReceiptSchema.parse(value);
  const {
    version: _version,
    releaseReceiptFingerprint: _releaseReceiptFingerprint,
    ...unsigned
  } = receipt;
  void _version;
  void _releaseReceiptFingerprint;
  const expected = visualReviewReleaseReceiptFingerprint(unsigned);
  if (receipt.releaseReceiptFingerprint !== expected) {
    throw new Error("visual-review release receipt fingerprint does not match its payload");
  }
  return receipt;
}

export function parseVisualReviewReleaseReceiptBytes(bytes: Uint8Array): VisualReviewReleaseReceipt {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error("visual-review release receipt is not valid JSON");
  }
  return assertVisualReviewReleaseReceipt(decoded);
}

/**
 * Return the only R2 keys cleanup may retain for a certificate. Every one must
 * be inside this run's namespace; a malformed certificate can never widen a
 * scoped cleanup into another run or channel.
 */
export function retainedFinalMasterReleaseObjectKeys(args: {
  keyPrefix: string;
  runId: string;
  certificateKey: string;
  certificate: FinalMasterReleaseCertificate;
}): string[] {
  const certificate = assertFinalMasterReleaseCertificate(args.certificate);
  const prefix = runPrefix(args.keyPrefix, args.runId);
  const expectedCertificateKey = finalMasterReleaseCertificateKey(
    args.keyPrefix,
    args.runId,
    certificate.certificateFingerprint,
  );
  if (args.certificateKey !== expectedCertificateKey) {
    throw new Error("final-master release certificate key does not match its fingerprint/run namespace");
  }
  const expectedReceiptKey = visualReviewReleaseReceiptKey(
    args.keyPrefix,
    args.runId,
    certificate.visualReview.releaseReceiptFingerprint,
  );
  if (certificate.visualReview.receiptKey !== expectedReceiptKey) {
    throw new Error("final-master release certificate visual-review receipt key is not content-addressed for its run");
  }
  const narrationAuditArtifact = certificate.audio?.finalMasterNarration?.auditArtifact;
  if (narrationAuditArtifact) {
    const expectedNarrationAuditKey = finalMasterNarrationTranscriptAuditObjectKey(
      args.keyPrefix,
      args.runId,
      narrationAuditArtifact.contentSha256,
    );
    if (narrationAuditArtifact.r2Key !== expectedNarrationAuditKey) {
      throw new Error("final-master narration transcript audit key is not content-addressed for its run");
    }
  }
  const keys = [
    certificate.finalMaster.r2Key,
    certificate.visualReview.evidenceManifestKey,
    certificate.visualReview.receiptKey,
    ...certificate.visualReview.evidenceFrameKeys,
    ...(narrationAuditArtifact ? [narrationAuditArtifact.r2Key] : []),
    args.certificateKey,
  ];
  for (const key of keys) {
    if (!key.startsWith(prefix)) {
      throw new Error("final-master release evidence escapes the scoped run namespace");
    }
  }
  return [...new Set(keys)].sort();
}

/**
 * Build the small artifact record used by run-level provenance projection.
 * The complete certificate remains the authoritative R2 object; this compact
 * reference only retains its content address and the identity fields needed to
 * join QA, master, and review evidence without storing large narration or
 * cinematic receipts in Convex.
 */
export function createFinalMasterReleaseCertificateReference(args: {
  keyPrefix: string;
  runId: string;
  certificateKey: string;
  certificate: FinalMasterReleaseCertificate;
}): FinalMasterReleaseCertificateReference {
  const certificate = assertFinalMasterReleaseCertificate(args.certificate);
  // Reuse the stricter cleanup boundary: it validates the content-addressed
  // certificate and receipt keys and rejects cross-run R2 references.
  retainedFinalMasterReleaseObjectKeys({
    keyPrefix: args.keyPrefix,
    runId: args.runId,
    certificateKey: args.certificateKey,
    certificate,
  });

  return FinalMasterReleaseCertificateReferenceSchema.parse({
    version: FINAL_MASTER_RELEASE_CERTIFICATE_REFERENCE_VERSION,
    certificateKey: args.certificateKey,
    certificateFingerprint: certificate.certificateFingerprint,
    finalMaster: certificate.finalMaster,
    visualReview: {
      evidenceManifestKey: certificate.visualReview.evidenceManifestKey,
      evidenceFrameCount: certificate.visualReview.evidenceFrameKeys.length,
      evidenceFrameKeysFingerprint: finalMasterReleaseEvidenceFrameKeysFingerprint(
        certificate.visualReview.evidenceFrameKeys,
      ),
      receiptKey: certificate.visualReview.receiptKey,
      reviewFingerprint: certificate.visualReview.reviewFingerprint,
      reviewReceiptVersion: certificate.visualReview.reviewReceiptVersion,
      reviewReceiptFingerprint: certificate.visualReview.reviewReceiptFingerprint,
      releaseReceiptFingerprint: certificate.visualReview.releaseReceiptFingerprint,
    },
  });
}

/** Validate a receipt and evidence manifest before the connector is contacted. */
export function assertReleaseCertificateVisualReviewBindings(args: {
  certificate: FinalMasterReleaseCertificate;
  receipt: VisualReviewReleaseReceipt;
  evidenceManifest: unknown;
}): void {
  const certificate = assertFinalMasterReleaseCertificate(args.certificate);
  const receipt = assertVisualReviewReleaseReceipt(args.receipt);
  if (
    receipt.reviewFingerprint !== certificate.visualReview.reviewFingerprint ||
    receipt.reviewReceiptVersion !== certificate.visualReview.reviewReceiptVersion ||
    receipt.reviewReceiptFingerprint !== certificate.visualReview.reviewReceiptFingerprint ||
    receipt.releaseReceiptFingerprint !== certificate.visualReview.releaseReceiptFingerprint ||
    receipt.evidence.manifestKey !== certificate.visualReview.evidenceManifestKey ||
    receipt.evidence.source.sha256 !== certificate.finalMaster.sha256 ||
    canonicalJson(receipt.evidence.frameKeys) !== canonicalJson(certificate.visualReview.evidenceFrameKeys)
  ) {
    throw new Error("final-master release certificate does not match its visual-review receipt");
  }
  const manifest = z.object({
    source: z.object({ sha256 }).passthrough(),
    manifestKey: objectKey,
    frames: z.array(z.object({ r2Key: objectKey.optional() }).passthrough()),
  }).passthrough().safeParse(args.evidenceManifest);
  if (!manifest.success) {
    throw new Error("final-master release certificate references an invalid visual-review evidence manifest");
  }
  const manifestFrameKeys = manifest.data.frames.flatMap((frame) => frame.r2Key ? [frame.r2Key] : []).sort();
  if (
    manifest.data.source.sha256 !== certificate.finalMaster.sha256 ||
    manifest.data.manifestKey !== certificate.visualReview.evidenceManifestKey ||
    canonicalJson(manifestFrameKeys) !== canonicalJson(certificate.visualReview.evidenceFrameKeys)
  ) {
    throw new Error("final-master release certificate does not match its visual-review evidence manifest");
  }
}
