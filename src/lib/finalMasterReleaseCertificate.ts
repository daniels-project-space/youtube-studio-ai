/**
 * Durable, content-addressed proof that a released master is the exact file
 * inspected by final QA.  The certificate deliberately records only receipts
 * and storage references; it never authorizes a provider or a publication.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { z } from "zod";

import {
  assertReferenceQualityMechanicsLedger,
  assertReferenceQualityMechanicsProgramRouteBinding,
  assertReferenceQualityMechanicsVisualReceiptBinding,
  ReferenceQualityMechanicsLedgerSchema,
} from "@/engine/referenceQualityMechanicsRegistry";
import {
  assertVisualSequenceEvidenceOmission,
  assertVisualSequenceEvidenceLedger,
  VisualSequenceEvidenceOmissionSchema,
  VisualSequenceEvidenceLedgerSchema,
} from "@/engine/visualSequenceContract";
import {
  assertViewerPromiseProgressionCertificateBinding,
  assertViewerPromiseProgressionOmissionCertificateBinding,
  ViewerPromiseProgressionOmissionSchema,
  ViewerPromiseProgressionReceiptSchema,
} from "@/engine/viewerPromiseProgression";
import {
  assertPackageToOpeningOmission,
  assertPackageToOpeningReceiptCertificateBinding,
  PackageToOpeningOmissionSchema,
  PackageToOpeningReceiptSchema,
} from "@/engine/packageToOpening";
import {
  assertShortsOpeningEvidenceCertificateBinding,
  ShortsOpeningEvidenceSchema,
} from "@/engine/shortsOpeningEvidence";
import { ChannelProgramRouteRunSeedSchema } from "@/engine/channelProgramRoute";
import { ScenarioVisualTreatmentSchema } from "@/engine/scenarioVisualTreatment";
import { FINAL_MASTER_NARRATED_STORY_COVERAGE_SOURCE } from "@/engine/qualityEvidence";
import { canonicalJson } from "@/lib/canonicalJson";
import {
  assertReferenceQualityFinalMasterBinding,
  REFERENCE_QUALITY_EVIDENCE_BRIDGE_V2_VERSION,
  ReferenceQualityFinalMasterBindingAnySchema,
} from "@/lib/referenceQualityFinalMasterBinding";
import {
  assertFinalMasterNarrationTranscriptAuditBinding,
  assertFinalMasterNarrationSemanticEvidence,
  finalMasterNarrationTranscriptAuditObjectKey,
  FinalMasterNarrationSemanticEvidenceSchema,
  parseFinalMasterNarrationTranscriptAuditBytes,
} from "@/lib/narrationTranscriptProof";
import {
  assertFinalMasterNarratedStoryCoverageReceipt,
  assertFinalMasterNarratedStoryCoverageReceiptBinding,
  finalMasterNarratedStoryCoverageAuditObjectKey,
  FinalMasterNarratedStoryCoverageReceiptSchema,
  parseFinalMasterNarratedStoryCoverageAuditBytes,
} from "@/lib/finalMasterNarratedStoryCoverage";
import { OnScreenTextProofSchema } from "@/lib/onScreenTextProof";
import {
  assertFinalMasterQualityEvidenceBinding,
  FinalMasterQualityEvidenceBindingSchema,
  type FinalMasterQualityEvidenceCoverage,
  type FinalMasterStoryMeasurementCoverage,
} from "@/lib/finalMasterQualityEvidenceBinding";
import {
  assertFinalMasterVisualPacingBinding,
  FinalMasterVisualPacingBindingSchema,
} from "@/lib/finalMasterVisualPacingBinding";
import {
  assertThirdPartyStockEvidenceReferenceBinding,
  parseThirdPartyStockEvidenceManifestBytes,
  thirdPartyStockEvidenceManifestKey,
  ThirdPartyStockEvidenceReferenceSchema,
} from "@/lib/thirdPartyStockEvidence";
import { NarrativeShortOriginSchema } from "@/lib/narrativeShortOrigin";
import {
  assertStudioAssetReleaseUsageReceipt,
  assertStudioLtxReleaseAdapterBinding,
  StudioAssetReleaseUsageReceiptSchema,
  STUDIO_LTX_RELEASE_ADAPTER_BINDING_VERSION,
} from "@/engine/studioAssetLibrary";
import {
  assertStudioPostproductionDecisionReceipt,
  StudioPostproductionDecisionReceiptSchema,
} from "@/engine/studioPostproductionDecision";

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
const evidenceFrameArtifactSchema = z.object({
  /** Durable review-frame identity; absent only on historical v1 receipts. */
  id: z.string().trim().min(1).max(240).optional(),
  /** Exact review sampling time; absent only on historical v1 receipts. */
  tSec: finite.nonnegative().optional(),
  r2Key: objectKey,
  contentSha256: sha256,
  byteLength: z.number().int().positive(),
}).strict();

/**
 * `byteLength` is optional solely so v1 certificates already retained in R2
 * remain readable.  Every newly created certificate must include it, and every
 * operational verification requires it before a release can be uploaded or
 * cleaned up.
 */
const finalMasterSchema = z.object({
  r2Key: objectKey,
  sha256,
  byteLength: z.number().int().positive().optional(),
  durationSec: finite.positive(),
}).strict();

export type FinalMasterReleaseEvidenceFrame = z.infer<typeof evidenceFrameArtifactSchema>;

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
  /**
   * Optional for pre-wide-sample v1 receipts. New qa_visual receipts bind the
   * conservative score from every broad final-review batch into this
   * content-addressed release proof.
   */
  broadQualityScore: z.object({
    version: z.literal("visual-review-wide-sample-quality/v1"),
    score: finite.min(0).max(10),
    broadBatchCount: z.number().int().positive(),
  }).strict().optional(),
  evidence: z.object({
    source: z.object({
      durationSec: finite.positive(),
      sha256,
    }).strict(),
    manifestKey: objectKey,
    frameKeys: z.array(objectKey).min(1).max(20_000),
    /** Older v1 receipts may omit this; release operations then fail closed. */
    frameArtifacts: z.array(evidenceFrameArtifactSchema).min(1).max(20_000).optional(),
  }).strict(),
}).strict();

export type VisualReviewReleaseReceipt = z.infer<typeof visualReviewReceiptSchema>;

