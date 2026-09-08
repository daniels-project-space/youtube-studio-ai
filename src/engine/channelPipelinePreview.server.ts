import { z } from "zod";

import {
  assertCanonicalChannelProgramBrief,
  briefToCreativeCapabilityIntent,
  type ChannelProgramBrief,
} from "@/engine/channelProgramBrief";
import {
  resolveChannelProgramRoute,
  type ChannelProgramRoute,
} from "@/engine/channelProgramRoute";
import { deriveCreatorIntentDiagnosis } from "@/engine/creatorIntentDiagnosis";
import {
  validateCreativeCapabilitySelections,
} from "@/engine/creative/creativeCapabilityCatalog";
import {
  designPipelineCore,
  type DesignResult,
} from "@/engine/designerCore";
import { syntheticScenarioContract } from "@/engine/syntheticScenario";
import { VISUAL_TREATMENT_KEYS } from "@/engine/visualTreatmentCatalog";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export const CHANNEL_PIPELINE_PREVIEW_VERSION = "channel-pipeline-preview/v1" as const;

const PreviewTogglesSchema = z.object({
  quotes: z.boolean().optional(),
  captions: z.boolean().optional(),
  chapters: z.boolean().optional(),
  notify: z.boolean().optional(),
  crosspost: z.boolean().optional(),
  shorts: z.boolean().optional(),
  documentaryCandidates: z.boolean().optional(),
  visualMatter: z.boolean().optional(),
  visualTreatment: z.enum(VISUAL_TREATMENT_KEYS).optional(),
  visualMatterReferenceAssets: z.boolean().optional(),
  studioAssetLibrary: z.boolean().optional(),
  crew: z.boolean().optional(),
}).strict();

/**
 * Browser input accepted by the read-only compiler projection. The sealed
 * route, intent diagnosis, capability admission, and pipeline remain
 * server-derived; unknown fields cannot become design authority.
 */
const ChannelPipelinePreviewInputSchema = z.object({
  programBrief: z.unknown(),
  lengthMinutes: z.number().finite().positive().max(480).optional(),
  footageTheme: z.string().max(160).optional(),
  voiceFx: z.string().max(80).optional(),
  publishMode: z.string().max(40).optional(),
  approvedForPublish: z.boolean().optional(),
  toggles: PreviewTogglesSchema.optional(),
  paramOverrides: z.unknown().optional(),
  sourceReferences: z.unknown().optional(),
  claimEvidence: z.unknown().optional(),
  capabilitySelections: z.unknown().optional(),
}).strict();

const ChannelPipelinePreviewSnapshotSchema = z.object({
  version: z.literal(CHANNEL_PIPELINE_PREVIEW_VERSION),
  family: z.string().min(1),
  routeKey: z.string().min(1),
  routeFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  pipelineFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  blocks: z.array(z.string().min(1)).min(1),
  episodeLengthSeconds: z.number().finite().positive(),
  contentLane: z.string().min(1),
}).strict();

export interface ChannelPipelinePreview {
  readonly version: typeof CHANNEL_PIPELINE_PREVIEW_VERSION;
  readonly family: string;
  readonly routeKey: string;
  readonly routeFingerprint: string;
  readonly pipelineFingerprint: string;
  readonly blocks: readonly string[];
  readonly episodeLengthSeconds: number;
  readonly contentLane: string;
}

export type ChannelPipelinePreviewSnapshot = ChannelPipelinePreview;

const PREVIEW_INPUT_FIELDS = [
  "programBrief",
  "lengthMinutes",
  "footageTheme",
  "voiceFx",
  "publishMode",
  "approvedForPublish",
  "toggles",
  "paramOverrides",
  "sourceReferences",
  "claimEvidence",
  "capabilitySelections",
] as const;

/**
 * Project a larger, request-key-bound channel design back to the exact input
 * accepted by the read-only compiler. Unknown browser fields never gain
 * compiler authority merely because the build payload also needs them.
 */
