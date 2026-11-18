import { z } from "zod";

import {
  videoReleaseProvenanceClaimFromCertificate,
  type VideoReleaseProvenanceClaim,
} from "@/lib/videoReleaseProvenance";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

import {
  assertCanonicalChannelProgramBrief,
  channelProgramBriefFingerprint,
} from "./channelProgramBrief";
import {
  assertChannelProgramRouteBinding,
} from "./channelProgramRoute";
import { designPipeline, type DesignOptions } from "./designer";
import { FAMILY_KEYS, type FamilyKey } from "./families";
import {
  QualityEvidenceSchema,
  assessProductionEditorialAcceptance,
} from "./qualityEvidence";
import {
  NOVITA_LOCKED_VIDEO_RUNTIME,
  assessPipelineVideoRuntimeReadiness,
  type NovitaVideoRuntimeTarget,
} from "./runtimeCapability";
import type { PipelineEntry } from "./types";

/**
 * A pure, read-only qualification projection for a concrete production route.
 *
 * This is deliberately not an admission switch and it performs no execution.
 * It is the shared evidence seam future family qualification can consume:
 * every conclusion is derived from current planner, inception, runtime,
 * quality, release-provenance, and (where relevant) Visual Matter receipts.
 */
import { PRODUCTION_ROUTE_QUALIFICATION_VERSION, ProductionRouteQualificationBindingSchema, assertProductionRouteQualificationBinding, type ProductionRouteQualificationBinding } from "./productionRouteQualificationBinding";
export { PRODUCTION_ROUTE_QUALIFICATION_VERSION, ProductionRouteQualificationBindingSchema, assertProductionRouteQualificationBinding, productionRouteQualificationBindingFingerprint, readProductionRouteQualificationBinding } from "./productionRouteQualificationBinding";
export type { ProductionRouteQualificationBinding, ProductionRouteQualificationBindingBody } from "./productionRouteQualificationBinding";
export const PRODUCTION_ROUTE_PLANNER_EVIDENCE_VERSION =
  "production-route-planner-evidence/v1" as const;
import { ProductionRouteInceptionEvidenceSchema, assertProductionRouteInceptionEvidence } from "./productionRouteInceptionEvidence";
export { PRODUCTION_ROUTE_INCEPTION_EVIDENCE_VERSION, ProductionRouteInceptionEvidenceSchema, assertProductionRouteInceptionEvidence, productionRouteInceptionEvidenceFingerprint, readProductionRouteInceptionEvidence } from "./productionRouteInceptionEvidence";
export type { ProductionRouteInceptionEvidence, ProductionRouteInceptionEvidenceBody } from "./productionRouteInceptionEvidence";
export const PRODUCTION_ROUTE_RUNTIME_EVIDENCE_VERSION =
  "production-route-runtime-evidence/v1" as const;
export const PRODUCTION_ROUTE_QUALITY_EVIDENCE_VERSION =
  "production-route-quality-evidence/v1" as const;
export const PRODUCTION_ROUTE_PROVENANCE_EVIDENCE_VERSION =
  "production-route-provenance-evidence/v1" as const;
import { ProductionRouteVisualMatterEvidenceSchema, assertProductionRouteVisualMatterEvidence } from "./productionRouteVisualMatterEvidence";
export { PRODUCTION_ROUTE_VISUAL_MATTER_EVIDENCE_VERSION, ProductionRouteVisualMatterEvidenceSchema, assertProductionRouteVisualMatterEvidence, productionRouteVisualMatterEvidenceFingerprint, readProductionRouteVisualMatterEvidence } from "./productionRouteVisualMatterEvidence";
export type { ProductionRouteVisualMatterEvidence, ProductionRouteVisualMatterEvidenceBody } from "./productionRouteVisualMatterEvidence";

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const sha256 = z.string().regex(SHA256_PATTERN, "expected SHA-256 fingerprint");
const identifier = z.string().trim().min(1).max(512);
const shortIdentifier = z.string().trim().min(1).max(160);

const FamilyKeySchema = z.string().refine(
  (value) => (FAMILY_KEYS as readonly string[]).includes(value),
  "unknown channel family",
);

const pipelineEntrySchema = z.object({
  block: shortIdentifier,
  params: z.unknown().optional(),
}).passthrough();
const pipelineSchema = z.array(pipelineEntrySchema).min(1);

const sortedUniqueStrings = (values: readonly string[]): string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );

const sameStrings = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

function fingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function fingerprintWithout(value: object, field: string): string {
  const body = { ...(value as Record<string, unknown>) };
  delete body[field];
  return fingerprint(body);
}

function readablePipeline(value: unknown): readonly PipelineEntry[] {
  return pipelineSchema.parse(value) as unknown as readonly PipelineEntry[];
}

