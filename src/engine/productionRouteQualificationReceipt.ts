import { z } from "zod";

import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

import {
  assessProductionRouteQualification,
  assertProductionRouteInceptionEvidence,
  assertProductionRoutePlannerEvidence,
  assertProductionRouteQualificationBinding,
  assertProductionRouteRuntimeEvidence,
  assertProductionRouteVisualMatterEvidence,
  parseProductionRouteQualification,
  ProductionRouteInceptionEvidenceSchema,
  ProductionRoutePlannerEvidenceSchema,
  ProductionRouteRuntimeEvidenceSchema,
  ProductionRouteVisualMatterEvidenceSchema,
  type ProductionRouteInceptionEvidence,
  type ProductionRoutePlannerEvidence,
  type ProductionRouteQualification,
  type ProductionRouteQualificationBinding,
  type ProductionRouteRuntimeEvidence,
  type ProductionRouteVisualMatterEvidence,
} from "./productionRouteQualification";

/**
 * Compact durable envelopes for the staged production-route qualification
 * lifecycle. These are deliberately not execution admissions: a preflight
 * receipt can only be consumed by a future, explicit private-benchmark gate,
 * while a release-qualified receipt remains inert until a separate runtime
 * admission layer consumes it.
 */
export const PRODUCTION_ROUTE_QUALIFICATION_RECEIPT_VERSION =
  "production-route-qualification-receipt/v1" as const;

export const ROUTE_PREFLIGHT_READY = "route_preflight_ready" as const;
export const ROUTE_RELEASE_QUALIFIED = "route_release_qualified" as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const sha256 = z.string().regex(SHA256_PATTERN, "expected lowercase SHA-256 fingerprint");
const safeOwnerId = z.string().trim().min(1).max(320).refine(
  (value) => !/[\u0000-\u001f]/.test(value),
  "invalid owner identity",
);
const safeChannelId = z.string().trim().min(1).max(512).refine(
  (value) => !/[\u0000-\u001f]/.test(value),
  "invalid channel identity",
);
const shortIdentifier = z.string().trim().min(1).max(160);

function fingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function fingerprintWithout(value: object, field: string): string {
  const body = { ...(value as Record<string, unknown>) };
  delete body[field];
  return fingerprint(body);
}

