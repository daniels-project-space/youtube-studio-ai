/**
 * V8-safe storage codec for immutable production-route qualification receipts.
 *
 * Trigger creates and fully re-derives the rich evidence before persistence.
 * Convex verifies this sealed envelope, its immutable projections, and its
 * fingerprint without importing planner, renderer, or certificate adapters.
 * Trigger re-parses the retained evidence with the rich codec before it can
 * authorize a benchmark or release decision.
 */
import { z } from "zod";

import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export const PRODUCTION_ROUTE_QUALIFICATION_RECEIPT_VERSION =
  "production-route-qualification-receipt/v1" as const;
export const ROUTE_PREFLIGHT_READY = "route_preflight_ready" as const;
export const ROUTE_RELEASE_QUALIFIED = "route_release_qualified" as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const safeOwnerId = z.string().trim().min(1).max(320).refine(
  (value) => !/[\u0000-\u001f]/.test(value),
  "invalid owner identity",
);
const safeChannelId = z.string().trim().min(1).max(512).refine(
  (value) => !/[\u0000-\u001f]/.test(value),
  "invalid channel identity",
);
const shortIdentifier = z.string().trim().min(1).max(160);

const binding = z.object({
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

const preflight = z.object({
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

const quality = z.object({
  qualityEvidenceFingerprint: sha256,
  editorialAcceptanceFingerprint: sha256,
  hardGateReady: z.literal(true),
  calibrationComplete: z.literal(true),
}).strict();

const provenance = z.object({
  provenanceEvidenceFingerprint: sha256,
  releaseCertificateFingerprint: sha256,
  finalMasterSha256: sha256,
  qualityEvidenceFingerprint: sha256,
  contentLaneKey: shortIdentifier,
  renderer: shortIdentifier,
  evidenceStatus: z.literal("complete"),
  routeBound: z.literal(true),
}).strict();

function receiptFingerprint(value: object): string {
  const body = { ...(value as Record<string, unknown>) };
  delete body.receiptFingerprint;
  return sha256Hex(canonicalJson(body));
}

const preflightReceipt = z.object({
  version: z.literal(PRODUCTION_ROUTE_QUALIFICATION_RECEIPT_VERSION),
  level: z.literal(ROUTE_PREFLIGHT_READY),
  ownerId: safeOwnerId,
  channelId: safeChannelId,
  binding,
  benchmarkPermission: z.literal("private_benchmark_only"),
  preflight,
  // Rich evidence is deliberately opaque to Convex. The Node-side receipt
  // codec validates it again before consumption; this envelope still seals it.
  qualificationEvidence: z.unknown().optional(),
  supersedesReceiptFingerprint: sha256.optional(),
  receiptFingerprint: sha256,
}).strict().superRefine((value, context) => {
  if (value.receiptFingerprint !== receiptFingerprint(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["receiptFingerprint"], message: "route preflight receipt fingerprint does not match its payload" });
  }
});

const releaseReceipt = z.object({
  version: z.literal(PRODUCTION_ROUTE_QUALIFICATION_RECEIPT_VERSION),
  level: z.literal(ROUTE_RELEASE_QUALIFIED),
  ownerId: safeOwnerId,
  channelId: safeChannelId,
  binding,
  preflightReceiptFingerprint: sha256,
  qualificationFingerprint: sha256,
  preflight,
  quality,
  provenance,
  supersedesReceiptFingerprint: sha256.optional(),
  receiptFingerprint: sha256,
}).strict().superRefine((value, context) => {
  if (value.receiptFingerprint !== receiptFingerprint(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["receiptFingerprint"], message: "route release qualification receipt fingerprint does not match its payload" });
  }
});

export const ProductionRouteQualificationReceiptWireSchema = z.union([
  preflightReceipt,
  releaseReceipt,
]);
export type ProductionRouteQualificationReceiptWire = z.infer<
  typeof ProductionRouteQualificationReceiptWireSchema
>;
export type RoutePreflightReadyReceiptWire = z.infer<typeof preflightReceipt>;
export type RouteReleaseQualifiedReceiptWire = z.infer<typeof releaseReceipt>;

export function assertProductionRouteQualificationReceiptWire(
  value: unknown,
): ProductionRouteQualificationReceiptWire {
  return ProductionRouteQualificationReceiptWireSchema.parse(value);
}

export function assertRoutePreflightReadyReceiptWire(value: unknown): RoutePreflightReadyReceiptWire {
  return preflightReceipt.parse(value);
}

export function assertRouteReleaseQualifiedReceiptWire(value: unknown): RouteReleaseQualifiedReceiptWire {
  return releaseReceipt.parse(value);
}