const PlannerEvidenceBodySchema = z.object({
  version: z.literal(PRODUCTION_ROUTE_PLANNER_EVIDENCE_VERSION),
  bindingFingerprint: sha256,
  plannerKey: z.literal("engine/designPipeline"),
  planFingerprint: sha256,
  pipelineFingerprint: sha256,
  contentLaneKey: shortIdentifier,
  episodeLengthSeconds: z.number().finite().positive(),
  available: z.boolean(),
  productionReady: z.boolean(),
  runtimeBlockers: z.array(identifier),
}).strict();

export type ProductionRoutePlannerEvidenceBody = z.infer<typeof PlannerEvidenceBodySchema>;

export function productionRoutePlannerEvidenceFingerprint(
  value: ProductionRoutePlannerEvidenceBody,
): string {
  return fingerprintWithout(value, "evidenceFingerprint");
}

export const ProductionRoutePlannerEvidenceSchema = PlannerEvidenceBodySchema.extend({
  evidenceFingerprint: sha256,
}).strict().superRefine((value, context) => {
  if (value.evidenceFingerprint !== productionRoutePlannerEvidenceFingerprint(value)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["evidenceFingerprint"],
      message: "planner evidence fingerprint does not match its payload",
    });
  }
});

export type ProductionRoutePlannerEvidence = z.infer<typeof ProductionRoutePlannerEvidenceSchema>;

export function assertProductionRoutePlannerEvidence(value: unknown): ProductionRoutePlannerEvidence {
  return ProductionRoutePlannerEvidenceSchema.parse(value);
}

/**
 * Re-runs the pure pipeline designer from a frozen brief + route and refuses
 * a supplied pipeline that is not exactly the current planner output.
 */
export function readProductionRoutePlannerEvidence(input: {
  readonly binding: unknown;
  readonly options: DesignOptions;
}): ProductionRoutePlannerEvidence {
  const binding = assertProductionRouteQualificationBinding(input.binding);
  if (!input.options.programBrief || !input.options.programRoute) {
    throw new Error("production-route planner evidence requires a frozen program brief and program route");
  }
  const brief = assertCanonicalChannelProgramBrief(input.options.programBrief);
  const route = assertChannelProgramRouteBinding({
    route: input.options.programRoute,
    programBrief: brief,
    expectedFamily: binding.family as FamilyKey,
  });
  if (
    input.options.family !== binding.family
    || channelProgramBriefFingerprint(brief) !== binding.programBrief.fingerprint
    || route.fingerprint !== binding.route.fingerprint
  ) {
    throw new Error("planner inputs do not match the frozen production-route qualification binding");
  }
  const design = designPipeline(input.options);
  const pipeline = readablePipeline(design.pipeline);
  const pipelineFingerprint = fingerprint(pipeline);
  if (pipelineFingerprint !== binding.pipelineFingerprint) {
    throw new Error("planner output does not match the frozen qualification pipeline");
  }
  if (design.contentLane.key !== binding.contentLaneKey) {
    throw new Error("planner output content lane does not match the frozen route binding");
  }
  const runtimeBlockers = sortedUniqueStrings(design.runtimeBlockers);
  const body: ProductionRoutePlannerEvidenceBody = {
    version: PRODUCTION_ROUTE_PLANNER_EVIDENCE_VERSION,
    bindingFingerprint: binding.bindingFingerprint,
    plannerKey: "engine/designPipeline",
    planFingerprint: fingerprint({
      pipeline,
      contentLane: design.contentLane,
      episodeLengthSeconds: design.episodeLengthSeconds,
      available: design.available,
      productionReady: design.productionReady,
      runtimeBlockers,
    }),
    pipelineFingerprint,
    contentLaneKey: design.contentLane.key,
    episodeLengthSeconds: design.episodeLengthSeconds,
    available: design.available,
    productionReady: design.productionReady,
    runtimeBlockers,
  };
  return assertProductionRoutePlannerEvidence({
    ...body,
    evidenceFingerprint: productionRoutePlannerEvidenceFingerprint(body),
  });
}

const RuntimeEvidenceBodySchema = z.object({
  version: z.literal(PRODUCTION_ROUTE_RUNTIME_EVIDENCE_VERSION),
  bindingFingerprint: sha256,
  plannerEvidenceFingerprint: sha256,
  pipelineFingerprint: sha256,
  runtimeTargetFingerprint: sha256,
  videoReadinessFingerprint: sha256,
  videoRequired: z.boolean(),
  ready: z.boolean(),
  blockers: z.array(identifier),
}).strict();

export type ProductionRouteRuntimeEvidenceBody = z.infer<typeof RuntimeEvidenceBodySchema>;