function sameFrozenContract(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/** The exact route/profile/pipeline identity later runtime admission must match. */
export const ProductionRouteQualificationReceiptBindingSchema = z.object({
  bindingFingerprint: sha256,
  family: shortIdentifier,
  contentLaneKey: shortIdentifier,
  programBriefFingerprint: sha256,
  showProfileFingerprint: sha256,
  routeKey: shortIdentifier,
  routeAdmission: z.enum(["automatic", "supervised_private"]),
  routeFingerprint: sha256,
  compositionFingerprint: sha256,
  pipelineFingerprint: sha256,
}).strict();

export type ProductionRouteQualificationReceiptBinding = z.infer<
  typeof ProductionRouteQualificationReceiptBindingSchema
>;

const PreflightEvidenceSchema = z.object({
  plannerEvidenceFingerprint: sha256,
  plannerPlanFingerprint: sha256,
  inceptionEvidenceFingerprint: sha256,
  inceptionPlanFingerprint: sha256,
  runtimeEvidenceFingerprint: sha256,
  runtimeTargetFingerprint: sha256,
  videoReadinessFingerprint: sha256,
  visualMatterEvidenceFingerprint: sha256,
  visualMatterStatus: z.enum(["not_required", "planned_controls", "anchored_controls"]),
}).strict();

/**
 * The compact projection above is the durable admission index.  Fresh v1
 * preflights additionally retain the already-validated evidence objects so a
 * later private full-master benchmark can re-derive release qualification
 * without re-reading mutable creator inputs.  These are fingerprints and
 * bounded metadata only: never media bytes, provider payloads, or credentials.
 *
 * The field is optional only to keep historical preflight receipts readable;
 * a new benchmark explicitly requires it and therefore cannot promote an old
 * receipt whose original evidence is no longer reconstructable.
 */
const PreflightQualificationEvidenceSchema = z.object({
  planner: ProductionRoutePlannerEvidenceSchema,
  inception: ProductionRouteInceptionEvidenceSchema,
  runtime: ProductionRouteRuntimeEvidenceSchema,
  visualMatter: ProductionRouteVisualMatterEvidenceSchema,
}).strict();

export type PreflightQualificationEvidence = z.infer<
  typeof PreflightQualificationEvidenceSchema
>;

const ReleaseQualityProjectionSchema = z.object({
  qualityEvidenceFingerprint: sha256,
  editorialAcceptanceFingerprint: sha256,
  hardGateReady: z.literal(true),
  calibrationComplete: z.literal(true),
}).strict();

const ReleaseProvenanceProjectionSchema = z.object({
  provenanceEvidenceFingerprint: sha256,
  releaseCertificateFingerprint: sha256,
  finalMasterSha256: sha256,
  qualityEvidenceFingerprint: sha256,
  contentLaneKey: shortIdentifier,
  renderer: shortIdentifier,
  evidenceStatus: z.literal("complete"),
  routeBound: z.literal(true),
}).strict();

const PreflightReceiptBodySchema = z.object({
  version: z.literal(PRODUCTION_ROUTE_QUALIFICATION_RECEIPT_VERSION),
  level: z.literal(ROUTE_PREFLIGHT_READY),
  ownerId: safeOwnerId,
  channelId: safeChannelId,
  binding: ProductionRouteQualificationReceiptBindingSchema,
  /** This is intentionally the only capability carried by a preflight. */
  benchmarkPermission: z.literal("private_benchmark_only"),
  preflight: PreflightEvidenceSchema,
  qualificationEvidence: PreflightQualificationEvidenceSchema.optional(),
  supersedesReceiptFingerprint: sha256.optional(),
}).strict();

const ReleaseReceiptBodySchema = z.object({
  version: z.literal(PRODUCTION_ROUTE_QUALIFICATION_RECEIPT_VERSION),
  level: z.literal(ROUTE_RELEASE_QUALIFIED),
  ownerId: safeOwnerId,
  channelId: safeChannelId,
  binding: ProductionRouteQualificationReceiptBindingSchema,
  /** The exact immutable preflight that this full qualification extends. */
  preflightReceiptFingerprint: sha256,
  qualificationFingerprint: sha256,
  preflight: PreflightEvidenceSchema,
  quality: ReleaseQualityProjectionSchema,
  provenance: ReleaseProvenanceProjectionSchema,
  supersedesReceiptFingerprint: sha256.optional(),
}).strict();

export type RoutePreflightReadyReceiptBody = z.infer<typeof PreflightReceiptBodySchema>;
export type RouteReleaseQualifiedReceiptBody = z.infer<typeof ReleaseReceiptBodySchema>;

function sealReceipt<T extends Record<string, unknown>>(body: T): T & { receiptFingerprint: string } {
  return {
    ...body,
    receiptFingerprint: fingerprint(body),
  };
}

const PreflightReceiptSchema = PreflightReceiptBodySchema.extend({
  receiptFingerprint: sha256,
}).strict().superRefine((value, context) => {
  if (value.receiptFingerprint !== fingerprintWithout(value, "receiptFingerprint")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["receiptFingerprint"],
      message: "route preflight receipt fingerprint does not match its payload",
    });
  }
});

const ReleaseReceiptSchema = ReleaseReceiptBodySchema.extend({
  receiptFingerprint: sha256,
}).strict().superRefine((value, context) => {
  if (value.receiptFingerprint !== fingerprintWithout(value, "receiptFingerprint")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["receiptFingerprint"],
      message: "route release qualification receipt fingerprint does not match its payload",
    });
  }
});

// `superRefine` turns each branch into ZodEffects, which Zod v3 cannot place
// inside `discriminatedUnion`; the literal level fields still make this a
// closed two-branch union at the type and runtime boundary.
export const ProductionRouteQualificationReceiptSchema = z.union([
  PreflightReceiptSchema,
  ReleaseReceiptSchema,
]);

export type RoutePreflightReadyReceipt = z.infer<typeof PreflightReceiptSchema>;
export type RouteReleaseQualifiedReceipt = z.infer<typeof ReleaseReceiptSchema>;
export type ProductionRouteQualificationReceipt = z.infer<
  typeof ProductionRouteQualificationReceiptSchema
>;

export function assertProductionRouteQualificationReceipt(
  value: unknown,
): ProductionRouteQualificationReceipt {
  return ProductionRouteQualificationReceiptSchema.parse(value);
}

export function assertRoutePreflightReadyReceipt(value: unknown): RoutePreflightReadyReceipt {
  return PreflightReceiptSchema.parse(value);
}

/**
 * Returns the sealed evidence required to turn one successful private full
 * master into a release qualification. Historical compact-only preflights are
 * deliberately not eligible: reconstructing their original planner/inception
 * inputs from a mutable channel would weaken the route-binding guarantee.
 */
