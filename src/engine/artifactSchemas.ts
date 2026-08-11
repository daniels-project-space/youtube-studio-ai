import { z } from "zod";
import {
  ContinuityLedgerSchema,
  DPVisualSpecSchema,
  NarrativeBeatSchema,
  ShotPlanSchema,
  StorySpineSchema,
} from "./storySpine";
import {
  AssetQaReportSchema,
  SelectedStillManifestSchema,
  ShotQaReportSchema,
  ShotRenderManifestSchema,
  StillRenderManifestSchema,
  VisualCoverageSchema,
} from "./renderArtifacts";
import { ContentLaneSchema } from "./contentLane";
import { EpisodeSpecSchema, QualityEvidenceSchema } from "./qualityEvidence";
import {
  ShortCandidateSelectionSchema,
  ShortCandidateSetSchema,
  ShortStrategyBriefSchema,
  ShortStrategyManifestSchema,
} from "./shortStrategyManifest";
import { ShortRetentionManifestSchema, ShortSceneQaSchema } from "./documentaryCollageShort";
import { VisualMatterManifestSchema } from "./visualMatter";

/**
 * A versioned runtime contract for one value crossing a module boundary.
 * `opaque` is true only for migration-era values whose shape has not yet been
 * narrowed beyond JSON compatibility; Golden policy may reject opaque inputs.
 */
export interface ArtifactContract {
  key: string;
  type: string;
  version: string;
  schema: z.ZodType<unknown>;
  opaque: boolean;
  persist: "inline" | "reference" | "summary";
}

const jsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);

const nonEmpty = z.string().min(1);
const stringList = z.array(z.string());
const timedSentence = z.object({
  id: z.string().min(1).optional(),
  text: z.string(),
  start: z.number().finite().nonnegative(),
  end: z.number().finite().positive(),
}).refine((value) => value.end > value.start, "sentence end must follow start");