export function productionRouteRuntimeEvidenceFingerprint(
  value: ProductionRouteRuntimeEvidenceBody,
): string {
  return fingerprintWithout(value, "evidenceFingerprint");
}

export const ProductionRouteRuntimeEvidenceSchema = RuntimeEvidenceBodySchema.extend({
  evidenceFingerprint: sha256,
}).strict().superRefine((value, context) => {
  const normalized = sortedUniqueStrings(value.blockers);
  if (!sameStrings(value.blockers, normalized)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["blockers"],
      message: "runtime blockers must be sorted and unique",
    });
  }
  if (value.ready !== (value.blockers.length === 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ready"],
      message: "runtime ready must exactly reflect the absence of blockers",
    });
  }
  if (value.evidenceFingerprint !== productionRouteRuntimeEvidenceFingerprint(value)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["evidenceFingerprint"],
      message: "runtime evidence fingerprint does not match its payload",
    });
  }
});

export type ProductionRouteRuntimeEvidence = z.infer<typeof ProductionRouteRuntimeEvidenceSchema>;

export function assertProductionRouteRuntimeEvidence(value: unknown): ProductionRouteRuntimeEvidence {
  return ProductionRouteRuntimeEvidenceSchema.parse(value);
}

/** Reads the locked runtime assessment for the exact frozen planner pipeline. */
export function readProductionRouteRuntimeEvidence(input: {
  readonly binding: unknown;
  readonly planner: unknown;
  readonly pipeline: unknown;
  readonly runtimeTarget?: NovitaVideoRuntimeTarget;
}): ProductionRouteRuntimeEvidence {
  const binding = assertProductionRouteQualificationBinding(input.binding);
  const planner = assertProductionRoutePlannerEvidence(input.planner);
  const pipeline = readablePipeline(input.pipeline);
  const pipelineFingerprint = fingerprint(pipeline);
  if (
    planner.bindingFingerprint !== binding.bindingFingerprint
    || planner.pipelineFingerprint !== binding.pipelineFingerprint
    || pipelineFingerprint !== binding.pipelineFingerprint
  ) {
    throw new Error("runtime evidence must be assessed against the frozen planner pipeline");
  }
  const target = input.runtimeTarget ?? NOVITA_LOCKED_VIDEO_RUNTIME;
  const video = assessPipelineVideoRuntimeReadiness(pipeline, target);
  const blockers = sortedUniqueStrings([
    ...(!planner.available ? ["planner reports that this family template is unavailable"] : []),
    ...(!planner.productionReady ? planner.runtimeBlockers : []),
    ...video.blockers.map((blocker) => `video runtime: ${blocker}`),
  ]);
  const body: ProductionRouteRuntimeEvidenceBody = {
    version: PRODUCTION_ROUTE_RUNTIME_EVIDENCE_VERSION,
    bindingFingerprint: binding.bindingFingerprint,
    plannerEvidenceFingerprint: planner.evidenceFingerprint,
    pipelineFingerprint,
    runtimeTargetFingerprint: fingerprint(target),
    videoReadinessFingerprint: fingerprint(video),
    videoRequired: video.videoRequired,
    ready: blockers.length === 0,
    blockers,
  };
  return assertProductionRouteRuntimeEvidence({
    ...body,
    evidenceFingerprint: productionRouteRuntimeEvidenceFingerprint(body),
  });
}

const QualityEvidenceBodySchema = z.object({
  version: z.literal(PRODUCTION_ROUTE_QUALITY_EVIDENCE_VERSION),
  bindingFingerprint: sha256,
  qualityEvidenceFingerprint: sha256,
  editorialAcceptanceFingerprint: sha256,
  contentLaneKey: shortIdentifier,
  renderer: shortIdentifier.optional(),
  hardGateReady: z.boolean(),
  calibrationComplete: z.boolean(),
  ready: z.boolean(),
  blockers: z.array(identifier),
}).strict();

export type ProductionRouteQualityEvidenceBody = z.infer<typeof QualityEvidenceBodySchema>;

export function productionRouteQualityEvidenceFingerprint(
  value: ProductionRouteQualityEvidenceBody,
): string {
  return fingerprintWithout(value, "evidenceFingerprint");
}

export const ProductionRouteQualityEvidenceSchema = QualityEvidenceBodySchema.extend({
  evidenceFingerprint: sha256,
}).strict().superRefine((value, context) => {
  const normalized = sortedUniqueStrings(value.blockers);
  if (!sameStrings(value.blockers, normalized)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["blockers"],
      message: "quality blockers must be sorted and unique",
    });
  }
  if (value.ready !== (value.blockers.length === 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ready"],
      message: "quality ready must exactly reflect the absence of blockers",
    });
  }
  if (value.evidenceFingerprint !== productionRouteQualityEvidenceFingerprint(value)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["evidenceFingerprint"],
      message: "quality evidence fingerprint does not match its payload",
    });
  }
});

