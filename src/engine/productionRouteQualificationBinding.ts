import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { assertCanonicalChannelProgramBrief, channelProgramBriefFingerprint } from "./channelProgramBrief";
import { assertChannelProgramRouteBinding } from "./channelProgramRoute";
import { assertChannelShowProfilePipelineCompatibility, channelShowProfileFingerprint, type ChannelShowProfile } from "./channelShowProfile";
import { assertPipelineMatchesContentLane, contentLaneForFamily, type ContentLaneKey } from "./contentLane";
import { FAMILY_KEYS, type FamilyKey } from "./families";
import type { PipelineEntry } from "./types";

export const PRODUCTION_ROUTE_QUALIFICATION_VERSION = "production-route-qualification/v1" as const;

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

function contentLaneKeyForFamily(family: FamilyKey): ContentLaneKey {
  const lane = contentLaneForFamily(family);
  if (!lane) throw new Error(`family ${family} does not resolve to a content lane`);
  return lane.key;
}

const ProgramBriefBindingSchema = z.object({
  version: identifier,
  catalogFingerprint: sha256,
  fingerprint: sha256,
}).strict();

const ShowProfileBindingSchema = z.object({
  version: identifier,
  fingerprint: sha256,
  designedPipelineFingerprint: sha256,
}).strict();

const RouteBindingSchema = z.object({
  version: identifier,
  key: shortIdentifier,
  admission: z.enum(["automatic", "supervised_private"]),
  definitionVersion: z.union([z.string().trim().min(1).max(160), z.number().int().nonnegative()]),
  definitionFingerprint: sha256,
  fingerprint: sha256,
}).strict();

const ExactCompositionBindingSchema = z.object({
  kind: z.literal("exact_catalog_v1"),
  version: identifier,
  key: shortIdentifier,
  definitionVersion: z.union([z.string().trim().min(1).max(160), z.number().int().nonnegative()]),
  definitionFingerprint: sha256,
  fingerprint: sha256,
  selectedCapabilityKeys: z.array(shortIdentifier),
}).strict();

const CapabilityPlanCompositionBindingSchema = z.object({
  kind: z.literal("capability_plan_v1"),
  version: identifier,
  key: shortIdentifier,
  definitionVersion: z.union([z.string().trim().min(1).max(160), z.number().int().nonnegative()]),
  definitionFingerprint: sha256,
  fingerprint: sha256,
  operationsFingerprint: sha256,
  selectedCapabilityKeys: z.array(shortIdentifier).min(1),
}).strict();

const CompositionBindingSchema = z.discriminatedUnion("kind", [
  ExactCompositionBindingSchema,
  CapabilityPlanCompositionBindingSchema,
]);

const ProductionRouteQualificationBindingBodySchema = z.object({
  version: z.literal(PRODUCTION_ROUTE_QUALIFICATION_VERSION),
  family: FamilyKeySchema,
  contentLaneKey: shortIdentifier,
  programBrief: ProgramBriefBindingSchema,
  showProfile: ShowProfileBindingSchema,
  route: RouteBindingSchema,
  composition: CompositionBindingSchema,
  pipelineFingerprint: sha256,
}).strict();

export type ProductionRouteQualificationBindingBody = z.infer<
  typeof ProductionRouteQualificationBindingBodySchema
>;

export function productionRouteQualificationBindingFingerprint(
  value: ProductionRouteQualificationBindingBody,
): string {
  return fingerprintWithout(value, "bindingFingerprint");
}

export const ProductionRouteQualificationBindingSchema =
  ProductionRouteQualificationBindingBodySchema.extend({
    bindingFingerprint: sha256,
  }).strict().superRefine((value, context) => {
    const normalizedCapabilities = sortedUniqueStrings(value.composition.selectedCapabilityKeys);
    if (!sameStrings(value.composition.selectedCapabilityKeys, normalizedCapabilities)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["composition", "selectedCapabilityKeys"],
        message: "composition capability keys must be sorted and unique",
      });
    }
    if (value.bindingFingerprint !== productionRouteQualificationBindingFingerprint(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bindingFingerprint"],
        message: "production-route qualification binding fingerprint does not match its payload",
      });
    }
  });

export type ProductionRouteQualificationBinding = z.infer<
  typeof ProductionRouteQualificationBindingSchema
>;

