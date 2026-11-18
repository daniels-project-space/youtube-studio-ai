import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { buildChannelInceptionPlan, type ChannelInceptionPlan, type ChannelInceptionRequest } from "./channelInceptionPlan";
import { assertCanonicalChannelProgramBrief, channelProgramBriefFingerprint } from "./channelProgramBrief";
import { assertChannelProgramRouteBinding } from "./channelProgramRoute";
import { channelShowProfileFingerprint, parseChannelShowProfile } from "./channelShowProfile";
import { FAMILY_KEYS, type FamilyKey } from "./families";
import { assertProductionRouteQualificationBinding } from "./productionRouteQualificationBinding";

export const PRODUCTION_ROUTE_INCEPTION_EVIDENCE_VERSION = "production-route-inception-evidence/v1" as const;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, "expected SHA-256 fingerprint");
const identifier = z.string().trim().min(1).max(512);
const FamilyKeySchema = z.string().refine(value => (FAMILY_KEYS as readonly string[]).includes(value), "unknown channel family");
const sortedUniqueStrings = (values: readonly string[]): string[] => [...new Set(values.map(value => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
const sameStrings = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && left.every((value, index) => value === right[index]);
function fingerprint(value: unknown): string { return sha256Hex(canonicalJson(value)); }
function fingerprintWithout(value: object, field: string): string { const body = { ...(value as Record<string, unknown>) }; delete body[field]; return fingerprint(body); }

const InceptionEvidenceBodySchema = z.object({
  version: z.literal(PRODUCTION_ROUTE_INCEPTION_EVIDENCE_VERSION),
  bindingFingerprint: sha256,
  inceptionSchemaVersion: identifier,
  inceptionKey: identifier,
  requestFingerprint: sha256,
  pipelineFingerprint: sha256,
  stageKeys: z.array(identifier).min(1),
  planFingerprint: sha256,
}).strict();

export type ProductionRouteInceptionEvidenceBody = z.infer<typeof InceptionEvidenceBodySchema>;

export function productionRouteInceptionEvidenceFingerprint(
  value: ProductionRouteInceptionEvidenceBody,
): string {
  return fingerprintWithout(value, "evidenceFingerprint");
}

export const ProductionRouteInceptionEvidenceSchema = InceptionEvidenceBodySchema.extend({
  evidenceFingerprint: sha256,
}).strict().superRefine((value, context) => {
  const normalized = sortedUniqueStrings(value.stageKeys);
  if (!sameStrings(value.stageKeys, normalized)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["stageKeys"],
      message: "inception stage keys must be sorted and unique",
    });
  }
  if (value.evidenceFingerprint !== productionRouteInceptionEvidenceFingerprint(value)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["evidenceFingerprint"],
      message: "inception evidence fingerprint does not match its payload",
    });
  }
});

export type ProductionRouteInceptionEvidence = z.infer<typeof ProductionRouteInceptionEvidenceSchema>;

export function assertProductionRouteInceptionEvidence(value: unknown): ProductionRouteInceptionEvidence {
  return ProductionRouteInceptionEvidenceSchema.parse(value);
}

const ChannelInceptionPlanCompatibilitySchema = z.object({
  schemaVersion: identifier,
  mode: z.literal("plan-only"),
  providerCallsAuthorized: z.literal(false),
  inceptionKey: identifier,
  requestFingerprint: sha256,
  requestSnapshot: z.object({
    family: FamilyKeySchema,
    pipelineSourceFingerprint: sha256,
    programBrief: z.unknown(),
    programRoute: z.unknown().optional(),
    showProfile: z.unknown().optional(),
  }).passthrough(),
  channel: z.object({ family: FamilyKeySchema }).passthrough(),
  stages: z.array(z.object({
    stageKey: identifier,
  }).passthrough()).min(1),
}).passthrough();

/**
 * Reads a persisted plan-only Channel Inception artifact by rebuilding it from
 * its immutable request snapshot. This verifies the plan rather than trusting
 * a stored status field, and does not authorize or invoke provider work.
 */
export function readProductionRouteInceptionEvidence(input: {
  readonly binding: unknown;
  readonly plan: ChannelInceptionPlan | unknown;
}): ProductionRouteInceptionEvidence {
  const binding = assertProductionRouteQualificationBinding(input.binding);
  const plan = ChannelInceptionPlanCompatibilitySchema.parse(input.plan);
  const snapshot = plan.requestSnapshot;
  if (!snapshot.programRoute || !snapshot.showProfile) {
    throw new Error("production-route inception evidence requires a route-bound Show Profile snapshot");
  }
  const brief = assertCanonicalChannelProgramBrief(snapshot.programBrief);
  const route = assertChannelProgramRouteBinding({
    route: snapshot.programRoute,
    programBrief: brief,
    expectedFamily: binding.family as FamilyKey,
  });
  const showProfile = parseChannelShowProfile(snapshot.showProfile);
  if (
    snapshot.family !== binding.family
    || plan.channel.family !== binding.family
    || channelProgramBriefFingerprint(brief) !== binding.programBrief.fingerprint
    || route.fingerprint !== binding.route.fingerprint
    || channelShowProfileFingerprint(showProfile) !== binding.showProfile.fingerprint
    || snapshot.pipelineSourceFingerprint !== binding.pipelineFingerprint
  ) {
    throw new Error("channel inception plan does not match the frozen production-route qualification binding");
  }

  const expected = buildChannelInceptionPlan(
    snapshot as unknown as ChannelInceptionRequest,
  );
  const actualStageKeys = sortedUniqueStrings(plan.stages.map((stage) => stage.stageKey));
  const expectedStageKeys = sortedUniqueStrings(expected.stages.map((stage) => stage.stageKey));
  if (
    plan.schemaVersion !== expected.schemaVersion
    || plan.inceptionKey !== expected.inceptionKey
    || plan.requestFingerprint !== expected.requestFingerprint
    || !sameStrings(actualStageKeys, expectedStageKeys)
  ) {
    throw new Error("channel inception plan is not the exact deterministic output of its request snapshot");
  }
  const body: ProductionRouteInceptionEvidenceBody = {
    version: PRODUCTION_ROUTE_INCEPTION_EVIDENCE_VERSION,
    bindingFingerprint: binding.bindingFingerprint,
    inceptionSchemaVersion: plan.schemaVersion,
    inceptionKey: plan.inceptionKey,
    requestFingerprint: plan.requestFingerprint,
    pipelineFingerprint: binding.pipelineFingerprint,
    stageKeys: actualStageKeys,
    planFingerprint: fingerprint({
      schemaVersion: plan.schemaVersion,
      inceptionKey: plan.inceptionKey,
      requestFingerprint: plan.requestFingerprint,
      requestSnapshot: snapshot,
      stageKeys: actualStageKeys,
    }),
  };
  return assertProductionRouteInceptionEvidence({
    ...body,
    evidenceFingerprint: productionRouteInceptionEvidenceFingerprint(body),
  });
}