export function routePreflightQualificationEvidence(
  value: unknown,
): PreflightQualificationEvidence {
  const receipt = assertRoutePreflightReadyReceipt(value);
  const evidence = receipt.qualificationEvidence;
  if (!evidence) {
    throw new Error(
      "route preflight predates retained qualification evidence; issue a fresh preflight before private benchmarking",
    );
  }
  if (
    evidence.planner.bindingFingerprint !== receipt.binding.bindingFingerprint ||
    evidence.inception.bindingFingerprint !== receipt.binding.bindingFingerprint ||
    evidence.runtime.bindingFingerprint !== receipt.binding.bindingFingerprint ||
    evidence.visualMatter.bindingFingerprint !== receipt.binding.bindingFingerprint ||
    evidence.planner.pipelineFingerprint !== receipt.binding.pipelineFingerprint ||
    evidence.inception.pipelineFingerprint !== receipt.binding.pipelineFingerprint ||
    evidence.runtime.pipelineFingerprint !== receipt.binding.pipelineFingerprint ||
    evidence.planner.evidenceFingerprint !== receipt.preflight.plannerEvidenceFingerprint ||
    evidence.planner.planFingerprint !== receipt.preflight.plannerPlanFingerprint ||
    evidence.inception.evidenceFingerprint !== receipt.preflight.inceptionEvidenceFingerprint ||
    evidence.inception.planFingerprint !== receipt.preflight.inceptionPlanFingerprint ||
    evidence.runtime.evidenceFingerprint !== receipt.preflight.runtimeEvidenceFingerprint ||
    evidence.runtime.runtimeTargetFingerprint !== receipt.preflight.runtimeTargetFingerprint ||
    evidence.runtime.videoReadinessFingerprint !== receipt.preflight.videoReadinessFingerprint ||
    evidence.visualMatter.evidenceFingerprint !== receipt.preflight.visualMatterEvidenceFingerprint ||
    evidence.visualMatter.status !== receipt.preflight.visualMatterStatus
  ) {
    throw new Error("route preflight retained evidence does not match its immutable projection");
  }
  return PreflightQualificationEvidenceSchema.parse(evidence);
}

export function assertRouteReleaseQualifiedReceipt(value: unknown): RouteReleaseQualifiedReceipt {
  return ReleaseReceiptSchema.parse(value);
}

export function productionRouteQualificationReceiptBindingFor(
  binding: unknown,
): ProductionRouteQualificationReceiptBinding {
  const parsed = assertProductionRouteQualificationBinding(binding);
  return ProductionRouteQualificationReceiptBindingSchema.parse({
    bindingFingerprint: parsed.bindingFingerprint,
    family: parsed.family,
    contentLaneKey: parsed.contentLaneKey,
    programBriefFingerprint: parsed.programBrief.fingerprint,
    showProfileFingerprint: parsed.showProfile.fingerprint,
    routeKey: parsed.route.key,
    routeAdmission: parsed.route.admission,
    routeFingerprint: parsed.route.fingerprint,
    compositionFingerprint: parsed.composition.fingerprint,
    pipelineFingerprint: parsed.pipelineFingerprint,
  });
}

function assertEvidenceBinding(
  binding: ProductionRouteQualificationBinding,
  evidence: { readonly bindingFingerprint: string },
  label: string,
): void {
  if (evidence.bindingFingerprint !== binding.bindingFingerprint) {
    throw new Error(`${label} does not belong to the frozen production-route binding`);
  }
}

function assertPreflightReadiness(input: {
  readonly binding: ProductionRouteQualificationBinding;
  readonly planner: ProductionRoutePlannerEvidence;
  readonly inception: ProductionRouteInceptionEvidence;
  readonly runtime: ProductionRouteRuntimeEvidence;
  readonly visualMatter: ProductionRouteVisualMatterEvidence;
}): void {
  const { binding, planner, inception, runtime, visualMatter } = input;
  assertEvidenceBinding(binding, planner, "planner evidence");
  assertEvidenceBinding(binding, inception, "inception evidence");
  assertEvidenceBinding(binding, runtime, "runtime evidence");
  assertEvidenceBinding(binding, visualMatter, "Visual Matter evidence");
  if (
    planner.pipelineFingerprint !== binding.pipelineFingerprint
    || planner.contentLaneKey !== binding.contentLaneKey
    || !planner.available
    || !planner.productionReady
  ) {
    throw new Error("route preflight requires an available production-ready planner for the frozen pipeline");
  }
  if (inception.pipelineFingerprint !== binding.pipelineFingerprint) {
    throw new Error("route preflight inception evidence does not use the frozen pipeline");
  }
  if (
    runtime.plannerEvidenceFingerprint !== planner.evidenceFingerprint
    || runtime.pipelineFingerprint !== binding.pipelineFingerprint
    || !runtime.ready
  ) {
    throw new Error("route preflight requires ready runtime evidence tied to the exact planner output");
  }
  if (!visualMatter.controlsReady) {
    throw new Error("route preflight requires ready Visual Matter applicability controls");
  }
}