export type ProductionRouteQualityEvidence = z.infer<typeof ProductionRouteQualityEvidenceSchema>;

export function assertProductionRouteQualityEvidence(value: unknown): ProductionRouteQualityEvidence {
  return ProductionRouteQualityEvidenceSchema.parse(value);
}

/** Reads the shared quality receipt and its actual editorial acceptance result. */
export function readProductionRouteQualityEvidence(input: {
  readonly binding: unknown;
  readonly qualityEvidence: unknown;
}): ProductionRouteQualityEvidence {
  const binding = assertProductionRouteQualificationBinding(input.binding);
  const qualityEvidence = QualityEvidenceSchema.parse(input.qualityEvidence);
  if (qualityEvidence.episode.lane.key !== binding.contentLaneKey) {
    throw new Error("quality evidence content lane does not match the frozen route binding");
  }
  const editorial = assessProductionEditorialAcceptance(qualityEvidence);
  const blockers = sortedUniqueStrings([
    ...editorial.blockers,
    ...(!qualityEvidence.release.calibrationComplete
      ? ["quality receipt has unresolved calibration gaps"]
      : []),
  ]);
  const body: ProductionRouteQualityEvidenceBody = {
    version: PRODUCTION_ROUTE_QUALITY_EVIDENCE_VERSION,
    bindingFingerprint: binding.bindingFingerprint,
    qualityEvidenceFingerprint: fingerprint(qualityEvidence),
    editorialAcceptanceFingerprint: fingerprint(editorial),
    contentLaneKey: qualityEvidence.episode.lane.key,
    ...(qualityEvidence.episode.lane.renderer
      ? { renderer: qualityEvidence.episode.lane.renderer }
      : {}),
    hardGateReady: qualityEvidence.release.hardGateReady,
    calibrationComplete: qualityEvidence.release.calibrationComplete,
    ready: blockers.length === 0,
    blockers,
  };
  return assertProductionRouteQualityEvidence({
    ...body,
    evidenceFingerprint: productionRouteQualityEvidenceFingerprint(body),
  });
}

const VideoReleaseProvenanceClaimSchema = z.object({
  version: identifier,
  releaseCertificateKey: identifier,
  releaseCertificateFingerprint: sha256,
  finalMasterSha256: sha256,
  qualityBindingVersion: identifier,
  qualityBindingFingerprint: sha256,
  qualityEvidenceFingerprint: sha256,
  contentLaneKey: shortIdentifier,
  renderer: shortIdentifier,
  programRoute: z.object({
    routeFingerprint: sha256,
    family: FamilyKeySchema,
    contentLaneKey: shortIdentifier,
    programBriefFingerprint: sha256.optional(),
  }).strict().optional(),
  evidenceStatus: z.enum(["complete", "partial", "unmeasured"]),
  storyMeasurementCoverage: z.enum([
    "unmeasured",
    "plan_only",
    "final_master",
    "scope_undeclared",
  ]).optional(),
}).strict();

const ProvenanceEvidenceBodySchema = z.object({
  version: z.literal(PRODUCTION_ROUTE_PROVENANCE_EVIDENCE_VERSION),
  bindingFingerprint: sha256,
  provenanceFingerprint: sha256,
  releaseCertificateFingerprint: sha256,
  releaseCertificateKey: identifier,
  finalMasterSha256: sha256,
  qualityEvidenceFingerprint: sha256,
  contentLaneKey: shortIdentifier,
  renderer: shortIdentifier,
  evidenceStatus: z.enum(["complete", "partial", "unmeasured"]),
  routeBound: z.boolean(),
  ready: z.boolean(),
  blockers: z.array(identifier),
}).strict();

export type ProductionRouteProvenanceEvidenceBody = z.infer<typeof ProvenanceEvidenceBodySchema>;

export function productionRouteProvenanceEvidenceFingerprint(
  value: ProductionRouteProvenanceEvidenceBody,
): string {
  return fingerprintWithout(value, "evidenceFingerprint");
}

export const ProductionRouteProvenanceEvidenceSchema = ProvenanceEvidenceBodySchema.extend({
  evidenceFingerprint: sha256,
}).strict().superRefine((value, context) => {
  const normalized = sortedUniqueStrings(value.blockers);
  if (!sameStrings(value.blockers, normalized)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["blockers"],
      message: "provenance blockers must be sorted and unique",
    });
  }
  if (value.ready !== (value.blockers.length === 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ready"],
      message: "provenance ready must exactly reflect the absence of blockers",
    });
  }
  if (value.evidenceFingerprint !== productionRouteProvenanceEvidenceFingerprint(value)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["evidenceFingerprint"],
      message: "provenance evidence fingerprint does not match its payload",
    });
  }
});