export const FinalMasterReleaseCertificateSchema = z.object({
  version: z.literal(FINAL_MASTER_RELEASE_CERTIFICATE_VERSION),
  finalMaster: finalMasterSchema,
  visualReview: z.object({
    evidenceManifestKey: objectKey,
    evidenceFrameKeys: z.array(objectKey).min(1).max(20_000),
    /** Byte-level binding for each retained visual-review frame. */
    evidenceFrameArtifacts: z.array(evidenceFrameArtifactSchema).min(1).max(20_000).optional(),
    receiptKey: objectKey,
    reviewFingerprint: z.string().trim().min(1).max(256),
    reviewReceiptVersion: z.string().trim().min(1).max(128),
    reviewReceiptFingerprint: sha256,
    releaseReceiptFingerprint: sha256,
  }).strict(),
  /**
   * Optional immutable sidecar for narrated third-party stock. Historical
   * certificates intentionally remain readable without it. This pointer binds
   * only the compact rights evidence JSON, never raw source footage objects.
   */
  thirdPartyStockEvidence: ThirdPartyStockEvidenceReferenceSchema.optional(),
  /**
   * Immutable final-master narration-semantic coverage for a shared Story
   * Spine. It never represents visual-shot realization; the full audit is
   * retained as a separately content-addressed sidecar.
   */
  narratedStoryCoverage: FinalMasterNarratedStoryCoverageReceiptSchema.optional(),
  /**
   * Immutable structural binding from the selected package to the exact
   * thumbnail bytes and a retained opening-review frame. It deliberately does
   * not claim semantic equivalence in v1.
   */
  packageToOpening: PackageToOpeningReceiptSchema.optional(),
  /** Explicit non-gating reason when a new structural package receipt was unavailable. */
  packageToOpeningOmission: PackageToOpeningOmissionSchema.optional(),
  /**
   * Exact static reference contract selected for this master. v1 can only
   * record explicitly unmeasured evidence; it must never imply approval.
   */
  referenceQuality: ReferenceQualityFinalMasterBindingAnySchema.optional(),
  /**
   * Optional route-aware evidence coverage ledger. It records only existing
   * receipts and never changes release/publish authority; historical
   * certificates intentionally remain readable without it.
   */
  referenceQualityMechanics: ReferenceQualityMechanicsLedgerSchema.optional(),
  /**
   * Optional artifact-bound visual-sequence provenance. It records exactly
   * what raw-byte and final-master evidence exists; it never grants release,
   * readiness, assembly, or publishing authority.
   */
  visualSequenceEvidence: VisualSequenceEvidenceLedgerSchema.optional(),
  /**
   * Bounded, fingerprinted explanation when no ledger was attached. This
   * observability record never changes release or publishing authority.
   */
  visualSequenceEvidenceOmission: VisualSequenceEvidenceOmissionSchema.optional(),
  /**
   * Optional observation of plan anchors and existing final-review samples.
   * It is not a QA axis, score, or release/publish authority.
   */
  viewerPromiseProgression: ViewerPromiseProgressionReceiptSchema.optional(),
  /** Bounded non-gating explanation when that observation was not attached. */
  viewerPromiseProgressionOmission: ViewerPromiseProgressionOmissionSchema.optional(),
  /**
   * Full sealed route retained only with viewer-promise evidence so its
   * directive-derived promise can be recomputed during certificate parsing.
   * The receipt itself exposes only a hash of the viewer job.
   */
  viewerPromiseProgressionRoute: ChannelProgramRouteRunSeedSchema.optional(),
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
  /**
   * Optional deterministic OCR receipt for text burned into this exact master.
   * The post-transform Short route uses it for caption legibility; other lanes
   * remain compatible until they can emit equally concrete timed text cues.
   */
  onScreenText: OnScreenTextProofSchema.optional(),
  /**
   * A post-transform Short-only opening observation. It is optional for every
   * other lane and does not create a universal fast-cut/pacing requirement.
   */
  shortsOpeningEvidence: ShortsOpeningEvidenceSchema.optional(),
  /**
   * Optional provenance for a portrait Short selected from a sealed narrative
   * Episode Graph. The certificate fingerprint binds the exact parent master,
   * beat, source window, and candidate decision to these derivative bytes.
   */
  narrativeShortOrigin: NarrativeShortOriginSchema.optional(),
  /**
   * When the direct LTX renderer selected Studio-approved standard LoRAs,
   * this proves the exact selection matched the persisted per-shot render
   * manifest. IC-LoRAs remain absent until their distinct Comfy worker path is
   * separately admitted.
   */
  studioLtxAdapterBinding: z.object({
    version: z.literal(STUDIO_LTX_RELEASE_ADAPTER_BINDING_VERSION),
    shotRenderManifestFingerprint: sha256,
    globalSelectionFingerprint: sha256.optional(),
    perShotSelectionsFingerprint: sha256.optional(),
    sourceEntryFingerprints: z.array(sha256).min(1).max(12),
    fingerprint: sha256,
  }).strict().optional(),
  /**
   * Correlation-only record of approved Studio recipes present in this exact
   * passing master. It can inform future reuse ranking but never changes this
   * release decision or asserts a recipe caused the observed quality.
   */
  studioAssetReleaseUsage: StudioAssetReleaseUsageReceiptSchema.optional(),
  /**
   * Sealed actual timeline decisions. These distinguish a Studio transition
   * that won the edit from one merely resolved upstream and later overridden.
   */
  studioPostproductionDecisions: z.array(StudioPostproductionDecisionReceiptSchema).max(4).optional(),
  /**
   * Exact fictional-scenario visual policy when the renderer was bound to it.
   * It is included in the certificate payload, so the certificate fingerprint
   * binds this immutable policy to the same final-master byte receipt.
   */
  scenarioVisualTreatment: ScenarioVisualTreatmentSchema.optional(),
  /**
   * Shared final-QA receipt sealed to this exact master and visual-review
   * receipt. Optional so historical v1 certificates remain readable.
   */
  qualityEvidence: FinalMasterQualityEvidenceBindingSchema.optional(),
  /**
   * Exact final-master FFmpeg pacing receipt. It binds the lane policy and
   * matching QA/review fingerprints, rather than reducing pacing to text in a
   * generic quality-evidence array.
   */
  visualPacing: FinalMasterVisualPacingBindingSchema.optional(),
  certificateFingerprint: sha256,
}).strict();