export function assertProductionRouteQualificationBinding(
  value: unknown,
): ProductionRouteQualificationBinding {
  return ProductionRouteQualificationBindingSchema.parse(value);
}

function compositionBindingFor(profile: ChannelShowProfile): ProductionRouteQualificationBindingBody["composition"] {
  if (profile.composition) {
    return {
      kind: "exact_catalog_v1",
      version: profile.composition.version,
      key: profile.composition.key,
      definitionVersion: profile.composition.definitionVersion,
      definitionFingerprint: profile.composition.definitionFingerprint,
      fingerprint: profile.composition.fingerprint,
      selectedCapabilityKeys: [...profile.selectedCapabilityKeys],
    };
  }
  const binding = profile.compositionBinding;
  if (!binding) {
    throw new Error(
      "production-route qualification requires one frozen composition authority on the show profile",
    );
  }
  if (binding.kind === "exact_catalog_v1") {
    return {
      kind: binding.kind,
      version: binding.receipt.version,
      key: binding.receipt.key,
      definitionVersion: binding.receipt.definitionVersion,
      definitionFingerprint: binding.receipt.definitionFingerprint,
      fingerprint: binding.receipt.fingerprint,
      selectedCapabilityKeys: [...profile.selectedCapabilityKeys],
    };
  }
  return {
    kind: binding.kind,
    version: binding.plan.version,
    key: binding.plan.base.key,
    definitionVersion: binding.plan.base.definitionVersion,
    definitionFingerprint: binding.plan.base.definitionFingerprint,
    fingerprint: binding.plan.fingerprint,
    operationsFingerprint: binding.plan.operationsFingerprint,
    selectedCapabilityKeys: [...binding.plan.selectedCapabilityKeys],
  };
}

/**
 * Compatibility reader for the current Program Brief, Program Route, Show
 * Profile, composition receipt, and effective compiled pipeline.
 */
export function readProductionRouteQualificationBinding(input: {
  readonly programBrief: unknown;
  readonly programRoute: unknown;
  readonly showProfile: unknown;
  readonly pipeline: unknown;
}): ProductionRouteQualificationBinding {
  const programBrief = assertCanonicalChannelProgramBrief(input.programBrief);
  const route = assertChannelProgramRouteBinding({
    route: input.programRoute,
    programBrief,
    expectedFamily: programBrief.family,
  });
  const pipeline = readablePipeline(input.pipeline);
  const contentLaneKey = contentLaneKeyForFamily(programBrief.family);
  if (route.contentLaneKey !== contentLaneKey) {
    throw new Error("production route content lane does not match the frozen family lane");
  }
  assertPipelineMatchesContentLane(contentLaneForFamily(programBrief.family), pipeline);
  const showProfile = assertChannelShowProfilePipelineCompatibility({
    profile: input.showProfile,
    programBrief,
    pipeline,
  });
  if (!showProfile.programRoute) {
    throw new Error(
      "production-route qualification does not admit a route-less historical Show Profile",
    );
  }
  if (showProfile.programRoute.fingerprint !== route.fingerprint) {
    throw new Error("show profile program route does not match the qualification route");
  }
  const pipelineFingerprint = fingerprint(pipeline);
  if (showProfile.designedPipelineFingerprint !== pipelineFingerprint) {
    throw new Error("show profile does not bind the effective qualification pipeline");
  }

  const body: ProductionRouteQualificationBindingBody = {
    version: PRODUCTION_ROUTE_QUALIFICATION_VERSION,
    family: programBrief.family,
    contentLaneKey,
    programBrief: {
      version: programBrief.version,
      catalogFingerprint: programBrief.catalogFingerprint,
      fingerprint: channelProgramBriefFingerprint(programBrief),
    },
    showProfile: {
      version: showProfile.version,
      fingerprint: channelShowProfileFingerprint(showProfile),
      designedPipelineFingerprint: showProfile.designedPipelineFingerprint,
    },
    route: {
      version: route.version,
      key: route.routeKey,
      admission: route.admission ?? "automatic",
      definitionVersion: route.definitionVersion,
      definitionFingerprint: route.definitionFingerprint,
      fingerprint: route.fingerprint,
    },
    composition: compositionBindingFor(showProfile),
    pipelineFingerprint,
  };
  return assertProductionRouteQualificationBinding({
    ...body,
    bindingFingerprint: productionRouteQualificationBindingFingerprint(body),
  });
}