export type ProductionRouteProvenanceEvidence = z.infer<typeof ProductionRouteProvenanceEvidenceSchema>;

export function assertProductionRouteProvenanceEvidence(value: unknown): ProductionRouteProvenanceEvidence {
  return ProductionRouteProvenanceEvidenceSchema.parse(value);
}

/**
 * Reads a release-provenance claim derived from an actual final-master release
 * certificate. It does not turn the claim into publishing authority.
 */
export function readProductionRouteProvenanceEvidence(input: {
  readonly binding: unknown;
  readonly quality: unknown;
  readonly claim: VideoReleaseProvenanceClaim | unknown;
}): ProductionRouteProvenanceEvidence {
  const binding = assertProductionRouteQualificationBinding(input.binding);
  const quality = assertProductionRouteQualityEvidence(input.quality);
  const claim = VideoReleaseProvenanceClaimSchema.parse(input.claim);
  const routeBound = Boolean(
    claim.programRoute
    && claim.programRoute.routeFingerprint === binding.route.fingerprint
    && claim.programRoute.family === binding.family
    && claim.programRoute.contentLaneKey === binding.contentLaneKey
    && claim.programRoute.programBriefFingerprint === binding.programBrief.fingerprint,
  );
  const blockers = sortedUniqueStrings([
    ...(quality.bindingFingerprint !== binding.bindingFingerprint
      ? ["quality evidence does not belong to this production-route binding"]
      : []),
    ...(claim.qualityEvidenceFingerprint !== quality.qualityEvidenceFingerprint
      ? ["release provenance points to a different quality evidence receipt"]
      : []),
    ...(claim.contentLaneKey !== binding.contentLaneKey
      ? ["release provenance content lane does not match the frozen route binding"]
      : []),
    ...(quality.renderer && claim.renderer !== quality.renderer
      ? ["release provenance renderer does not match the sealed quality receipt"]
      : []),
    ...(!routeBound
      ? ["release provenance is missing the exact route and program-brief binding"]
      : []),
    ...(claim.evidenceStatus !== "complete"
      ? [`release provenance evidence coverage is ${claim.evidenceStatus}, not complete`]
      : []),
  ]);
  const body: ProductionRouteProvenanceEvidenceBody = {
    version: PRODUCTION_ROUTE_PROVENANCE_EVIDENCE_VERSION,
    bindingFingerprint: binding.bindingFingerprint,
    provenanceFingerprint: fingerprint(claim),
    releaseCertificateFingerprint: claim.releaseCertificateFingerprint,
    releaseCertificateKey: claim.releaseCertificateKey,
    finalMasterSha256: claim.finalMasterSha256,
    qualityEvidenceFingerprint: claim.qualityEvidenceFingerprint,
    contentLaneKey: claim.contentLaneKey,
    renderer: claim.renderer,
    evidenceStatus: claim.evidenceStatus,
    routeBound,
    ready: blockers.length === 0,
    blockers,
  };
  return assertProductionRouteProvenanceEvidence({
    ...body,
    evidenceFingerprint: productionRouteProvenanceEvidenceFingerprint(body),
  });
}

/** Convenience reader for the existing final-master-certificate adapter. */
export function readProductionRouteProvenanceEvidenceFromReleaseCertificate(input: {
  readonly binding: unknown;
  readonly quality: unknown;
  readonly certificate: unknown;
  readonly releaseCertificateKey: string;
  readonly expectedFinalMasterSha256: string;
}): ProductionRouteProvenanceEvidence {
  const claim = videoReleaseProvenanceClaimFromCertificate({
    certificate: input.certificate,
    releaseCertificateKey: input.releaseCertificateKey,
    expectedFinalMasterSha256: input.expectedFinalMasterSha256,
  });
  if (!claim) {
    throw new Error("final-master release certificate has no quality-bound provenance claim");
  }
  return readProductionRouteProvenanceEvidence({
    binding: input.binding,
    quality: input.quality,
    claim,
  });
}

export type ProductionRouteQualificationMode = "automatic" | "supervised";
export type ProductionRouteQualificationStatus = "qualified" | "supervised_review" | "blocked";

const QualificationBlockerSchema = z.object({
  domain: z.enum(["binding", "mode", "planner", "inception", "runtime", "quality", "provenance", "visual_matter"]),
  code: shortIdentifier,
  message: identifier,
  remediation: identifier,
}).strict();

export type ProductionRouteQualificationBlocker = z.infer<typeof QualificationBlockerSchema>;