export const FinalMasterReleaseCertificateReferenceSchema = z.object({
  version: z.literal(FINAL_MASTER_RELEASE_CERTIFICATE_REFERENCE_VERSION),
  certificateKey: objectKey,
  certificateFingerprint: sha256,
  finalMaster: finalMasterSchema,
  visualReview: z.object({
    evidenceManifestKey: objectKey,
    evidenceFrameCount: z.number().int().positive().max(20_000),
    evidenceFrameKeysFingerprint: sha256,
    evidenceFrameArtifactsFingerprint: sha256.optional(),
    receiptKey: objectKey,
    reviewFingerprint: z.string().trim().min(1).max(256),
    reviewReceiptVersion: z.string().trim().min(1).max(128),
    reviewReceiptFingerprint: sha256,
    releaseReceiptFingerprint: sha256,
  }).strict(),
  /** Compact provenance only; the full shared QA receipt remains in the R2 certificate. */
  qualityEvidence: z.object({
    bindingFingerprint: sha256,
    qualityEvidenceFingerprint: sha256,
    evidenceCoverage: z.enum(["complete", "partial", "unmeasured"]),
    /**
     * Measurement scope only: `plan_only` is pre-render and `final_master`
     * is source-backed ratio evidence, never an assertion of complete coverage.
     */
    storyMeasurementCoverage: z.enum([
      "unmeasured",
      "plan_only",
      "final_master",
      "scope_undeclared",
    ]).optional(),
  }).strict().optional(),
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
  requireFinalMasterByteReceipt(normalized.finalMaster, "new final-master release certificate");
  requireEvidenceFrameArtifacts({
    frameKeys: normalized.visualReview.evidenceFrameKeys,
    frameArtifacts: normalized.visualReview.evidenceFrameArtifacts,
    subject: "new final-master release certificate",
  });
  const certificateFingerprint = finalMasterReleaseCertificateFingerprint(normalized);
  return assertFinalMasterReleaseCertificate({ ...normalized, certificateFingerprint });
}

function requireFinalMasterByteReceipt(
  finalMaster: FinalMasterReleaseCertificate["finalMaster"],
  subject: string,
): { r2Key: string; sha256: string; byteLength: number; durationSec: number } {
  if (finalMaster.byteLength === undefined) {
    throw new Error(`${subject} lacks a byte-bound final-master receipt`);
  }
  return {
    r2Key: finalMaster.r2Key,
    sha256: finalMaster.sha256,
    byteLength: finalMaster.byteLength,
    durationSec: finalMaster.durationSec,
  };
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

function normalizeEvidenceFrameArtifacts(
  value: readonly FinalMasterReleaseEvidenceFrame[],
): FinalMasterReleaseEvidenceFrame[] {
  const normalized = z.array(evidenceFrameArtifactSchema).min(1).max(20_000)
    .parse([...value])
    .sort((left, right) => left.r2Key.localeCompare(right.r2Key));
  if (new Set(normalized.map((frame) => frame.r2Key)).size !== normalized.length) {
    throw new Error("final-master release certificate requires unique visual-review frame evidence keys");
  }
  return normalized;
}

/** Stable compact identity over key + byte digest + byte length for every review frame. */
export function finalMasterReleaseEvidenceFrameArtifactsFingerprint(
  frames: readonly FinalMasterReleaseEvidenceFrame[],
): string {
  return createHash("sha256")
    .update(canonicalJson(normalizeEvidenceFrameArtifacts(frames)))
    .digest("hex");
}

function requireEvidenceFrameArtifacts(args: {
  frameKeys: readonly string[];
  frameArtifacts: readonly FinalMasterReleaseEvidenceFrame[] | undefined;
  subject: string;
}): FinalMasterReleaseEvidenceFrame[] {
  if (!args.frameArtifacts) {
    throw new Error(`${args.subject} lacks byte-bound visual-review frame evidence`);
  }
  const normalized = normalizeEvidenceFrameArtifacts(args.frameArtifacts);
  const expectedKeys = [...args.frameKeys].sort();
  if (canonicalJson(normalized.map((frame) => frame.r2Key)) !== canonicalJson(expectedKeys)) {
    throw new Error(`${args.subject} visual-review frame byte evidence does not match its frame keys`);
  }
  return normalized;
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
  requireEvidenceFrameArtifacts({
    frameKeys: normalized.evidence.frameKeys,
    frameArtifacts: normalized.evidence.frameArtifacts,
    subject: "new visual-review release receipt",
  });
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
  // Preserve read access to pre-integrity v1 certificates. Upload and cleanup
  // require the byte receipts in assertRelease.../verify..., while an old
  // certificate can still be surfaced honestly as historical provenance.
  if (certificate.visualReview.evidenceFrameArtifacts) {
    requireEvidenceFrameArtifacts({
      frameKeys: certificate.visualReview.evidenceFrameKeys,
      frameArtifacts: certificate.visualReview.evidenceFrameArtifacts,
      subject: "final-master release certificate",
    });
  }
  if (certificate.referenceQuality) {
    assertReferenceQualityFinalMasterBinding({
      binding: certificate.referenceQuality,
      finalMasterSha256: certificate.finalMaster.sha256,
      visualReviewFingerprint: certificate.visualReview.reviewFingerprint,
      visualReviewReceiptFingerprint: certificate.visualReview.reviewReceiptFingerprint,
      finalMasterDurationSec: certificate.finalMaster.durationSec,
      visualReviewReleaseReceiptFingerprint: certificate.visualReview.releaseReceiptFingerprint,
      visualReviewReceiptVersion: certificate.visualReview.reviewReceiptVersion,
      finalMasterNarration: certificate.audio?.finalMasterNarration,
      audioAxis: certificate.audio?.qualityAxis,
    });
  }
  if (certificate.referenceQualityMechanics) {
    assertReferenceQualityMechanicsLedger({
      ledger: certificate.referenceQualityMechanics,
      referenceQualityBinding: certificate.referenceQuality,
      finalMasterQualityEvidenceBinding: certificate.qualityEvidence,
      finalMaster: {
        sha256: certificate.finalMaster.sha256,
        durationSec: certificate.finalMaster.durationSec,
      },
      visualReview: {
        reviewFingerprint: certificate.visualReview.reviewFingerprint,
        reviewReceiptVersion: certificate.visualReview.reviewReceiptVersion,
        reviewReceiptFingerprint: certificate.visualReview.reviewReceiptFingerprint,
        releaseReceiptFingerprint: certificate.visualReview.releaseReceiptFingerprint,
      },
    });
  }
  if (certificate.visualSequenceEvidence) {
    const finalMasterByteLength = certificate.finalMaster.byteLength;
    const evidenceFrameArtifacts = certificate.visualReview.evidenceFrameArtifacts;
    if (
      finalMasterByteLength === undefined ||
      !Number.isSafeInteger(finalMasterByteLength) ||
      finalMasterByteLength < 1 ||
      !evidenceFrameArtifacts
    ) {
      throw new Error(
        "visual-sequence evidence ledger requires byte-bound final-master and visual-review artifacts",
      );
    }
    assertVisualSequenceEvidenceLedger({
      ledger: certificate.visualSequenceEvidence,
      finalMaster: {
        sha256: certificate.finalMaster.sha256,
        byteLength: finalMasterByteLength,
        durationSec: certificate.finalMaster.durationSec,
      },
      visualReview: {
        evidenceManifestKey: certificate.visualReview.evidenceManifestKey,
        reviewFingerprint: certificate.visualReview.reviewFingerprint,
        reviewReceiptVersion: certificate.visualReview.reviewReceiptVersion,
        reviewReceiptFingerprint: certificate.visualReview.reviewReceiptFingerprint,
        releaseReceiptFingerprint: certificate.visualReview.releaseReceiptFingerprint,
        source: {
          sha256: certificate.finalMaster.sha256,
          durationSec: certificate.finalMaster.durationSec,
        },
        // Visual-sequence evidence predates durable review-frame identities.
        // Keep its existing byte-only contract rather than widening it.
        frameArtifacts: evidenceFrameArtifacts.map((frame) => ({
          r2Key: frame.r2Key,
          contentSha256: frame.contentSha256,
          byteLength: frame.byteLength,
        })),
      },
    });
  }
  if (
    certificate.visualSequenceEvidence &&
    certificate.visualSequenceEvidenceOmission
  ) {
    throw new Error(
      "final-master release certificate cannot attach visual-sequence evidence and an omission together",
    );
  }
  if (certificate.visualSequenceEvidenceOmission) {
    assertVisualSequenceEvidenceOmission(
      certificate.visualSequenceEvidenceOmission,
    );
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
  if (certificate.onScreenText) {
    const onScreenText = OnScreenTextProofSchema.parse(certificate.onScreenText);
    if (!onScreenText.passed || onScreenText.cues.some((cue) => !cue.passed)) {
      throw new Error("final-master on-screen text proof does not pass every required cue");
    }
    if (onScreenText.source.sha256 !== certificate.finalMaster.sha256) {
      throw new Error("final-master on-screen text proof belongs to a different released master");
    }
  }
  if (certificate.shortsOpeningEvidence) {
    assertShortsOpeningEvidenceCertificateBinding({
      evidence: certificate.shortsOpeningEvidence,
      finalMaster: {
        sha256: certificate.finalMaster.sha256,
        durationSec: certificate.finalMaster.durationSec,
      },
      visualReview: {
        reviewFingerprint: certificate.visualReview.reviewFingerprint,
        reviewReceiptVersion: certificate.visualReview.reviewReceiptVersion,
        reviewReceiptFingerprint: certificate.visualReview.reviewReceiptFingerprint,
        releaseReceiptFingerprint: certificate.visualReview.releaseReceiptFingerprint,
        evidenceFrameArtifacts: certificate.visualReview.evidenceFrameArtifacts,
      },
      onScreenText: certificate.onScreenText,
    });
  }
  if (certificate.studioLtxAdapterBinding) {
    assertStudioLtxReleaseAdapterBinding(certificate.studioLtxAdapterBinding);
  }
  if (certificate.studioAssetReleaseUsage) {
    const usage = assertStudioAssetReleaseUsageReceipt(certificate.studioAssetReleaseUsage);
    const qualityEvidence = certificate.qualityEvidence;
    if (!qualityEvidence) {
      throw new Error("Studio asset release usage requires the matching final-master quality evidence binding");
    }
    if (
      usage.finalMaster.sha256 !== certificate.finalMaster.sha256 ||
      usage.finalMaster.durationSec !== certificate.finalMaster.durationSec ||
      usage.visualReview.reviewFingerprint !== certificate.visualReview.reviewFingerprint ||
      usage.visualReview.reviewReceiptFingerprint !== certificate.visualReview.reviewReceiptFingerprint ||
      usage.qualityEvidence.bindingFingerprint !== qualityEvidence.bindingFingerprint ||
      usage.qualityEvidence.qualityEvidenceFingerprint !== qualityEvidence.qualityEvidenceFingerprint ||
      usage.contentLane !== qualityEvidence.contentLane.key
    ) {
      throw new Error("Studio asset release usage does not match this final-master certificate evidence");
    }
  }
  if (certificate.studioPostproductionDecisions) {
    const fingerprints = new Set<string>();
    for (const decisionValue of certificate.studioPostproductionDecisions) {
      const decision = assertStudioPostproductionDecisionReceipt(decisionValue);
      if (fingerprints.has(decision.receiptFingerprint)) {
        throw new Error("final-master release certificate cannot repeat a Studio post-production decision");
      }
      fingerprints.add(decision.receiptFingerprint);
    }
  }
  if (certificate.scenarioVisualTreatment) {
    const treatment = ScenarioVisualTreatmentSchema.parse(certificate.scenarioVisualTreatment);
    const programRoute = certificate.qualityEvidence?.programRoute;
    if (programRoute) {
      if (treatment.routeFingerprint !== programRoute.routeFingerprint) {
        throw new Error("scenario visual treatment route does not match the final-QA program route binding");
      }
      if (treatment.programBriefFingerprint !== programRoute.programBriefFingerprint) {
        throw new Error("scenario visual treatment program brief does not match the final-QA program route binding");
      }
    }
  }
  if (certificate.qualityEvidence) {
    assertFinalMasterQualityEvidenceBinding({
      binding: certificate.qualityEvidence,
      finalMasterSha256: certificate.finalMaster.sha256,
      finalMasterDurationSec: certificate.finalMaster.durationSec,
      visualReviewFingerprint: certificate.visualReview.reviewFingerprint,
      visualReviewReceiptVersion: certificate.visualReview.reviewReceiptVersion,
      visualReviewReceiptFingerprint: certificate.visualReview.reviewReceiptFingerprint,
      visualReviewReleaseReceiptFingerprint: certificate.visualReview.releaseReceiptFingerprint,
    });
  }
  if (certificate.visualPacing) {
    if (!certificate.qualityEvidence) {
      throw new Error("final-master visual-pacing binding requires final-master quality evidence");
    }
    assertFinalMasterVisualPacingBinding({
      binding: certificate.visualPacing,
      finalMaster: {
        sha256: certificate.finalMaster.sha256,
        durationSec: certificate.finalMaster.durationSec,
      },
      visualReview: {
        reviewFingerprint: certificate.visualReview.reviewFingerprint,
        reviewReceiptVersion: certificate.visualReview.reviewReceiptVersion,
        reviewReceiptFingerprint: certificate.visualReview.reviewReceiptFingerprint,
        releaseReceiptFingerprint: certificate.visualReview.releaseReceiptFingerprint,
      },
      qualityEvidence: {
        bindingFingerprint: certificate.qualityEvidence.bindingFingerprint,
        qualityEvidenceFingerprint: certificate.qualityEvidence.qualityEvidenceFingerprint,
      },
    });
  }
  const selfContainedNarrationTextSha256 =
    certificate.qualityEvidence?.qualityEvidence.episode.story.plan?.narrationTextSha256;
  if (selfContainedNarrationTextSha256 !== undefined) {
    const narrationEvidence = certificate.audio?.finalMasterNarration;
    if (!narrationEvidence) {
      throw new Error(
        "self-contained narrated plan evidence requires final-master narration-semantic evidence",
      );
    }
    if (narrationEvidence.narration.expectedTextSha256 !== selfContainedNarrationTextSha256) {
      throw new Error(
        "self-contained narrated plan does not match the narration audited in the final-master certificate",
      );
    }
  }
  const storyEvidence = certificate.qualityEvidence?.qualityEvidence.episode.story;
  const requiresNarratedStoryCoverage =
    storyEvidence?.source === FINAL_MASTER_NARRATED_STORY_COVERAGE_SOURCE ||
    storyEvidence?.measurementKind === "narration_semantic";
  if (requiresNarratedStoryCoverage && !certificate.narratedStoryCoverage) {
    throw new Error(
      "final-master narration-semantic story evidence requires its durable coverage sidecar",
    );
  }
  if (certificate.narratedStoryCoverage) {
    const receipt = assertFinalMasterNarratedStoryCoverageReceipt(
      certificate.narratedStoryCoverage,
    );
    const narrationEvidence = certificate.audio?.finalMasterNarration;
    const cueTiming = certificate.audio?.cueTiming;
    if (!certificate.qualityEvidence || !narrationEvidence || !cueTiming) {
      throw new Error(
        "final-master narrated-story coverage requires quality, narration-semantic, and cue-timing evidence",
      );
    }
    if (
      receipt.finalMaster.sha256 !== certificate.finalMaster.sha256 ||
      receipt.finalMaster.durationSec !== certificate.finalMaster.durationSec
    ) {
      throw new Error(
        "final-master narrated-story coverage belongs to a different released master",
      );
    }
    const story = certificate.qualityEvidence.qualityEvidence.episode.story;
    if (
      story.source !== FINAL_MASTER_NARRATED_STORY_COVERAGE_SOURCE ||
      story.measurementScope !== "final_master" ||
      story.measurementKind !== "narration_semantic" ||
      story.finalMasterNarratedStoryReceiptFingerprint !== receipt.receiptFingerprint ||
      story.beatCount !== receipt.storySpine.beatCount ||
      story.shotCount !== receipt.storySpine.shotCount ||
      story.coverageRatio !== receipt.coverage.coverageRatio
    ) {
      throw new Error(
        "final-master narrated-story coverage does not match the sealed quality-evidence story receipt",
      );
    }
    const semantic = assertFinalMasterNarrationSemanticEvidence(narrationEvidence);
    if (receipt.narration.semanticReceiptFingerprint !== semantic.receiptFingerprint) {
      throw new Error(
        "final-master narrated-story coverage belongs to a different narration-semantic receipt",
      );
    }
  }
  if (certificate.packageToOpening && certificate.packageToOpeningOmission) {
    throw new Error(
      "final-master release certificate cannot attach package-to-opening evidence and an omission together",
    );
  }
  if (certificate.packageToOpening) {
    assertPackageToOpeningReceiptCertificateBinding({
      receipt: certificate.packageToOpening,
      finalMaster: {
        sha256: certificate.finalMaster.sha256,
        durationSec: certificate.finalMaster.durationSec,
      },
      visualReview: {
        reviewFingerprint: certificate.visualReview.reviewFingerprint,
        reviewReceiptVersion: certificate.visualReview.reviewReceiptVersion,
        reviewReceiptFingerprint: certificate.visualReview.reviewReceiptFingerprint,
        releaseReceiptFingerprint: certificate.visualReview.releaseReceiptFingerprint,
        evidenceFrameArtifacts: certificate.visualReview.evidenceFrameArtifacts,
      },
    });
  }
  if (certificate.packageToOpeningOmission) {
    assertPackageToOpeningOmission(certificate.packageToOpeningOmission);
  }
  if (certificate.referenceQualityMechanics) {
    if (!certificate.qualityEvidence?.programRoute) {
      throw new Error(
        "reference-quality mechanics ledger requires the matching final-QA program route binding",
      );
    }
    assertReferenceQualityMechanicsProgramRouteBinding({
      ledger: certificate.referenceQualityMechanics,
      programRoute: certificate.qualityEvidence.programRoute,
    });
  }
  if (
    certificate.viewerPromiseProgression &&
    certificate.viewerPromiseProgressionOmission
  ) {
    throw new Error(
      "final-master release certificate cannot attach viewer-promise progression evidence and an omission together",
    );
  }
  if (
    certificate.viewerPromiseProgressionRoute &&
    !certificate.viewerPromiseProgression &&
    !certificate.viewerPromiseProgressionOmission
  ) {
    throw new Error(
      "final-master release certificate cannot retain a viewer-promise route without viewer-promise evidence",
    );
  }
  if (certificate.viewerPromiseProgression) {
    const qualityEvidence = certificate.qualityEvidence;
    const programRoute = qualityEvidence?.programRoute;
    const evidenceFrameArtifacts = certificate.visualReview.evidenceFrameArtifacts;
    const sealedRoute = certificate.viewerPromiseProgressionRoute;
    if (!qualityEvidence || !programRoute || !evidenceFrameArtifacts || !sealedRoute) {
      throw new Error(
        "viewer-promise progression receipt requires sealed route-bound final-QA and visual-review artifact evidence",
      );
    }
    assertViewerPromiseProgressionCertificateBinding({
      receipt: certificate.viewerPromiseProgression,
      finalMaster: {
        sha256: certificate.finalMaster.sha256,
        durationSec: certificate.finalMaster.durationSec,
      },
      visualReview: {
        reviewFingerprint: certificate.visualReview.reviewFingerprint,
        reviewReceiptVersion: certificate.visualReview.reviewReceiptVersion,
        reviewReceiptFingerprint: certificate.visualReview.reviewReceiptFingerprint,
        releaseReceiptFingerprint: certificate.visualReview.releaseReceiptFingerprint,
      },
      programRoute,
      sealedRoute,
      contentLane: qualityEvidence.contentLane,
      evidenceFrameArtifacts,
      finalMasterNarration: certificate.audio?.finalMasterNarration,
      narrationCueTiming: certificate.audio?.cueTiming,
    });
  }
  if (certificate.viewerPromiseProgressionOmission) {
    const qualityEvidence = certificate.qualityEvidence;
    const programRoute = qualityEvidence?.programRoute;
    const sealedRoute = certificate.viewerPromiseProgressionRoute;
    if (!qualityEvidence || !programRoute || !sealedRoute) {
      throw new Error(
        "viewer-promise progression omission requires the matching sealed final-QA program route binding",
      );
    }
    assertViewerPromiseProgressionOmissionCertificateBinding({
      omission: certificate.viewerPromiseProgressionOmission,
      programRoute,
      sealedRoute,
      contentLane: qualityEvidence.contentLane,
    });
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
  const narratedStoryCoverageAuditArtifact =
    certificate.narratedStoryCoverage?.auditArtifact;
  if (narratedStoryCoverageAuditArtifact) {
    const expectedNarratedStoryCoverageAuditKey =
      finalMasterNarratedStoryCoverageAuditObjectKey(
        args.keyPrefix,
        args.runId,
        narratedStoryCoverageAuditArtifact.contentSha256,
      );
    if (
      narratedStoryCoverageAuditArtifact.r2Key !==
      expectedNarratedStoryCoverageAuditKey
    ) {
      throw new Error(
        "final-master narrated-story coverage audit key is not content-addressed for its run",
      );
    }
  }
  const thirdPartyStockEvidence = certificate.thirdPartyStockEvidence;
  if (thirdPartyStockEvidence) {
    const expectedStockEvidenceKey = thirdPartyStockEvidenceManifestKey(
      args.keyPrefix,
      args.runId,
      thirdPartyStockEvidence.manifestSha256,
    );
    if (thirdPartyStockEvidence.manifestKey !== expectedStockEvidenceKey) {
      throw new Error("final-master third-party stock evidence key is not content-addressed for its run");
    }
  }
  const keys = [
    certificate.finalMaster.r2Key,
    certificate.visualReview.evidenceManifestKey,
    certificate.visualReview.receiptKey,
    ...certificate.visualReview.evidenceFrameKeys,
    ...(narrationAuditArtifact ? [narrationAuditArtifact.r2Key] : []),
    ...(narratedStoryCoverageAuditArtifact
      ? [narratedStoryCoverageAuditArtifact.r2Key]
      : []),
    ...(certificate.packageToOpening ? [certificate.packageToOpening.thumbnail.r2Key] : []),
    ...(thirdPartyStockEvidence ? [thirdPartyStockEvidence.manifestKey] : []),
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
  requireFinalMasterByteReceipt(certificate.finalMaster, "new final-master release certificate reference");
  // Reuse the stricter cleanup boundary: it validates the content-addressed
  // certificate and receipt keys and rejects cross-run R2 references.
  retainedFinalMasterReleaseObjectKeys({
    keyPrefix: args.keyPrefix,
    runId: args.runId,
    certificateKey: args.certificateKey,
    certificate,
  });
  const evidenceFrameArtifacts = requireEvidenceFrameArtifacts({
    frameKeys: certificate.visualReview.evidenceFrameKeys,
    frameArtifacts: certificate.visualReview.evidenceFrameArtifacts,
    subject: "final-master release certificate reference",
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
      evidenceFrameArtifactsFingerprint: finalMasterReleaseEvidenceFrameArtifactsFingerprint(
        evidenceFrameArtifacts,
      ),
      receiptKey: certificate.visualReview.receiptKey,
      reviewFingerprint: certificate.visualReview.reviewFingerprint,
      reviewReceiptVersion: certificate.visualReview.reviewReceiptVersion,
      reviewReceiptFingerprint: certificate.visualReview.reviewReceiptFingerprint,
      releaseReceiptFingerprint: certificate.visualReview.releaseReceiptFingerprint,
    },
    ...(certificate.qualityEvidence
      ? {
          qualityEvidence: {
            bindingFingerprint: certificate.qualityEvidence.bindingFingerprint,
            qualityEvidenceFingerprint: certificate.qualityEvidence.qualityEvidenceFingerprint,
            evidenceCoverage: certificate.qualityEvidence.evidenceCoverage as FinalMasterQualityEvidenceCoverage,
            ...(certificate.qualityEvidence.storyMeasurementCoverage === undefined
              ? {}
              : {
                  storyMeasurementCoverage:
                    certificate.qualityEvidence.storyMeasurementCoverage as FinalMasterStoryMeasurementCoverage,
                }),
          },
        }
      : {}),
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
  const certificateFrameArtifacts = requireEvidenceFrameArtifacts({
    frameKeys: certificate.visualReview.evidenceFrameKeys,
    frameArtifacts: certificate.visualReview.evidenceFrameArtifacts,
    subject: "final-master release certificate",
  });
  const receiptFrameArtifacts = requireEvidenceFrameArtifacts({
    frameKeys: receipt.evidence.frameKeys,
    frameArtifacts: receipt.evidence.frameArtifacts,
    subject: "visual-review release receipt",
  });
  if (
    receipt.reviewFingerprint !== certificate.visualReview.reviewFingerprint ||
    receipt.reviewReceiptVersion !== certificate.visualReview.reviewReceiptVersion ||
    receipt.reviewReceiptFingerprint !== certificate.visualReview.reviewReceiptFingerprint ||
    receipt.releaseReceiptFingerprint !== certificate.visualReview.releaseReceiptFingerprint ||
    receipt.evidence.manifestKey !== certificate.visualReview.evidenceManifestKey ||
    receipt.evidence.source.sha256 !== certificate.finalMaster.sha256 ||
    canonicalJson(receipt.evidence.frameKeys) !== canonicalJson(certificate.visualReview.evidenceFrameKeys) ||
    canonicalJson(receiptFrameArtifacts) !== canonicalJson(certificateFrameArtifacts)
  ) {
    throw new Error("final-master release certificate does not match its visual-review receipt");
  }
  const manifest = z.object({
    source: z.object({ sha256 }).passthrough(),
    manifestKey: objectKey,
    frames: z.array(z.object({
      id: z.string().trim().min(1).max(240).optional(),
      tSec: finite.nonnegative().optional(),
      r2Key: objectKey.optional(),
      contentSha256: sha256.optional(),
      byteLength: z.number().int().positive().optional(),
    }).passthrough()),
  }).passthrough().safeParse(args.evidenceManifest);
  if (!manifest.success) {
    throw new Error("final-master release certificate references an invalid visual-review evidence manifest");
  }
  const manifestFrameArtifacts = manifest.data.frames.map((frame) => {
    if (!frame.r2Key || !frame.contentSha256 || frame.byteLength === undefined) {
      throw new Error("final-master release certificate visual-review evidence manifest lacks byte-bound frame evidence");
    }
    const needsDurableReviewWitness = Boolean(certificate.viewerPromiseProgression);
    if (needsDurableReviewWitness && (frame.id === undefined || frame.tSec === undefined)) {
      throw new Error("viewer-promise progression certificate requires full visual-review frame witnesses in its evidence manifest");
    }
    return {
      ...(frame.id === undefined ? {} : { id: frame.id }),
      ...(frame.tSec === undefined ? {} : { tSec: frame.tSec }),
      r2Key: frame.r2Key,
      contentSha256: frame.contentSha256,
      byteLength: frame.byteLength,
    } satisfies FinalMasterReleaseEvidenceFrame;
  });
  const normalizedManifestFrameArtifacts = normalizeEvidenceFrameArtifacts(manifestFrameArtifacts);
  const manifestFrameKeys = normalizedManifestFrameArtifacts.map((frame) => frame.r2Key);
  if (
    manifest.data.source.sha256 !== certificate.finalMaster.sha256 ||
    manifest.data.manifestKey !== certificate.visualReview.evidenceManifestKey ||
    canonicalJson(manifestFrameKeys) !== canonicalJson(certificate.visualReview.evidenceFrameKeys) ||
    canonicalJson(normalizedManifestFrameArtifacts) !== canonicalJson(certificateFrameArtifacts)
  ) {
    throw new Error("final-master release certificate does not match its visual-review evidence manifest");
  }
  // The certificate alone only carries the receipt fingerprint. When durable
  // evidence is reloaded, bind V2 to the exact receipt projection as well,
  // including the reviewed master's duration. A replaced/mismatched receipt
  // must throw, never cause this release to fall back to V1 interpretation.
  if (certificate.referenceQuality?.version === REFERENCE_QUALITY_EVIDENCE_BRIDGE_V2_VERSION) {
    assertReferenceQualityFinalMasterBinding({
      binding: certificate.referenceQuality,
      finalMasterSha256: certificate.finalMaster.sha256,
      finalMasterDurationSec: certificate.finalMaster.durationSec,
      visualReviewFingerprint: certificate.visualReview.reviewFingerprint,
      visualReviewReceiptVersion: certificate.visualReview.reviewReceiptVersion,
      visualReviewReceiptFingerprint: certificate.visualReview.reviewReceiptFingerprint,
      visualReviewReleaseReceiptFingerprint: certificate.visualReview.releaseReceiptFingerprint,
      finalMasterNarration: certificate.audio?.finalMasterNarration,
      audioAxis: certificate.audio?.qualityAxis,
      visualRelease: {
        reviewFingerprint: receipt.reviewFingerprint,
        reviewReceiptVersion: receipt.reviewReceiptVersion,
        reviewReceiptFingerprint: receipt.reviewReceiptFingerprint,
        releaseReceiptFingerprint: receipt.releaseReceiptFingerprint,
        verdict: receipt.verdict,
        source: receipt.evidence.source,
      },
    });
  }
  if (certificate.referenceQualityMechanics) {
    assertReferenceQualityMechanicsVisualReceiptBinding({
      ledger: certificate.referenceQualityMechanics,
      visualRelease: receipt,
    });
  }
}

export type FinalMasterReleaseEvidenceObjectReader = (key: string) => Promise<Uint8Array>;
/** Streaming storage reader for a release master; never buffers a full video. */
export type FinalMasterReleaseEvidenceObjectIntegrityReader = (key: string) => Promise<{
  sha256: string;
  byteLength: number;
}>;
/** Cheap availability/size fence for the local upload verifier; never hashes remote bytes. */
export type FinalMasterReleaseEvidenceObjectHeadReader = (key: string) => Promise<{
  contentLength?: number;
} | null>;

type FinalMasterObjectIntegrity = Awaited<ReturnType<FinalMasterReleaseEvidenceObjectIntegrityReader>>;

function assertFinalMasterIntegrityMatchesReceipt(args: {
  actual: FinalMasterObjectIntegrity;
  expected: ReturnType<typeof requireFinalMasterByteReceipt>;
  subject: string;
}): void {
  if (
    !Number.isSafeInteger(args.actual.byteLength) ||
    args.actual.byteLength < 1 ||
    !sha256.safeParse(args.actual.sha256).success
  ) {
    throw new Error(`${args.subject} returned invalid byte integrity`);
  }
  if (
    args.actual.byteLength !== args.expected.byteLength ||
    args.actual.sha256.toLowerCase() !== args.expected.sha256.toLowerCase()
  ) {
    throw new Error(`${args.subject} bytes do not match receipt (${args.expected.r2Key})`);
  }
}

/**
 * Hash the exact local file that will immediately be supplied to an external
 * upload connector. This intentionally accepts a pathname rather than a
 * caller-supplied digest: a release verifier must not expose a generic
 * arbitrary-integrity bypass for durable R2 evidence.
 */
async function localUploadMasterIntegrity(filePath: string): Promise<FinalMasterObjectIntegrity> {
  const hash = createHash("sha256");
  let byteLength = 0;
  try {
    for await (const chunk of createReadStream(filePath)) {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      hash.update(bytes);
      byteLength += bytes.byteLength;
    }
  } catch (error) {
    throw new Error(
      `local final-master upload source is unavailable (${filePath}): ` +
        `${error instanceof Error ? error.message : error}`,
    );
  }
  if (!Number.isSafeInteger(byteLength) || byteLength < 1) {
    throw new Error(`local final-master upload source has an invalid byte length (${filePath})`);
  }
  return { sha256: hash.digest("hex"), byteLength };
}

async function verifyFinalMasterReleaseEvidenceWithIntegrity(args: {
  certificate: FinalMasterReleaseCertificate;
  getObjectBytes: FinalMasterReleaseEvidenceObjectReader;
  getFinalMasterIntegrity: (
    finalMaster: ReturnType<typeof requireFinalMasterByteReceipt>,
  ) => Promise<FinalMasterObjectIntegrity>;
  finalMasterSubject: string;
}): Promise<void> {
  const certificate = assertFinalMasterReleaseCertificate(args.certificate);
  const finalMaster = requireFinalMasterByteReceipt(
    certificate.finalMaster,
    "final-master release certificate",
  );
  const [actualMaster, receiptBytes, evidenceManifestBytes] = await Promise.all([
    args.getFinalMasterIntegrity(finalMaster),
    args.getObjectBytes(certificate.visualReview.receiptKey),
    args.getObjectBytes(certificate.visualReview.evidenceManifestKey),
  ]);
  assertFinalMasterIntegrityMatchesReceipt({
    actual: actualMaster,
    expected: finalMaster,
    subject: args.finalMasterSubject,
  });
  let evidenceManifest: unknown;
  try {
    evidenceManifest = JSON.parse(Buffer.from(evidenceManifestBytes).toString("utf8"));
  } catch {
    throw new Error("final-master release certificate visual-review evidence manifest is not valid JSON");
  }
  assertReleaseCertificateVisualReviewBindings({
    certificate,
    receipt: parseVisualReviewReleaseReceiptBytes(receiptBytes),
    evidenceManifest,
  });
  if (certificate.narratedStoryCoverage) {
    const narrationEvidence = certificate.audio?.finalMasterNarration;
    const cueTiming = certificate.audio?.cueTiming;
    if (!narrationEvidence || !cueTiming) {
      throw new Error(
        "final-master narrated-story coverage lacks narration-semantic or cue-timing evidence",
      );
    }
    let narrationAuditBytes: Uint8Array;
    let coverageAuditBytes: Uint8Array;
    try {
      [narrationAuditBytes, coverageAuditBytes] = await Promise.all([
        args.getObjectBytes(narrationEvidence.auditArtifact.r2Key),
        args.getObjectBytes(certificate.narratedStoryCoverage.auditArtifact.r2Key),
      ]);
    } catch (error) {
      throw new Error(
        "final-master narrated-story coverage audit is unavailable: " +
          `${error instanceof Error ? error.message : error}`,
      );
    }
    assertFinalMasterNarratedStoryCoverageReceiptBinding({
      receipt: certificate.narratedStoryCoverage,
      finalMasterNarration: narrationEvidence,
      narrationAudit: parseFinalMasterNarrationTranscriptAuditBytes(narrationAuditBytes),
      narrationCueTiming: cueTiming,
      coverageAudit: parseFinalMasterNarratedStoryCoverageAuditBytes(coverageAuditBytes),
    });
  }
  if (certificate.packageToOpening) {
    let thumbnailBytes: Uint8Array;
    try {
      thumbnailBytes = await args.getObjectBytes(certificate.packageToOpening.thumbnail.r2Key);
    } catch (error) {
      throw new Error(
        `package-to-opening thumbnail is unavailable (${certificate.packageToOpening.thumbnail.r2Key}): ` +
          `${error instanceof Error ? error.message : error}`,
      );
    }
    const actualThumbnailSha256 = createHash("sha256").update(thumbnailBytes).digest("hex");
    if (
      thumbnailBytes.byteLength !== certificate.packageToOpening.thumbnail.byteLength ||
      actualThumbnailSha256 !== certificate.packageToOpening.thumbnail.sha256
    ) {
      throw new Error("package-to-opening thumbnail bytes do not match the sealed receipt");
    }
  }
  if (certificate.referenceQuality?.version === REFERENCE_QUALITY_EVIDENCE_BRIDGE_V2_VERSION) {
    const narrationEvidence = certificate.audio?.finalMasterNarration;
    if (!narrationEvidence) {
      throw new Error("reference-quality evidence bridge v2 lacks its final-master narration semantic receipt");
    }
    let narrationAuditBytes: Uint8Array;
    try {
      narrationAuditBytes = await args.getObjectBytes(narrationEvidence.auditArtifact.r2Key);
    } catch (error) {
      throw new Error(
        `reference-quality evidence bridge v2 narration audit is unavailable: ${error instanceof Error ? error.message : error}`,
      );
    }
    assertFinalMasterNarrationTranscriptAuditBinding({
      evidence: narrationEvidence,
      audit: parseFinalMasterNarrationTranscriptAuditBytes(narrationAuditBytes),
    });
  }
  if (certificate.thirdPartyStockEvidence) {
    let stockEvidenceBytes: Uint8Array;
    try {
      stockEvidenceBytes = await args.getObjectBytes(certificate.thirdPartyStockEvidence.manifestKey);
    } catch (error) {
      throw new Error(
        `third-party stock release evidence is unavailable (${certificate.thirdPartyStockEvidence.manifestKey}): ` +
          `${error instanceof Error ? error.message : error}`,
      );
    }
    assertThirdPartyStockEvidenceReferenceBinding({
      reference: certificate.thirdPartyStockEvidence,
      manifest: parseThirdPartyStockEvidenceManifestBytes(stockEvidenceBytes),
    });
  }
  const frameArtifacts = requireEvidenceFrameArtifacts({
    frameKeys: certificate.visualReview.evidenceFrameKeys,
    frameArtifacts: certificate.visualReview.evidenceFrameArtifacts,
    subject: "final-master release certificate",
  });
  // Bound concurrent R2 reads even for an adversarially dense review receipt.
  const concurrency = 8;
  for (let offset = 0; offset < frameArtifacts.length; offset += concurrency) {
    await Promise.all(frameArtifacts.slice(offset, offset + concurrency).map(async (frame) => {
      let bytes: Uint8Array;
      try {
        bytes = await args.getObjectBytes(frame.r2Key);
      } catch (error) {
        throw new Error(
          `final-master release evidence frame is unavailable (${frame.r2Key}): ` +
          `${error instanceof Error ? error.message : error}`,
        );
      }
      const actualSha256 = createHash("sha256").update(bytes).digest("hex");
      if (bytes.byteLength !== frame.byteLength || actualSha256 !== frame.contentSha256) {
        throw new Error(`final-master release evidence frame bytes do not match receipt (${frame.r2Key})`);
      }
    }));
  }
}

/**
 * Re-read immutable review artifacts before an external release or destructive
 * cleanup. The certificate/receipt bind every object address; frame receipts
 * additionally bind exact image bytes, so missing or overwritten evidence
 * cannot masquerade as what the reviewer actually saw.
 */
export async function verifyFinalMasterReleaseEvidenceObjects(args: {
  certificate: FinalMasterReleaseCertificate;
  getObjectBytes: FinalMasterReleaseEvidenceObjectReader;
  getObjectIntegrity: FinalMasterReleaseEvidenceObjectIntegrityReader;
}): Promise<void> {
  await verifyFinalMasterReleaseEvidenceWithIntegrity({
    certificate: args.certificate,
    getObjectBytes: args.getObjectBytes,
    getFinalMasterIntegrity: async (finalMaster) => {
      try {
        return await args.getObjectIntegrity(finalMaster.r2Key);
      } catch (error) {
        throw new Error(
          `final-master release object is unavailable (${finalMaster.r2Key}): ` +
            `${error instanceof Error ? error.message : error}`,
        );
      }
    },
    finalMasterSubject: "final-master release object",
  });
}

/**
 * Upload-only release verification. The caller supplies the actual local file
 * that will immediately be sent to the connector; this verifier streams and
 * hashes that file itself, checks the durable R2 object's existence and byte
 * length without downloading it, then still re-reads every durable receipt and
 * review-evidence frame. QA, cleanup, and all other callers must use the
 * remote-object verifier above.
 */
export async function verifyFinalMasterReleaseEvidenceForLocalUpload(args: {
  certificate: FinalMasterReleaseCertificate;
  filePath: string;
  getObjectBytes: FinalMasterReleaseEvidenceObjectReader;
  headObjectMetadata: FinalMasterReleaseEvidenceObjectHeadReader;
}): Promise<void> {
  await verifyFinalMasterReleaseEvidenceWithIntegrity({
    certificate: args.certificate,
    getObjectBytes: args.getObjectBytes,
    getFinalMasterIntegrity: async (finalMaster) => {
      const [localIntegrity, durableMaster] = await Promise.all([
        localUploadMasterIntegrity(args.filePath),
        args.headObjectMetadata(finalMaster.r2Key),
      ]);
      if (!durableMaster) {
        throw new Error(`final-master release object is unavailable (${finalMaster.r2Key})`);
      }
      if (durableMaster.contentLength !== finalMaster.byteLength) {
        throw new Error(`final-master release object byte length does not match receipt (${finalMaster.r2Key})`);
      }
      return localIntegrity;
    },
    finalMasterSubject: "local final-master upload source",
  });
}