export function channelPipelinePreviewInputFromDesign(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("channel design is required to compile its pipeline preview");
  }
  const design = value as Record<string, unknown>;
  return Object.fromEntries(
    PREVIEW_INPUT_FIELDS
      .filter((field) => design[field] !== undefined)
      .map((field) => [field, design[field]]),
  );
}

/**
 * A preview is an operator-reviewed snapshot, never route authority. Recompile
 * from the current catalog and require every visible claim to remain exact
 * before a build can dispatch or write channel state.
 */
export function assertChannelPipelinePreviewSnapshot(
  value: unknown,
  current: ChannelPipelinePreview,
): ChannelPipelinePreviewSnapshot {
  let snapshot: ChannelPipelinePreviewSnapshot;
  try {
    snapshot = ChannelPipelinePreviewSnapshotSchema.parse(value);
  } catch {
    throw new Error("channel pipeline preview snapshot is missing or invalid; review the exact route again");
  }
  if (canonicalJson(snapshot) !== canonicalJson(current)) {
    throw new Error("channel pipeline preview is stale; review the newly compiled route before building");
  }
  return Object.freeze({ ...snapshot, blocks: Object.freeze([...snapshot.blocks]) });
}

export function channelPipelinePreviewFromCompiledDesign(input: {
  programBrief: ChannelProgramBrief;
  programRoute: ChannelProgramRoute;
  design: Pick<DesignResult, "pipeline" | "episodeLengthSeconds" | "contentLane">;
}): ChannelPipelinePreview {
  return Object.freeze({
    version: CHANNEL_PIPELINE_PREVIEW_VERSION,
    family: input.programBrief.family,
    routeKey: input.programRoute.routeKey,
    routeFingerprint: input.programRoute.fingerprint,
    pipelineFingerprint: sha256Hex(canonicalJson(input.design.pipeline)),
    blocks: Object.freeze(input.design.pipeline.map((entry) => entry.block)),
    episodeLengthSeconds: input.design.episodeLengthSeconds,
    contentLane: input.design.contentLane.key,
  });
}

/**
 * Compile the exact route-bearing design used by channel inception without
 * dispatching Trigger, touching a provider, reserving spend, or writing data.
 */
export function compileChannelPipelinePreview(value: unknown): ChannelPipelinePreview {
  const input = ChannelPipelinePreviewInputSchema.parse(value);
  const programBrief = assertCanonicalChannelProgramBrief(input.programBrief);
  const programRoute = resolveChannelProgramRoute(programBrief);
  const creatorIntentDiagnosis = deriveCreatorIntentDiagnosis({
    programBrief,
    programRoute,
  });
  const capabilitySelections = validateCreativeCapabilitySelections({
    family: programBrief.family,
    selections: input.capabilitySelections,
    intent: briefToCreativeCapabilityIntent(programBrief),
  }).map(({ selection }) => ({ ...selection }));
  const syntheticScenario = programRoute.syntheticScenarioProfile
    ? syntheticScenarioContract(programRoute.syntheticScenarioProfile)
    : undefined;
  const design = designPipelineCore({
    family: programBrief.family,
    nicheKey: programBrief.nicheKey,
    subcategory: programBrief.subcategory,
    programBrief,
    programRoute,
    creatorIntentDiagnosis,
    lengthMinutes: input.lengthMinutes,
    locale: programBrief.locale,
    footageTheme: input.footageTheme,
    voiceFx: input.voiceFx,
    publishMode: input.publishMode ?? "draft",
    approvedForPublish: input.approvedForPublish,
    toggles: input.toggles,
    paramOverrides: input.paramOverrides as Record<string, Record<string, unknown>> | undefined,
    sourceReferences: input.sourceReferences,
    claimEvidence: input.claimEvidence,
    capabilitySelections,
    syntheticScenario,
    quizProfile: programRoute.quizProfile,
  }, { validateRuntimeRegistry: false });

  return channelPipelinePreviewFromCompiledDesign({
    programBrief,
    programRoute,
    design,
  });
}