const QualificationEvidenceSchema = z.object({
  planner: ProductionRoutePlannerEvidenceSchema.optional(),
  inception: ProductionRouteInceptionEvidenceSchema.optional(),
  runtime: ProductionRouteRuntimeEvidenceSchema.optional(),
  quality: ProductionRouteQualityEvidenceSchema.optional(),
  provenance: ProductionRouteProvenanceEvidenceSchema.optional(),
  visualMatter: ProductionRouteVisualMatterEvidenceSchema.optional(),
}).strict();

const ProductionRouteQualificationBodySchema = z.object({
  version: z.literal(PRODUCTION_ROUTE_QUALIFICATION_VERSION),
  mode: z.enum(["automatic", "supervised"]),
  status: z.enum(["qualified", "supervised_review", "blocked"]),
  automaticReady: z.boolean(),
  binding: ProductionRouteQualificationBindingSchema.optional(),
  evidence: QualificationEvidenceSchema,
  blockers: z.array(QualificationBlockerSchema),
}).strict();

function validateProductionRouteQualificationBody(
  value: z.infer<typeof ProductionRouteQualificationBodySchema>,
  context: z.RefinementCtx,
): void {
  const duplicateKeys = new Set<string>();
  for (const blocker of value.blockers) {
    const key = `${blocker.domain}:${blocker.code}:${blocker.message}`;
    if (duplicateKeys.has(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockers"],
        message: "qualification blockers must be unique",
      });
      break;
    }
    duplicateKeys.add(key);
  }
  if (value.status === "qualified") {
    if (value.mode !== "automatic" || !value.automaticReady || value.blockers.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "qualified status requires automatic mode, no blockers, and automaticReady",
      });
    }
  } else if (value.status === "supervised_review") {
    if (value.mode !== "supervised" || value.automaticReady || value.blockers.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "supervised review requires supervised mode, no blockers, and no automatic readiness",
      });
    }
  } else if (value.automaticReady || !value.blockers.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "blocked qualification must have at least one blocker and cannot be automatic-ready",
    });
  }
}

export type ProductionRouteQualificationBody = z.infer<typeof ProductionRouteQualificationBodySchema>;

export function productionRouteQualificationFingerprint(value: ProductionRouteQualificationBody): string {
  return fingerprintWithout(value, "qualificationFingerprint");
}

export const ProductionRouteQualificationSchema = ProductionRouteQualificationBodySchema.extend({
  qualificationFingerprint: sha256,
}).strict().superRefine((value, context) => {
  validateProductionRouteQualificationBody(value, context);
  if (value.qualificationFingerprint !== productionRouteQualificationFingerprint(value)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["qualificationFingerprint"],
      message: "production-route qualification fingerprint does not match its payload",
    });
  }
});

export type ProductionRouteQualification = z.infer<typeof ProductionRouteQualificationSchema>;

export function parseProductionRouteQualification(value: unknown): ProductionRouteQualification {
  return ProductionRouteQualificationSchema.parse(value);
}

export const ProductionRouteQualificationInputSchema = z.object({
  mode: z.enum(["automatic", "supervised"]).optional(),
  binding: z.unknown().optional(),
  planner: z.unknown().optional(),
  inception: z.unknown().optional(),
  runtime: z.unknown().optional(),
  quality: z.unknown().optional(),
  provenance: z.unknown().optional(),
  visualMatter: z.unknown().optional(),
}).strict();

export type ProductionRouteQualificationInput = z.input<
  typeof ProductionRouteQualificationInputSchema
>;

function blocker(
  domain: ProductionRouteQualificationBlocker["domain"],
  code: string,
  message: string,
  remediation: string,
): ProductionRouteQualificationBlocker {
  return { domain, code, message, remediation };
}

function parseEvidence<T>(input: {
  readonly value: unknown;
  readonly present: boolean;
  readonly domain: ProductionRouteQualificationBlocker["domain"];
  readonly missingCode: string;
  readonly missingMessage: string;
  readonly remediation: string;
  readonly parse: (value: unknown) => T;
  readonly blockers: ProductionRouteQualificationBlocker[];
}): T | undefined {
  if (!input.present) {
    input.blockers.push(blocker(
      input.domain,
      input.missingCode,
      input.missingMessage,
      input.remediation,
    ));
    return undefined;
  }
  try {
    return input.parse(input.value);
  } catch (error) {
    input.blockers.push(blocker(
      input.domain,
      `${input.domain}_invalid`,
      error instanceof Error ? error.message : `${input.domain} evidence is malformed`,
      input.remediation,
    ));
    return undefined;
  }
}

