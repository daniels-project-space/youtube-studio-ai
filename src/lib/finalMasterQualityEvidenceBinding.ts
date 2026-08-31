/**
 * Immutable lineage between the shared final-QA receipt and the exact master
 * it evaluated.  This is an evidence-coverage record, never a quality grade,
 * a reference-comparison result, or an authorization to publish.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import {
  QualityEvidenceSchema,
  type QualityEvidence,
} from "@/engine/qualityEvidence";
import { canonicalJson } from "@/lib/canonicalJson";

export const FINAL_MASTER_QUALITY_EVIDENCE_BINDING_VERSION =
  "final-master-quality-evidence-binding/v1" as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, "expected SHA-256");
const identifier = z.string().trim().min(1).max(160);
const finite = z.number().finite();

const finalMasterSchema = z.object({
  sha256,
  durationSec: finite.positive(),
}).strict();

const visualReviewSchema = z.object({
  reviewFingerprint: z.string().trim().min(1).max(256),
  reviewReceiptVersion: z.string().trim().min(1).max(128),
  reviewReceiptFingerprint: sha256,
  releaseReceiptFingerprint: sha256,
}).strict();

const contentLaneSchema = z.object({
  key: identifier,
  renderer: identifier,
}).strict();

/** Optional because route-less historical invocations remain readable. */
const programRouteSchema = z.object({
  routeFingerprint: sha256,
  family: identifier,
  contentLaneKey: identifier,
  /** Optional solely for historical route-bound bindings minted before this field existed. */
  programBriefFingerprint: sha256.optional(),
  /** Complete frozen seed identity, including directives/profile; optional for historical bindings. */
  routeSeedFingerprint: sha256.optional(),
}).strict();

/**
 * This represents completeness of the recorded QA evidence only. It does not
 * say that the video is objectively good, nor that it will perform well.
 */
export const FinalMasterQualityEvidenceCoverageSchema = z.enum([
  "complete",
  "partial",
  "unmeasured",
]);

/**
 * Scope of the story measurement retained in the sealed quality receipt.
 * This is deliberately separate from `evidenceCoverage`: complete QA-axis
 * coverage does not turn a pre-render story plan into final-master coverage.
 */
/**
 * Measurement scope, not a statement that every story element is covered.
 * `final_master` requires source-backed ratio evidence in the shared receipt;
 * that ratio can be below one and remains in the full receipt.
 */
export const FinalMasterStoryMeasurementCoverageSchema = z.enum([
  "unmeasured",
  "plan_only",
  "final_master",
  "scope_undeclared",
]);

export const FinalMasterQualityEvidenceBindingSchema = z.object({
  version: z.literal(FINAL_MASTER_QUALITY_EVIDENCE_BINDING_VERSION),
  finalMaster: finalMasterSchema,
  visualReview: visualReviewSchema,
  contentLane: contentLaneSchema,
  programRoute: programRouteSchema.optional(),
  /** The original shared receipt, retaining every pass/fail/advisory/not_measured axis. */
  qualityEvidence: QualityEvidenceSchema,
  qualityEvidenceFingerprint: sha256,
  /** Derived from the receipt; callers cannot upgrade this independently. */
  evidenceCoverage: FinalMasterQualityEvidenceCoverageSchema,
  /** Optional only so historical v1 bindings remain readable. New bindings always declare it. */
  storyMeasurementCoverage: FinalMasterStoryMeasurementCoverageSchema.optional(),
  bindingFingerprint: sha256,
}).strict();

export type FinalMasterQualityEvidenceBinding = z.infer<
  typeof FinalMasterQualityEvidenceBindingSchema
>;
export type FinalMasterQualityEvidenceCoverage = z.infer<
  typeof FinalMasterQualityEvidenceCoverageSchema
>;
export type FinalMasterStoryMeasurementCoverage = z.infer<
  typeof FinalMasterStoryMeasurementCoverageSchema
