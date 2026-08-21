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
import { EpisodeGraphSchema, SceneManifestSchema } from "./episodeGraph";
import { LearningContractSchema } from "./learningContract";
import {
  SyntheticScenarioContractSchema,
  SyntheticScenarioDisclosureSchema,
} from "./syntheticScenario";
import {
  ChildrenShowBibleApprovalReceiptSchema,
  ChildrenShowBibleInputSchema,
  ChildrenShowBibleSchema,
} from "./childrenShowBible";
import {
  CurriculumEpisodeSeedApprovalReceiptSchema,
  CurriculumEpisodeSeedInputSchema,
  CurriculumEpisodeSeedSchema,
} from "./curriculumEpisodeSeed";
import {
  CasefileEvidenceShotMapAdmissionReceiptSchema,
  CasefileEvidenceShotMapInputSchema,
  CasefileEvidenceShotMapSchema,
} from "./casefileEvidenceShotMap";
import {
  CasefileSourceAdmissionReceiptSchema,
  CasefileSourcePacketSchema,
} from "./sourceFirstAdmission";
import { SourceBoundStorySpineHandoffSchema } from "./sourceBoundStorySpine";
import { EvidenceVisualManifestSchema } from "./evidenceVisualManifest";
import { EditorialEvidencePacketSchema } from "./editorialEvidencePacket";
import { NarrativeEvidenceLedgerSchema } from "./narrativeEvidenceLedger";
import {
  CinematicCaseSequenceAdmissionReceiptSchema,
  CinematicCaseSequenceInputSchema,
  CinematicCaseSequencePlanSchema,
  CinematicCreativeLocksSchema,
  CinematicEditDecisionListSchema,
  CinematicGeneratedScenePlanSchema,
  CinematicSequenceEditorialReviewSchema,
} from "./cinematicCaseSequence";
import {
  CinematicCaseDirectionSchema,
  CinematicCaseSequenceDraftSchema,
} from "./cinematicCaseSequenceDraft";
import { CinematicFinalMasterQaAdmissionSchema } from "./cinematicFinalMasterQaAdmission";
import { GeneratedFootageSceneManifestSchema } from "./generatedFootageManifest";
import { VisualPacingEvidenceSchema } from "@/lib/visualPacing";
import {
  FinalMasterReleaseCertificateReferenceSchema,
  FinalMasterReleaseCertificateSchema,
} from "@/lib/finalMasterReleaseCertificate";

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
  narrationPerformanceEvidence: {
    type: "NarrationPerformanceEvidence",
    schema: z.object({
      version: z.literal("narration-performance-evidence/v1"),
      source: z.literal("local_ffmpeg"),
      durationSec: z.number().finite().min(1.5),
      wordCount: z.number().finite().int().min(3),
      wordsPerSec: z.number().finite().positive(),
      integratedLufs: z.number().finite().min(-36).max(-6),
      windowMeanDb: z.number().finite().min(-48).max(-3),
    }),
  },
  videoDurationSec: { type: "DurationSeconds", schema: z.number().finite().positive() },
  contentLane: { type: "ContentLane", schema: ContentLaneSchema },
  syntheticScenario: {
    type: "SyntheticScenarioContract",
    schema: SyntheticScenarioContractSchema,
    persist: "reference",
  },
  syntheticScenarioDisclosure: {
    type: "SyntheticScenarioDisclosure",
    schema: SyntheticScenarioDisclosureSchema,
    persist: "reference",
  },
  qaPassed: { type: "QualityGateDecision", schema: z.boolean() },
  qaReport: { type: "FinalQaReport", schema: qaReport },
  episodeSpec: { type: "EpisodeSpec", schema: EpisodeSpecSchema },
  qualityEvidence: { type: "EpisodeQualityEvidence", schema: QualityEvidenceSchema },
  visualPacing: { type: "FinalMasterVisualPacingEvidence", schema: VisualPacingEvidenceSchema },
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
  // Legacy key retained for pipeline compatibility. The typed receipt below
  // records the narrower, actually measured local lexical self-dedup result.
  originalityOk: { type: "LocalScriptSelfDedupDecision", schema: z.literal(true) },
  maxLexicalShingleSimilarity: {
    type: "LexicalShingleSimilarity",
    schema: z.number().finite().min(0).max(1),
  },
  scriptSelfDedupReceipt: {
    type: "LocalScriptSelfDedupReceipt",
    schema: z.object({
      version: z.literal("local-script-self-dedup/v1"),
      checkStatus: z.literal("measured"),
      comparisonMethod: z.literal("lexical-shingle-jaccard/v1"),
      corpusSource: z.enum(["empty", "local_script_index", "legacy_embedding_index"]),
      canonicalScriptSha256: z.string().regex(/^[a-f0-9]{64}$/i),
      lexicalTokenCount: z.number().int().positive(),
      shingleSize: z.literal(5),
      candidateLexicalShingleCount: z.number().int().positive(),
      comparableCorpusEntries: z.number().int().nonnegative(),
      legacyUnmeasuredCorpusEntries: z.number().int().nonnegative(),
      highestLexicalShingleSimilarity: z.number().finite().min(0).max(1),
      nearestComparable: z.object({
        canonicalScriptSha256: z.string().regex(/^[a-f0-9]{64}$/i),
        runId: z.string(),
        topic: z.string(),
        lexicalShingleSimilarity: z.number().finite().min(0).max(1),
      }).strict().nullable(),
      threshold: z.number().finite().gt(0).max(1),
      passesLexicalSelfDedup: z.literal(true),
    }).strict(),
  },
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
  episodeGraph: { type: "EpisodeGraph", schema: EpisodeGraphSchema, persist: "reference" },
  sceneManifest: { type: "SceneManifest", schema: SceneManifestSchema, persist: "reference" },
  lessonContract: { type: "LearningContract", schema: LearningContractSchema, persist: "reference" },
  curriculumEpisodeSeedInput: {
    type: "CurriculumEpisodeSeedInput",
    schema: CurriculumEpisodeSeedInputSchema,
    persist: "reference",
  },
  curriculumEpisodeSeed: {
    type: "CurriculumEpisodeSeed",
    schema: CurriculumEpisodeSeedSchema,
    persist: "reference",
  },
  curriculumEpisodeSeedApproval: {
    type: "CurriculumEpisodeSeedApprovalReceipt",
    schema: CurriculumEpisodeSeedApprovalReceiptSchema,
    persist: "reference",
  },
  childrenShowBibleInput: {
    type: "ChildrenShowBibleInput",
    schema: ChildrenShowBibleInputSchema,
    persist: "reference",
  },
  childrenShowBible: {
    type: "ChildrenShowBible",
    schema: ChildrenShowBibleSchema,
    persist: "reference",
  },
  childrenShowBibleApproval: {
    type: "ChildrenShowBibleApprovalReceipt",
    schema: ChildrenShowBibleApprovalReceiptSchema,
    persist: "reference",
  },
  casefileSourcePacketInput: {
    type: "CasefileSourcePacketInput",
    schema: CasefileSourcePacketSchema,
    persist: "reference",
  },
  casefileSourcePacket: {
    type: "CasefileSourcePacket",
    schema: CasefileSourcePacketSchema,
    persist: "reference",
  },
  casefileSourceAdmission: {
    type: "CasefileSourceAdmissionReceipt",
    schema: CasefileSourceAdmissionReceiptSchema,
    persist: "reference",
  },
  casefileEvidenceShotMapInput: {
    type: "CasefileEvidenceShotMapInput",
    schema: CasefileEvidenceShotMapInputSchema,
    persist: "reference",
  },
  casefileEvidenceShotMap: {
    type: "CasefileEvidenceShotMap",
    schema: CasefileEvidenceShotMapSchema,
    persist: "reference",
  },
  casefileEvidenceShotMapAdmission: {
    type: "CasefileEvidenceShotMapAdmissionReceipt",
    schema: CasefileEvidenceShotMapAdmissionReceiptSchema,
    persist: "reference",
  },
  sourceBoundStorySpine: {
    type: "SourceBoundStorySpineHandoff",
    schema: SourceBoundStorySpineHandoffSchema,
    persist: "reference",
  },
  evidenceVisualManifests: {
    type: "EvidenceVisualManifest[]",
    schema: z.array(EvidenceVisualManifestSchema).max(48),
    persist: "reference",
  },
  editorialEvidencePacketInput: {
    type: "EditorialEvidencePacketInput",
    schema: EditorialEvidencePacketSchema,
    persist: "reference",
  },
  editorialEvidencePacket: {
    type: "EditorialEvidencePacket",
    schema: EditorialEvidencePacketSchema,
    persist: "reference",
  },
  narrativeEvidenceLedger: {
    type: "NarrativeEvidenceLedger",
    schema: NarrativeEvidenceLedgerSchema,
    persist: "reference",
  },
  cinematicCaseSequenceInput: {
    type: "CinematicCaseSequenceInput",
    schema: CinematicCaseSequenceInputSchema,
    persist: "reference",
  },
  cinematicCaseDirection: {
    type: "CinematicCaseDirection",
    schema: CinematicCaseDirectionSchema,
    persist: "reference",
  },
  cinematicCaseSequenceDraft: {
    type: "CinematicCaseSequenceDraft",
    schema: CinematicCaseSequenceDraftSchema,
    persist: "reference",
  },
  cinematicSequenceEditorialReview: {
    type: "CinematicSequenceEditorialReview",
    schema: CinematicSequenceEditorialReviewSchema,
    persist: "reference",
  },
  cinematicSequencePlan: {
    type: "CinematicCaseSequencePlan",
    schema: CinematicCaseSequencePlanSchema,
    persist: "reference",
  },
  cinematicGeneratedScenePlan: {
    type: "CinematicGeneratedScenePlan",
    schema: CinematicGeneratedScenePlanSchema,
    persist: "reference",
  },
  cinematicCreativeLocks: {
    type: "CinematicCreativeLocks",
    schema: CinematicCreativeLocksSchema,
    persist: "reference",
  },
  cinematicEditDecisionList: {
    type: "CinematicEditDecisionList",
    schema: CinematicEditDecisionListSchema,
    persist: "reference",
  },
  cinematicCaseSequenceAdmission: {
    type: "CinematicCaseSequenceAdmissionReceipt",
    schema: CinematicCaseSequenceAdmissionReceiptSchema,
    persist: "reference",
  },
  cinematicFinalMasterQaAdmission: {
    type: "CinematicFinalMasterQaAdmission",
    schema: CinematicFinalMasterQaAdmissionSchema,
    persist: "reference",
  },
  generatedFootageSceneManifest: {
    type: "GeneratedFootageSceneManifest",
    schema: GeneratedFootageSceneManifestSchema,
    persist: "reference",
  },
  childContentSafety: {
    type: "ChildContentSafetyReceipt",
    schema: z.object({
      version: z.literal("child-content-safety/v1"),
      pass: z.literal(true),
      madeForKids: z.literal(true),
      audience: z.literal("children"),
      release: z.literal("human-editorial-approval-required"),
      allowedPublishMode: z.literal("draft"),
      reviewReasons: z.array(z.string().min(1)).min(1),
      episodeGraphFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      sceneManifestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      lessonContractFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      childrenShowBibleFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      curriculumEpisodeSeedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    }).strict(),
  },
  sceneCompilerReceipt: {
    type: "SceneCompilerReceipt",
    schema: z.object({
      version: z.literal("scene-compiler-render/v1"),
      renderer: z.literal("deterministic-scene/v1"),
      manifestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      externalProviderCalls: z.literal(0),
      sceneCount: z.number().int().positive(),
      width: z.literal(1920),
      height: z.literal(1080),
      durationSec: z.number().finite().positive(),
      hasAudio: z.literal(true),
    }).strict(),
  },
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
  finalMasterReleaseCertificate: {
    type: "FinalMasterReleaseCertificate",
    schema: FinalMasterReleaseCertificateSchema,
    // The complete certificate is durably stored in R2; the artifact row keeps
    // its content-addressed lineage without duplicating a potentially large
    // cinematic/audio receipt into the dashboard payload.
    persist: "reference",
  },
  // Stable compact pointer for audit projections. The authoritative full
  // certificate stays in R2 and may legitimately exceed the inline artifact
  // budget because it includes narration/cinematic receipts.
  finalMasterReleaseCertificateReference: {
    type: "FinalMasterReleaseCertificateReference",
    schema: FinalMasterReleaseCertificateReferenceSchema,
    persist: "reference",
  },
  finalMasterReleaseCertificateKey: {
    type: "R2ObjectKey",
    schema: nonEmpty,
    persist: "reference",
  },
  // A derivative Short is a second rendered master, not evidence carried over
  // from its landscape parent. Its compact certificate reference is retained
  // separately so cleanup/UI consumers cannot mistake the parent's review for
  // proof of the post-crop, post-caption artifact.
  shortKey: { type: "R2ObjectKey", schema: nonEmpty, persist: "reference" },
  shortVideoId: { type: "YouTubeVideoId", schema: nonEmpty },
  shortReleaseCertificateReference: {
    type: "FinalMasterReleaseCertificateReference",
    schema: FinalMasterReleaseCertificateReferenceSchema,
    persist: "reference",
  },
  shortReleaseCertificateKey: {
    type: "R2ObjectKey",
    schema: nonEmpty,
    persist: "reference",
  },
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