function sortedBlockers(
  values: readonly ProductionRouteQualificationBlocker[],
): ProductionRouteQualificationBlocker[] {
  const byKey = new Map<string, ProductionRouteQualificationBlocker>();
  for (const value of values) {
    const key = `${value.domain}:${value.code}:${value.message}`;
    if (!byKey.has(key)) byKey.set(key, value);
  }
  return [...byKey.values()].sort((left, right) =>
    `${left.domain}:${left.code}:${left.message}`.localeCompare(
      `${right.domain}:${right.code}:${right.message}`,
    ),
  );
}

/**
 * Fail-closed qualification projection. Supplying no evidence is intentionally
 * blocked; only compatibility-reader outputs can form a qualified route.
 */
export function assessProductionRouteQualification(
  value: ProductionRouteQualificationInput = {},
): ProductionRouteQualification {
  const input = ProductionRouteQualificationInputSchema.parse(value);
  const mode: ProductionRouteQualificationMode = input.mode ?? "automatic";
  const blockers: ProductionRouteQualificationBlocker[] = [];
  const binding = parseEvidence({
    value: input.binding,
    present: input.binding !== undefined,
    domain: "binding",
    missingCode: "binding_missing",
    missingMessage: "production route binding is required",
    remediation: "Read a binding from the frozen Program Brief, Program Route, Show Profile, composition, and effective pipeline.",
    parse: assertProductionRouteQualificationBinding,
    blockers,
  });

  const planner = parseEvidence({
    value: input.planner,
    present: input.planner !== undefined,
    domain: "planner",
    missingCode: "planner_evidence_missing",
    missingMessage: "planner evidence is required",
    remediation: "Read planner evidence from the frozen DesignOptions through readProductionRoutePlannerEvidence.",
    parse: assertProductionRoutePlannerEvidence,
    blockers,
  });
  const inception = parseEvidence({
    value: input.inception,
    present: input.inception !== undefined,
    domain: "inception",
    missingCode: "inception_evidence_missing",
    missingMessage: "deterministic channel-inception plan evidence is required",
    remediation: "Read evidence from the persisted plan-only Channel Inception artifact.",
    parse: assertProductionRouteInceptionEvidence,
    blockers,
  });
  const runtime = parseEvidence({
    value: input.runtime,
    present: input.runtime !== undefined,
    domain: "runtime",
    missingCode: "runtime_evidence_missing",
    missingMessage: "runtime evidence is required",
    remediation: "Assess the exact frozen pipeline with readProductionRouteRuntimeEvidence.",
    parse: assertProductionRouteRuntimeEvidence,
    blockers,
  });
  const quality = parseEvidence({
    value: input.quality,
    present: input.quality !== undefined,
    domain: "quality",
    missingCode: "quality_evidence_missing",
    missingMessage: "quality evidence is required",
    remediation: "Read the shared QualityEvidence receipt through readProductionRouteQualityEvidence.",
    parse: assertProductionRouteQualityEvidence,
    blockers,
  });
  const provenance = parseEvidence({
    value: input.provenance,
    present: input.provenance !== undefined,
    domain: "provenance",
    missingCode: "provenance_evidence_missing",
    missingMessage: "final-master release provenance is required",
    remediation: "Read the certificate-derived VideoReleaseProvenance claim through readProductionRouteProvenanceEvidence.",
    parse: assertProductionRouteProvenanceEvidence,
    blockers,
  });
  const visualMatter = parseEvidence({
    value: input.visualMatter,
    present: input.visualMatter !== undefined,
    domain: "visual_matter",
    missingCode: "visual_matter_evidence_missing",
    missingMessage: "Visual Matter applicability evidence is required, including an explicit not-required receipt when unused",
    remediation: "Read Visual Matter controls through readProductionRouteVisualMatterEvidence.",
    parse: assertProductionRouteVisualMatterEvidence,
    blockers,
  });

  if (binding) {
    if (mode === "automatic" && binding.route.admission !== "automatic") {
      blockers.push(blocker(
        "mode",
        "supervised_route_cannot_auto_qualify",
        `route ${binding.route.key} is ${binding.route.admission} and cannot be automatically qualified`,
        "Use supervised mode for review-only planning, or select an admitted automatic route.",
      ));
    }
    const sameBinding = (evidence: { bindingFingerprint: string } | undefined, domain: ProductionRouteQualificationBlocker["domain"]): void => {
      if (evidence && evidence.bindingFingerprint !== binding.bindingFingerprint) {
        blockers.push(blocker(
          domain,
          "binding_mismatch",
          `${domain} evidence belongs to a different production-route binding`,
          "Re-read this evidence from the same frozen Program Brief, Show Profile, route, composition, and pipeline.",
        ));
      }
    };
    sameBinding(planner, "planner");
    sameBinding(inception, "inception");
    sameBinding(runtime, "runtime");
    sameBinding(quality, "quality");
    sameBinding(provenance, "provenance");
    sameBinding(visualMatter, "visual_matter");
    if (planner) {
      if (planner.pipelineFingerprint !== binding.pipelineFingerprint || planner.contentLaneKey !== binding.contentLaneKey) {
        blockers.push(blocker(
          "planner",
          "planner_output_mismatch",
          "planner evidence does not describe the frozen pipeline and content lane",
          "Re-run the planner compatibility reader with the exact binding inputs.",
        ));
      }
      if (!planner.available || !planner.productionReady) {
        blockers.push(blocker(
          "planner",
          "planner_not_production_ready",
          "planner reports this family template is not production-ready",
          "Resolve the planner's concrete runtime blockers before treating the route as automatic.",
        ));
      }
    }
    if (inception && inception.pipelineFingerprint !== binding.pipelineFingerprint) {
      blockers.push(blocker(
        "inception",
        "inception_pipeline_mismatch",
        "channel-inception evidence does not use the frozen effective pipeline",
        "Regenerate the plan-only Channel Inception artifact from the same frozen binding.",
      ));
    }
    if (runtime) {
      if (runtime.plannerEvidenceFingerprint !== planner?.evidenceFingerprint) {
        blockers.push(blocker(
          "runtime",
          "runtime_planner_mismatch",
          "runtime evidence is not linked to the supplied planner evidence",
          "Read runtime readiness from the exact planner evidence and effective pipeline.",
        ));
      }
      if (!runtime.ready) {
        blockers.push(blocker(
          "runtime",
          "runtime_not_ready",
          runtime.blockers.join("; ") || "runtime evidence did not pass",
          "Resolve every concrete runtime blocker, then re-read the locked runtime assessment.",
        ));
      }
    }
    if (quality) {
      if (quality.contentLaneKey !== binding.contentLaneKey) {
        blockers.push(blocker(
          "quality",
          "quality_lane_mismatch",
          "quality evidence content lane does not match the frozen route",
          "Rebuild the quality receipt for this exact content lane.",
        ));
      }
      if (!quality.ready) {
        blockers.push(blocker(
          "quality",
          "quality_not_ready",
          quality.blockers.join("; ") || "quality evidence did not pass",
          "Resolve hard-gate, editorial, and calibration gaps before re-reading quality evidence.",
        ));
      }
    }
    if (provenance) {
      if (
        provenance.qualityEvidenceFingerprint !== quality?.qualityEvidenceFingerprint
        || provenance.contentLaneKey !== binding.contentLaneKey
      ) {
        blockers.push(blocker(
          "provenance",
          "provenance_quality_or_lane_mismatch",
          "release provenance does not bind the supplied quality receipt and content lane",
          "Regenerate certificate-derived provenance from the exact final master and quality receipt.",
        ));
      }
      if (!provenance.ready) {
        blockers.push(blocker(
          "provenance",
          "provenance_not_ready",
          provenance.blockers.join("; ") || "release provenance did not pass",
          "Attach complete route-bound final-master provenance before re-qualifying.",
        ));
      }
    }
    if (visualMatter?.required && !visualMatter.controlsReady) {
      blockers.push(blocker(
        "visual_matter",
        "visual_matter_controls_not_ready",
        "required Visual Matter per-shot controls are not ready",
        "Attach the required manifest and every per-shot directive before re-qualifying.",
      ));
    }
  }

  const sorted = sortedBlockers(blockers);
  const status: ProductionRouteQualificationStatus = sorted.length
    ? "blocked"
    : mode === "automatic"
      ? "qualified"
      : "supervised_review";
  const body: ProductionRouteQualificationBody = {
    version: PRODUCTION_ROUTE_QUALIFICATION_VERSION,
    mode,
    status,
    automaticReady: status === "qualified",
    ...(binding ? { binding } : {}),
    evidence: {
      ...(planner ? { planner } : {}),
      ...(inception ? { inception } : {}),
      ...(runtime ? { runtime } : {}),
      ...(quality ? { quality } : {}),
      ...(provenance ? { provenance } : {}),
      ...(visualMatter ? { visualMatter } : {}),
    },
    blockers: sorted,
  };
  return parseProductionRouteQualification({
    ...body,
    qualificationFingerprint: productionRouteQualificationFingerprint(body),
  });
}

export function isProductionRouteQualified(value: unknown): boolean {
  try {
    return parseProductionRouteQualification(value).status === "qualified";
  } catch {
    return false;
  }
}

export function assertProductionRouteQualified(
  input: ProductionRouteQualificationInput,
): ProductionRouteQualification {
  const qualification = assessProductionRouteQualification(input);
  if (qualification.status !== "qualified") {
    const detail = qualification.blockers.map((entry) => entry.message).join("; ");
    throw new Error(`production route is not automatically qualified: ${detail}`);
  }
  return qualification;
}