function preflightEvidenceFor(input: {
  readonly planner: ProductionRoutePlannerEvidence;
  readonly inception: ProductionRouteInceptionEvidence;
  readonly runtime: ProductionRouteRuntimeEvidence;
  readonly visualMatter: ProductionRouteVisualMatterEvidence;
}): z.infer<typeof PreflightEvidenceSchema> {
  return PreflightEvidenceSchema.parse({
    plannerEvidenceFingerprint: input.planner.evidenceFingerprint,
    plannerPlanFingerprint: input.planner.planFingerprint,
    inceptionEvidenceFingerprint: input.inception.evidenceFingerprint,
    inceptionPlanFingerprint: input.inception.planFingerprint,
    runtimeEvidenceFingerprint: input.runtime.evidenceFingerprint,
    runtimeTargetFingerprint: input.runtime.runtimeTargetFingerprint,
    videoReadinessFingerprint: input.runtime.videoReadinessFingerprint,
    visualMatterEvidenceFingerprint: input.visualMatter.evidenceFingerprint,
    visualMatterStatus: input.visualMatter.status,
  });
}

function optionalSupersession(value: unknown): { supersedesReceiptFingerprint?: string } {
  if (value === undefined) return {};
  return { supersedesReceiptFingerprint: sha256.parse(value) };
}

/**
 * Creates the first stage only. It intentionally does not accept QA,
 * provenance, final-master, or release status inputs, so this object cannot
 * be misrepresented as a release qualification.
 */
export function createRoutePreflightReadyReceipt(input: {
  readonly ownerId: string;
  readonly channelId: string;
  readonly binding: unknown;
  readonly planner: unknown;
  readonly inception: unknown;
  readonly runtime: unknown;
  readonly visualMatter: unknown;
  readonly supersedesReceiptFingerprint?: string;
}): RoutePreflightReadyReceipt {
  const binding = assertProductionRouteQualificationBinding(input.binding);
  const planner = assertProductionRoutePlannerEvidence(input.planner);
  const inception = assertProductionRouteInceptionEvidence(input.inception);
  const runtime = assertProductionRouteRuntimeEvidence(input.runtime);
  const visualMatter = assertProductionRouteVisualMatterEvidence(input.visualMatter);
  assertPreflightReadiness({ binding, planner, inception, runtime, visualMatter });
  const body: RoutePreflightReadyReceiptBody = {
    version: PRODUCTION_ROUTE_QUALIFICATION_RECEIPT_VERSION,
    level: ROUTE_PREFLIGHT_READY,
    ownerId: safeOwnerId.parse(input.ownerId),
    channelId: safeChannelId.parse(input.channelId),
    binding: productionRouteQualificationReceiptBindingFor(binding),
    benchmarkPermission: "private_benchmark_only",
    preflight: preflightEvidenceFor({ planner, inception, runtime, visualMatter }),
    qualificationEvidence: { planner, inception, runtime, visualMatter },
    ...optionalSupersession(input.supersedesReceiptFingerprint),
  };
  return assertRoutePreflightReadyReceipt(sealReceipt(body));
}

function rederiveQualifiedRelease(value: ProductionRouteQualification): ProductionRouteQualification {
  const evidence = value.evidence;
  const rederived = assessProductionRouteQualification({
    mode: value.mode,
    binding: value.binding,
    planner: evidence.planner,
    inception: evidence.inception,
    runtime: evidence.runtime,
    quality: evidence.quality,
    provenance: evidence.provenance,
    visualMatter: evidence.visualMatter,
  });
  if (
    rederived.qualificationFingerprint !== value.qualificationFingerprint
    || !sameFrozenContract(rederived, value)
  ) {
    throw new Error("release qualification is not the exact current engine-derived qualification result");
  }
  return rederived;
}

