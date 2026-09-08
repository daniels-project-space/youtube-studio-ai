import { z } from "zod";

import {
  assertCanonicalChannelProgramBrief,
  briefToCreativeCapabilityIntent,
} from "@/engine/channelProgramBrief";
import { resolveChannelProgramRoute } from "@/engine/channelProgramRoute";
import { deriveCreatorIntentDiagnosis } from "@/engine/creatorIntentDiagnosis";
import {
  validateCreativeCapabilitySelections,
} from "@/engine/creative/creativeCapabilityCatalog";
import { designPipelineCore } from "@/engine/designerCore";
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

  return Object.freeze({
    version: CHANNEL_PIPELINE_PREVIEW_VERSION,
    family: programBrief.family,
    routeKey: programRoute.routeKey,
    routeFingerprint: programRoute.fingerprint,
    pipelineFingerprint: sha256Hex(canonicalJson(design.pipeline)),
    blocks: Object.freeze(design.pipeline.map((entry) => entry.block)),
    episodeLengthSeconds: design.episodeLengthSeconds,
    contentLane: design.contentLane.key,
  });
}