>;

export interface FinalMasterQualityEvidenceBindingInput {
  finalMaster: { sha256: string; durationSec: number };
  visualReview: {
    reviewFingerprint: string;
    reviewReceiptVersion: string;
    reviewReceiptFingerprint: string;
    releaseReceiptFingerprint: string;
  };
  contentLane: { key: string; renderer: string };
  programRoute?: {
    routeFingerprint: string;
    family: string;
    contentLaneKey: string;
    programBriefFingerprint?: string;
    routeSeedFingerprint?: string;
  };
  qualityEvidence: QualityEvidence;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function finalMasterQualityEvidenceFingerprint(value: QualityEvidence): string {
  return sha256Hex(canonicalJson(QualityEvidenceSchema.parse(value)));
}

export function deriveFinalMasterQualityEvidenceCoverage(
  value: QualityEvidence,
): FinalMasterQualityEvidenceCoverage {
  const qualityEvidence = QualityEvidenceSchema.parse(value);
  const axes = Object.values(qualityEvidence.axes);
  if (axes.every((axis) => axis.status === "not_measured")) {
    return "unmeasured";
  }
  if (
    qualityEvidence.release.calibrationComplete &&
    axes.every((axis) => axis.status !== "not_measured")
  ) {
    return "complete";
  }
  return "partial";
}

/**
 * Reports what the quality receipt's story data measured. `plan_only` is
 * intentionally not a verdict about the rendered master; final video coverage
 * must be supported by a separately declared final-master measurement.
 */
export function deriveFinalMasterStoryMeasurementCoverage(
  value: QualityEvidence,
): FinalMasterStoryMeasurementCoverage {
  const story = QualityEvidenceSchema.parse(value).episode.story;
  if (story.status === "not_measured") return "unmeasured";
  if (story.measurementScope === "plan" || story.plan !== undefined) return "plan_only";
  if (story.measurementScope === "final_master") return "final_master";
  return "scope_undeclared";
}

function bindingPayload(value: Omit<FinalMasterQualityEvidenceBinding, "bindingFingerprint">): string {
  return canonicalJson(value);
}

export function finalMasterQualityEvidenceBindingFingerprint(
  value: Omit<FinalMasterQualityEvidenceBinding, "bindingFingerprint">,
): string {
  return sha256Hex(bindingPayload(value));
}

function assertIntrinsicBinding(
  value: FinalMasterQualityEvidenceBinding,
): FinalMasterQualityEvidenceBinding {
  const { bindingFingerprint, ...unsigned } = value;
  if (bindingFingerprint !== finalMasterQualityEvidenceBindingFingerprint(unsigned)) {
    throw new Error("final-master quality-evidence binding fingerprint does not match its payload");
  }
  if (
    value.qualityEvidenceFingerprint !== finalMasterQualityEvidenceFingerprint(value.qualityEvidence)
  ) {
    throw new Error("final-master quality-evidence binding fingerprint does not match its quality receipt");
  }
  if (
    value.qualityEvidence.episode.lane.key !== value.contentLane.key ||
    value.qualityEvidence.episode.lane.renderer !== value.contentLane.renderer
  ) {
    throw new Error("final-master quality-evidence binding content lane does not match its quality receipt");
  }
  if (
    value.programRoute &&
    value.programRoute.contentLaneKey !== value.contentLane.key
  ) {
    throw new Error("final-master quality-evidence binding route does not match its content lane");
  }
  const sealedPlan = value.qualityEvidence.episode.story.plan;
  if (sealedPlan) {
    if (!value.programRoute) {
      throw new Error("final-master quality-evidence binding requires the frozen route for sealed plan evidence");
    }
    if (
      value.programRoute.routeFingerprint !== sealedPlan.routeFingerprint ||
      value.programRoute.family !== sealedPlan.family ||
      value.programRoute.contentLaneKey !== sealedPlan.contentLaneKey ||
      value.programRoute.programBriefFingerprint !== sealedPlan.programBriefFingerprint
    ) {
      throw new Error("final-master quality-evidence binding route does not match its sealed plan evidence");
    }
  }
  if (
    value.evidenceCoverage !== deriveFinalMasterQualityEvidenceCoverage(value.qualityEvidence)
  ) {
    throw new Error("final-master quality-evidence binding coverage does not match its quality receipt");
  }
  const expectedStoryMeasurementCoverage = deriveFinalMasterStoryMeasurementCoverage(value.qualityEvidence);
  if (
    value.storyMeasurementCoverage !== undefined &&
    value.storyMeasurementCoverage !== expectedStoryMeasurementCoverage
  ) {
    throw new Error("final-master quality-evidence binding story measurement scope does not match its quality receipt");
  }
  if (
    value.qualityEvidence.episode.story.plan !== undefined &&
    value.storyMeasurementCoverage === undefined
  ) {
    throw new Error("final-master quality-evidence binding cannot omit sealed plan measurement scope");
  }
  return value;
}

export function createFinalMasterQualityEvidenceBinding(
  input: FinalMasterQualityEvidenceBindingInput,
): FinalMasterQualityEvidenceBinding {
  const qualityEvidence = QualityEvidenceSchema.parse(input.qualityEvidence);
  const unsigned = {
    version: FINAL_MASTER_QUALITY_EVIDENCE_BINDING_VERSION,
    finalMaster: finalMasterSchema.parse(input.finalMaster),
    visualReview: visualReviewSchema.parse(input.visualReview),
    contentLane: contentLaneSchema.parse(input.contentLane),
    ...(input.programRoute === undefined
      ? {}
      : { programRoute: programRouteSchema.parse(input.programRoute) }),
    qualityEvidence,
    qualityEvidenceFingerprint: finalMasterQualityEvidenceFingerprint(qualityEvidence),
    evidenceCoverage: deriveFinalMasterQualityEvidenceCoverage(qualityEvidence),
    storyMeasurementCoverage: deriveFinalMasterStoryMeasurementCoverage(qualityEvidence),
  } satisfies Omit<FinalMasterQualityEvidenceBinding, "bindingFingerprint">;
  return assertIntrinsicBinding(FinalMasterQualityEvidenceBindingSchema.parse({
    ...unsigned,
    bindingFingerprint: finalMasterQualityEvidenceBindingFingerprint(unsigned),
  }));
}

export function assertFinalMasterQualityEvidenceBinding(args: {
  binding: unknown;
  finalMasterSha256: string;
  finalMasterDurationSec: number;
  visualReviewFingerprint: string;
  visualReviewReceiptVersion: string;
  visualReviewReceiptFingerprint: string;
  visualReviewReleaseReceiptFingerprint: string;
}): FinalMasterQualityEvidenceBinding {
  const binding = assertIntrinsicBinding(FinalMasterQualityEvidenceBindingSchema.parse(args.binding));
  const expectedMaster = finalMasterSchema.parse({
    sha256: args.finalMasterSha256,
    durationSec: args.finalMasterDurationSec,
  });
  if (
    binding.finalMaster.sha256 !== expectedMaster.sha256 ||
    binding.finalMaster.durationSec !== expectedMaster.durationSec
  ) {
    throw new Error("final-master quality-evidence binding belongs to a different final master");
  }
  if (
    binding.visualReview.reviewFingerprint !== args.visualReviewFingerprint ||
    binding.visualReview.reviewReceiptVersion !== args.visualReviewReceiptVersion ||
    binding.visualReview.reviewReceiptFingerprint !== args.visualReviewReceiptFingerprint ||
    binding.visualReview.releaseReceiptFingerprint !== args.visualReviewReleaseReceiptFingerprint
  ) {
    throw new Error("final-master quality-evidence binding belongs to a different visual-review receipt");
  }
  return binding;
}