// The final QA receipt used to fall through to LegacyArtifact<qaReport> even
// though the probe and publishing code parsed it structurally. Keep it
// extensible while pinning every release-critical field to a real type.
const qaVerdict = z.object({
  score: z.number().finite().min(0).max(10),
  issues: z.array(z.string()),
  skipped: z.boolean().optional(),
}).passthrough();
const qaReport = z.object({
  structural: z.object({
    ok: z.boolean(),
    durationSec: z.number().finite().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  lengthMatch: z.object({
    videoSec: z.number().finite().positive(),
    targetSec: z.number().finite().positive(),
    ratio: z.number().finite().positive(),
    ok: z.boolean(),
  }),
  video: qaVerdict,
  thumbnail: qaVerdict,
  watch: z.object({
    ran: z.boolean(),
    verdict: z.enum(["pass", "fail"]),
    defects: z.array(z.record(z.string(), jsonValue)),
    summary: z.string(),
  }),
}).passthrough();

const typedSchemas: Record<string, { type: string; schema: z.ZodType<unknown>; persist?: ArtifactContract["persist"] }> = {
  topic: { type: "VideoIntent", schema: nonEmpty },
  title: { type: "PublicationTitle", schema: nonEmpty.max(100) },
  description: { type: "PublicationDescription", schema: z.string() },
  tags: { type: "PublicationTags", schema: stringList },
  script: { type: "TimedScriptDraft", schema: z.record(z.string(), jsonValue) },
  narrationText: { type: "NarrationText", schema: nonEmpty },
  sentenceTimings: { type: "TimedSentence[]", schema: z.array(timedSentence) },
  narrationDurationSec: { type: "DurationSeconds", schema: z.number().finite().positive() },
  videoDurationSec: { type: "DurationSeconds", schema: z.number().finite().positive() },
  contentLane: { type: "ContentLane", schema: ContentLaneSchema },
  qaPassed: { type: "QualityGateDecision", schema: z.boolean() },
  qaReport: { type: "FinalQaReport", schema: qaReport },
  episodeSpec: { type: "EpisodeSpec", schema: EpisodeSpecSchema },
  qualityEvidence: { type: "EpisodeQualityEvidence", schema: QualityEvidenceSchema },
  shortStrategyBrief: { type: "ShortStrategyBrief", schema: ShortStrategyBriefSchema },
  shortCandidateSet: { type: "ShortCandidateSet", schema: ShortCandidateSetSchema },
  shortCandidateSelection: { type: "ShortCandidateSelection", schema: ShortCandidateSelectionSchema },
  beatManifest: { type: "ShortStrategyManifest", schema: ShortStrategyManifestSchema, persist: "reference" },
  shortRetentionManifest: { type: "ShortRetentionManifest", schema: ShortRetentionManifestSchema },
  shortSceneQa: { type: "ShortSceneQa", schema: ShortSceneQaSchema },
  documotionVerdict: {
    type: "DocuMotionVerdict",
    schema: z.object({ pass: z.boolean().optional(), audioOk: z.boolean().optional() }).passthrough(),
  },
  documotionRender: {
    type: "DocuMotionRenderReceipt",
    schema: z.object({
      version: z.literal("documotion-short-render/v1"),
      geometry: z.object({ width: z.number().int().positive(), height: z.number().int().positive(), layout: z.literal("short") }).passthrough(),
      durationSec: z.number().finite().positive(),
      beatWindows: z.array(z.object({ id: z.string().min(1), durationSec: z.number().finite().positive() })).min(5).max(7),
      captionSafeFrame: z.object({
        top: z.number().finite().nonnegative(),
        right: z.number().finite().nonnegative(),
        bottom: z.number().finite().nonnegative(),
        left: z.number().finite().nonnegative(),
      }).strict(),
      assetReceiptKey: z.string().min(1),
      assetReceipts: z.array(z.object({
        receiptId: z.string().min(1),
        assetId: z.string().min(1),
        rendererAssetId: z.string().min(1),
        beatId: z.string().min(1),
        approvalSha256: z.array(z.string().regex(/^[a-f0-9]{64}$/i)).min(1),
      }).strict()).min(5).max(7),
    }).strict(),
  },
  originalityOk: { type: "OriginalityDecision", schema: z.boolean() },
  structure: {
    type: "DirectorTreatment",
    schema: z.object({ beats: z.array(z.record(z.string(), jsonValue)).min(1) }).passthrough(),
  },
  visualBrief: {
    type: "DPVisualSpec",
    schema: z.object({ footageQueries: z.array(z.string()) }).passthrough(),
  },
  cutSheet: {
    type: "EditorEDLBrief",
    schema: z.object({ sections: z.array(z.record(z.string(), jsonValue)).min(1) }).passthrough(),
  },
  musicBrief: {
    type: "ComposerCueSheet",
    schema: z.record(z.string(), jsonValue),
  },
  validationSpec: {
    type: "CriticValidationSpec",
    schema: z.object({ assertions: z.array(z.record(z.string(), jsonValue)).min(1) }).passthrough(),
  },
  timedScript: { type: "TimedScript", schema: StorySpineSchema.shape.timedScript },
  narrativeBeats: { type: "NarrativeBeat[]", schema: z.array(NarrativeBeatSchema).min(1) },
  continuityLedger: { type: "ContinuityLedger", schema: ContinuityLedgerSchema },
  dpVisualSpecs: { type: "DPVisualSpec[]", schema: z.array(DPVisualSpecSchema).min(1) },
  editorEdl: { type: "EditorEDL", schema: StorySpineSchema.shape.editorEdl.passthrough() },
  storyCoverage: { type: "StoryCoverage", schema: StorySpineSchema.shape.coverage },
  visualMatterManifest: {
    type: "VisualMatterManifest",
    schema: VisualMatterManifestSchema,
    persist: "reference",
  },
  shotList: {
    type: "ShotPlan[]",
    schema: z.array(ShotPlanSchema).min(1),
  },
  stillRenderManifest: { type: "StillRenderManifest", schema: StillRenderManifestSchema, persist: "reference" },
  selectedStillManifest: { type: "SelectedStillManifest", schema: SelectedStillManifestSchema, persist: "reference" },
  assetQaReport: { type: "AssetQaReport", schema: AssetQaReportSchema },
  shotRenderManifest: { type: "ShotRenderManifest", schema: ShotRenderManifestSchema, persist: "reference" },
  shotQaReport: { type: "ShotQaReport", schema: ShotQaReportSchema },
  visualCoverage: { type: "VisualCoverage", schema: VisualCoverageSchema },
  footageClips: { type: "VideoAssetRef[]", schema: stringList, persist: "reference" },
  footageKeys: { type: "R2ObjectKey[]", schema: stringList, persist: "reference" },
  stillKeys: { type: "R2ObjectKey[]", schema: stringList, persist: "reference" },
  thumbnailKey: { type: "R2ObjectKey", schema: nonEmpty, persist: "reference" },
  videoKey: { type: "R2ObjectKey", schema: nonEmpty, persist: "reference" },
  videoLocalPath: { type: "EphemeralLocalPath", schema: nonEmpty, persist: "summary" },
  watchUrl: { type: "YouTubeWatchUrl", schema: z.string().url() },
  youtubeVideoId: { type: "YouTubeVideoId", schema: nonEmpty },
};

export function artifactContract(key: string): ArtifactContract {
  const typed = typedSchemas[key];
  if (typed) {
    return {
      key,
      type: typed.type,
      version: "1.0.0",
      schema: typed.schema,
      opaque: false,
      persist: typed.persist ?? "inline",
    };
  }
  return {
    key,
    type: `LegacyArtifact<${key}>`,
    version: "1.0.0-migration",
    schema: jsonValue,
    opaque: true,
    persist: "summary",
  };
}

export function validateArtifact(contract: ArtifactContract, value: unknown): unknown {
  return contract.schema.parse(value);
}