/**
 * Creates the second stage only after the engine independently re-derives a
 * full automatic qualification. The input retains only upstream compact
 * hashes; it never stores a certificate JSON, provider receipt, or media.
 */
export function createRouteReleaseQualifiedReceipt(input: {
  readonly ownerId: string;
  readonly channelId: string;
  readonly preflight: unknown;
  readonly qualification: unknown;
  readonly supersedesReceiptFingerprint?: string;
}): RouteReleaseQualifiedReceipt {
  const preflight = assertRoutePreflightReadyReceipt(input.preflight);
  const ownerId = safeOwnerId.parse(input.ownerId);
  const channelId = safeChannelId.parse(input.channelId);
  if (preflight.ownerId !== ownerId || preflight.channelId !== channelId) {
    throw new Error("route release qualification must use an owner/channel-matched preflight receipt");
  }
  const qualification = rederiveQualifiedRelease(parseProductionRouteQualification(input.qualification));
  if (
    qualification.status !== "qualified"
    || qualification.mode !== "automatic"
    || !qualification.automaticReady
    || !qualification.binding
  ) {
    throw new Error("route release qualification requires an automatically qualified route, never a review or blocked status");
  }
  const binding = qualification.binding;
  const planner = qualification.evidence.planner;
  const inception = qualification.evidence.inception;
  const runtime = qualification.evidence.runtime;
  const quality = qualification.evidence.quality;
  const provenance = qualification.evidence.provenance;
  const visualMatter = qualification.evidence.visualMatter;
  if (!planner || !inception || !runtime || !quality || !provenance || !visualMatter) {
    throw new Error("route release qualification requires every sealed planner, inception, runtime, QA, provenance, and Visual Matter evidence receipt");
  }
  assertPreflightReadiness({ binding, planner, inception, runtime, visualMatter });
  const receiptBinding = productionRouteQualificationReceiptBindingFor(binding);
  if (!sameFrozenContract(preflight.binding, receiptBinding)) {
    throw new Error("route release qualification does not match the frozen preflight route/profile/pipeline binding");
  }
  const releasePreflight = preflightEvidenceFor({ planner, inception, runtime, visualMatter });
  if (!sameFrozenContract(preflight.preflight, releasePreflight)) {
    throw new Error("route release qualification requires a preflight from the exact same readiness evidence");
  }
  if (
    binding.route.admission !== "automatic"
    || !quality.ready
    || !quality.hardGateReady
    || !quality.calibrationComplete
    || !provenance.ready
    || !provenance.routeBound
    || provenance.evidenceStatus !== "complete"
    || provenance.qualityEvidenceFingerprint !== quality.qualityEvidenceFingerprint
    || provenance.contentLaneKey !== binding.contentLaneKey
  ) {
    throw new Error("route release qualification requires real hard-gate-ready QA and complete route-bound final-master provenance");
  }
  const body: RouteReleaseQualifiedReceiptBody = {
    version: PRODUCTION_ROUTE_QUALIFICATION_RECEIPT_VERSION,
    level: ROUTE_RELEASE_QUALIFIED,
    ownerId,
    channelId,
    binding: receiptBinding,
    preflightReceiptFingerprint: preflight.receiptFingerprint,
    qualificationFingerprint: qualification.qualificationFingerprint,
    preflight: releasePreflight,
    quality: {
      qualityEvidenceFingerprint: quality.qualityEvidenceFingerprint,
      editorialAcceptanceFingerprint: quality.editorialAcceptanceFingerprint,
      hardGateReady: true,
      calibrationComplete: true,
    },
    provenance: {
      provenanceEvidenceFingerprint: provenance.evidenceFingerprint,
      releaseCertificateFingerprint: provenance.releaseCertificateFingerprint,
      finalMasterSha256: provenance.finalMasterSha256,
      qualityEvidenceFingerprint: provenance.qualityEvidenceFingerprint,
      contentLaneKey: provenance.contentLaneKey,
      renderer: provenance.renderer,
      evidenceStatus: "complete",
      routeBound: true,
    },
    ...optionalSupersession(input.supersedesReceiptFingerprint),
  };
  return assertRouteReleaseQualifiedReceipt(sealReceipt(body));
}

/** A stable grouping key for immutable supersession chains. */
export function productionRouteQualificationReceiptBindingKey(value: unknown): string {
  const receipt = assertProductionRouteQualificationReceipt(value);
  return canonicalJson({
    level: receipt.level,
    binding: receipt.binding,
  });
}
