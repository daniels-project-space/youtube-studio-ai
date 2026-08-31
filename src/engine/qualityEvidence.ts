import { z } from "zod";

import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/**
 * A deliberately small, provider-neutral receipt for an individual episode.
 *
 * `hardGateReady` means only that the explicit release gates which were
 * supplied passed. It is not a claim that every dimension was evaluated. Call
 * sites should surface `calibrationComplete` (and its gaps) whenever they
 * describe an output's quality.
 */
export const QUALITY_EVIDENCE_VERSION = "1.0.0" as const;

const ScoreSchema = z.number().finite().min(0).max(10);
const CountSchema = z.number().int().nonnegative();
const EvidenceListSchema = z.array(z.string().min(1));
const FingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/i, "expected SHA-256");

function selfContainedPlanTopicFingerprint(topic: string): string {
  return sha256Hex(canonicalJson(topic.trim()));
}

/**
 * A story measurement may describe an approved plan or the rendered master.
 * These scopes must never be conflated: a pre-render plan does not establish
 * that every planned beat survived the final edit.
 */
export const StoryMeasurementScopeSchema = z.enum(["plan", "final_master"]);
/**
 * The modality of a final-master story measurement. A narration-semantic
 * receipt proves that planned spoken beats survived into the released master;
 * it must never be read as proof that every planned visual shot did.
 */
export const StoryMeasurementKindSchema = z.enum(["narration_semantic"]);

/** Exact source emitted by the content-addressed Story Spine narration audit. */
export const FINAL_MASTER_NARRATED_STORY_COVERAGE_SOURCE =
  "final-master-narrated-story-coverage/v1" as const;
/** Existing Story Spine receipt source: it is plan-time only. */
export const VALIDATED_STORY_SPINE_SOURCE = "validated-story-spine/v1" as const;

const SelfContainedStoryPlanCountsSchema = z.object({
  /** Canonical cross-family plan measures. These are never final-master coverage. */
  beatCount: z.number().int().positive(),
  shotCount: z.number().int().positive(),
  /** Family-specific exact plan measures retained for audit and cost reasoning. */
  panelCount: z.number().int().positive().optional(),
  sceneCount: z.number().int().positive().optional(),
  artLayerCount: z.number().int().positive().optional(),
  spokenLineCount: z.number().int().positive().optional(),
  characterCount: CountSchema.optional(),
}).strict();

/**
 * Immutable provenance for a sealed self-contained creative plan. It is
 * intentionally explicit about being pre-render evidence; final-master
 * visual/narrative coverage remains the responsibility of `qa_visual`.
 */
export const SelfContainedStoryPlanEvidenceSchema = z.object({
  version: z.literal("self-contained-story-plan-evidence/v1"),
  measurementScope: z.literal("plan"),
  family: z.enum(["whiteboard", "comic", "loreshort"]),
  storyKind: z.enum([
    "whiteboard-storyboard/v1",
    "motion-comic-storyboard/v1",
    "lore-plan/v1",
  ]),
  contentLaneKey: z.string().trim().min(1).max(120),
  topic: z.string().trim().min(1).max(500),
  topicFingerprint: FingerprintSchema,
  routeFingerprint: FingerprintSchema,
  programBriefFingerprint: FingerprintSchema,
  receiptFingerprint: FingerprintSchema,
  storyFingerprint: FingerprintSchema,
  plannerId: z.string().trim().min(1).max(160),
  receiptVersion: z.string().trim().min(1).max(128),
  /**
   * Exact approved spoken text for whiteboard/comic, retained only as a
   * digest. It lets final QA bind the sealed plan to the independently
   * auditable narration that actually reached the released master.
   */
  narrationTextSha256: FingerprintSchema.optional(),
  counts: SelfContainedStoryPlanCountsSchema,
}).strict().superRefine((value, ctx) => {
  const expectedKind = value.family === "whiteboard"
    ? "whiteboard-storyboard/v1"
    : value.family === "comic"
      ? "motion-comic-storyboard/v1"
      : "lore-plan/v1";
  if (value.storyKind !== expectedKind) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "self-contained plan family does not match story kind" });
  }
  if (value.topicFingerprint !== selfContainedPlanTopicFingerprint(value.topic)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "self-contained plan topic fingerprint does not match topic" });
  }
  if (value.family === "whiteboard" && value.counts.panelCount === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "whiteboard plan evidence requires panelCount" });
  }
  if (value.family === "comic" && value.counts.panelCount === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "motion-comic plan evidence requires panelCount" });
  }
  if (value.family === "loreshort" && value.counts.sceneCount === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "lore plan evidence requires sceneCount" });
  }
  if (
    (value.family === "whiteboard" || value.family === "comic") &&
    value.narrationTextSha256 === undefined
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "narrated self-contained plan evidence requires its approved narration digest",
    });
  }
  if (value.family === "loreshort" && value.narrationTextSha256 !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "non-narrated lore plan evidence must not claim a narration digest",
    });
  }
});

export const QualityAxisNameSchema = z.enum([
  "technical",
  "visual",
  "temporal",
  "narrative",
  "audio",
  "brand",
]);

export const QualityAxisStatusSchema = z.enum([
  "pass",
  "fail",
  "advisory",
  "not_measured",
]);

export const QualityAxisEvidenceSchema = z.object({
  status: QualityAxisStatusSchema,
  evaluator: z.string().min(1),
  evidence: EvidenceListSchema.min(1),
  score: ScoreSchema.optional(),
  minimumScore: ScoreSchema.optional(),
});

export const StoryEvidenceSchema = z.object({
  status: z.enum(["measured", "not_measured"]),
  source: z.string().min(1).optional(),
  beatCount: CountSchema.optional(),
  shotCount: CountSchema.optional(),
  coverageRatio: z.number().finite().min(0).max(1).optional(),
  /** Absent on historical/legacy receipts whose story evidence scope was not declared. */
  measurementScope: StoryMeasurementScopeSchema.optional(),
  /** Explicitly distinguishes final-master narrated-story coverage from visual coverage. */
  measurementKind: StoryMeasurementKindSchema.optional(),
  /** Compact link to the sealed final-master narrated-story coverage receipt. */
  finalMasterNarratedStoryReceiptFingerprint: FingerprintSchema.optional(),
  /** Optional immutable plan provenance; it can never establish final-master coverage. */
  plan: SelfContainedStoryPlanEvidenceSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.measurementScope === "plan" && !value.plan) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "plan-scoped story evidence requires a sealed plan receipt" });
  }
  if (value.measurementScope === "final_master") {
    if (value.status !== "measured") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "final-master story measurement must be marked measured" });
    }
    if (value.source === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "final-master story measurement requires a source" });
    }
    if (value.coverageRatio === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "final-master story measurement requires a coverage ratio" });
    }
  }
  if (value.plan) {
    if (value.status !== "measured") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sealed plan evidence must be marked measured" });
    }
    if (value.measurementScope !== "plan") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sealed plan evidence must retain plan measurement scope" });
    }
    if (value.coverageRatio !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "pre-render plan evidence must not claim final-master coverage ratio",
      });
    }
    if (value.source !== "self-contained-story-receipt/v1") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sealed plan evidence has an invalid source" });
    }
    if (value.beatCount !== value.plan.counts.beatCount || value.shotCount !== value.plan.counts.shotCount) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sealed plan counts must match story evidence counts" });
    }
  }
  if (value.measurementScope === "final_master" && value.plan) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "final-master story evidence cannot reuse a pre-render plan receipt" });
  }
  if (value.measurementKind === "narration_semantic") {
    if (value.measurementScope !== "final_master") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "narration-semantic story coverage must be scoped to the final master" });
    }
    if (value.source !== FINAL_MASTER_NARRATED_STORY_COVERAGE_SOURCE) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "narration-semantic story coverage has an invalid source" });
    }
    if (!value.finalMasterNarratedStoryReceiptFingerprint) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "narration-semantic story coverage requires its sealed receipt fingerprint" });
    }
    if (!value.beatCount || !value.shotCount || value.coverageRatio === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "narration-semantic story coverage requires Story Spine counts and a coverage ratio" });
    }
  } else if (value.finalMasterNarratedStoryReceiptFingerprint !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "final-master narrated-story receipt fingerprint requires narration-semantic measurement kind" });
  }
});

export const CandidateSelectionEvidenceSchema = z.object({
  generated: CountSchema.optional(),
  selected: CountSchema.optional(),
  rejected: CountSchema.optional(),
  evidence: EvidenceListSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.generated !== undefined && value.selected !== undefined && value.selected > value.generated) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "selected candidates cannot exceed generated candidates" });
  }
  if (value.generated !== undefined && value.rejected !== undefined && value.rejected > value.generated) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "rejected candidates cannot exceed generated candidates" });
  }
  if (
    value.generated !== undefined &&
    value.selected !== undefined &&
    value.rejected !== undefined &&
    value.selected + value.rejected > value.generated
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "selected and rejected candidates exceed generated candidates" });
  }
});

export const RepairEvidenceSchema = z.object({
  attempted: CountSchema.optional(),
  succeeded: CountSchema.optional(),
  failed: CountSchema.optional(),
  evidence: EvidenceListSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.attempted !== undefined && value.succeeded !== undefined && value.succeeded > value.attempted) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "successful repairs cannot exceed attempted repairs" });
  }
  if (value.attempted !== undefined && value.failed !== undefined && value.failed > value.attempted) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "failed repairs cannot exceed attempted repairs" });
  }
  if (
    value.attempted !== undefined &&
    value.succeeded !== undefined &&
    value.failed !== undefined &&
    value.succeeded + value.failed > value.attempted
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "successful and failed repairs exceed attempted repairs" });
  }
});

export const EpisodeSpecSchema = z.object({
  version: z.literal(QUALITY_EVIDENCE_VERSION),
  lane: z.object({
    key: z.string().min(1),
    renderer: z.string().min(1).optional(),
  }),
  topic: z.string().min(1),
  title: z.string().min(1).optional(),
  durationSec: z.number().finite().positive().optional(),
  story: StoryEvidenceSchema,
  candidateSelection: CandidateSelectionEvidenceSchema.optional(),
  repairs: RepairEvidenceSchema.optional(),
}).superRefine((value, ctx) => {
  const plan = value.story.plan;
  if (!plan) return;
  if (plan.contentLaneKey !== value.lane.key) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sealed plan content lane does not match episode lane" });
  }
  if (plan.topic !== value.topic) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sealed plan topic does not match episode topic" });
  }
});

export const QualityEvidenceSchema = z.object({
  version: z.literal(QUALITY_EVIDENCE_VERSION),
  episode: EpisodeSpecSchema,
  axes: z.object({
    technical: QualityAxisEvidenceSchema,
    visual: QualityAxisEvidenceSchema,
    temporal: QualityAxisEvidenceSchema,
    narrative: QualityAxisEvidenceSchema,
    audio: QualityAxisEvidenceSchema,
    brand: QualityAxisEvidenceSchema,
  }),
  release: z.object({
    /** Explicit supplied hard gates only; this must not be read as a quality grade. */
    hardGateReady: z.boolean(),
    /** False whenever any quality axis lacks a real evaluator result or rubric. */
    calibrationComplete: z.boolean(),
    blockers: z.array(z.string().min(1)),
  }),
  calibrationGaps: z.array(z.string().min(1)),
});

export type QualityAxisName = z.infer<typeof QualityAxisNameSchema>;
export type QualityAxisStatus = z.infer<typeof QualityAxisStatusSchema>;
export type QualityAxisEvidence = z.infer<typeof QualityAxisEvidenceSchema>;
export type StoryMeasurementScope = z.infer<typeof StoryMeasurementScopeSchema>;
export type StoryMeasurementKind = z.infer<typeof StoryMeasurementKindSchema>;
export type SelfContainedStoryPlanEvidence = z.infer<typeof SelfContainedStoryPlanEvidenceSchema>;
export type EpisodeSpec = z.infer<typeof EpisodeSpecSchema>;
export type QualityEvidence = z.infer<typeof QualityEvidenceSchema>;

/**
 * The publish-time decision for a complete editorial review. This is kept
 * separate from `release.hardGateReady`: raw receipts and inception probes may
 * truthfully be partial, while a production upload may not pretend a partial
 * receipt is a fully reviewed episode.
 */
export interface EditorialAcceptance {
  lane: string;
  requiredAxes: readonly QualityAxisName[];
  ready: boolean;
  blockers: string[];
}

interface EditorialLanePolicy {
  requiredAxes: readonly QualityAxisName[];
  /** The lane has an authored/source-backed story artifact that must survive to final QA. */
  requiresMeasuredStory?: boolean;
  /** Audio is the primary experience, so a loudness meter alone is insufficient. */
  requiresAestheticAudioScore?: boolean;
}

const NARRATIVE_EDITORIAL_AXES = [
  "technical",
  "visual",
  "temporal",
  "narrative",
  "audio",
  "brand",
] as const satisfies readonly QualityAxisName[];

const AMBIENT_EDITORIAL_AXES = [
  "technical",
  "visual",
  "temporal",
  "audio",
  "brand",
] as const satisfies readonly QualityAxisName[];

/**
 * A lane's production release contract. `legacy_unclassified` is deliberately
 * omitted: it has no known editorial grammar and therefore fails closed at
 * upload until it is migrated to a supported content lane.
 */
const EDITORIAL_PRODUCTION_POLICIES: Record<string, EditorialLanePolicy> = {
  narrated_documentary: {
    requiredAxes: NARRATIVE_EDITORIAL_AXES,
    requiresMeasuredStory: true,
    requiresAestheticAudioScore: true,
  },
  cinematic_ai: {
    requiredAxes: NARRATIVE_EDITORIAL_AXES,
    requiresMeasuredStory: true,
    requiresAestheticAudioScore: true,
  },
  short_form: {
    requiredAxes: NARRATIVE_EDITORIAL_AXES,
    requiresMeasuredStory: true,
    requiresAestheticAudioScore: true,
  },
  documentary_collage_short: {
    requiredAxes: NARRATIVE_EDITORIAL_AXES,
    requiresMeasuredStory: true,
    requiresAestheticAudioScore: true,
  },
  // The illustrated route produces the shared Story Spine/Episode Graph and
  // a narrated, scored final master through scene_compiler. It therefore has
  // the same full release evidence obligation as other narrated editorial
  // lanes; do not weaken this to an advisory or self-contained exception.
  illustrated_explainer: {
    requiredAxes: NARRATIVE_EDITORIAL_AXES,
    requiresMeasuredStory: true,
    requiresAestheticAudioScore: true,
  },
  // These engines hold their beat/panel plans internally rather than emitting
  // the shared EpisodeSpec story artifact. Their critic validation result is
  // therefore the real narrative evidence available to final QA; requiring a
  // nonexistent shared story receipt here would permanently deadlock them.
  whiteboard_explainer: {
    requiredAxes: NARRATIVE_EDITORIAL_AXES,
    requiresAestheticAudioScore: true,
  },
  motion_comic: {
    requiredAxes: NARRATIVE_EDITORIAL_AXES,
    requiresAestheticAudioScore: true,
  },
  lore_micro_doc: {
    requiredAxes: NARRATIVE_EDITORIAL_AXES,
    requiresAestheticAudioScore: true,
  },
  quiz_year: {
    requiredAxes: NARRATIVE_EDITORIAL_AXES,
    requiresAestheticAudioScore: true,
  },
  ambient_guided: {
    // Ambient can be a narration-led meditation or an intentionally wordless
    // soundscape. Do not manufacture a narrative/story requirement for the
    // latter; audio, timing, visuals, and channel identity are its measurable
    // editorial grammar.
    requiredAxes: AMBIENT_EDITORIAL_AXES,
    requiresAestheticAudioScore: true,
  },
  music_loop: {
    requiredAxes: AMBIENT_EDITORIAL_AXES,
    requiresAestheticAudioScore: true,
  },
};

/**
 * Catalog-level admission uses this before work starts. Runtime release
 * evaluation still uses `assessProductionEditorialAcceptance` below so legacy
 * or unknown receipts receive a structured fail-closed result rather than an
 * exception.
 */
export function hasProductionEditorialPolicy(lane: string): boolean {
  const policy = EDITORIAL_PRODUCTION_POLICIES[lane];
  return Boolean(policy && policy.requiredAxes.length > 0);
}

export interface QualityAxisInput {
  /** A direct evaluator verdict. It is not inferred from pipeline completion. */
  passed?: boolean;
  /** Scores are normalized onto a 0–10 scale before reaching this receipt. */
  score?: number;
  /** The evaluator's acceptance threshold on the same 0–10 scale. */
  minimumScore?: number;
  evaluator?: string;
  evidence?: readonly string[];
}

export interface EpisodeSpecInput {
  lane: {
    key: string;
    renderer?: string;
  };
  topic: string;
  title?: string;
  durationSec?: number;
  story?: {
    source?: string;
    beatCount?: number;
    shotCount?: number;
    coverageRatio?: number;
    measurementScope?: StoryMeasurementScope;
    measurementKind?: StoryMeasurementKind;
    finalMasterNarratedStoryReceiptFingerprint?: string;
    /** A sealed pre-render plan; callers cannot attach a final-master ratio to it. */
    plan?: SelfContainedStoryPlanEvidence;
  };
  candidateSelection?: {
    generated?: number;
    selected?: number;
    rejected?: number;
    evidence?: readonly string[];
  };
  repairs?: {
    attempted?: number;
    succeeded?: number;
    failed?: number;
    evidence?: readonly string[];
  };
}

export interface RequiredAudioPolicy {
  /** Set only for lanes such as music, where audio aesthetics are a release requirement. */
  required: boolean;
  minimumScore: number;
  label?: string;
}

export interface QualityEvidenceBuildInput {
  episode: EpisodeSpecInput;
  technical?: QualityAxisInput;
  visual?: QualityAxisInput;
  temporal?: QualityAxisInput;
  narrative?: QualityAxisInput;
  audio?: QualityAxisInput;
  brand?: QualityAxisInput;
  requiredAudio?: RequiredAudioPolicy;
}

interface NormalizedAxisInput {
  passed?: boolean;
  score?: number;
  minimumScore?: number;
  evaluator: string;
  evidence: string[];
  hadSupportingEvidence: boolean;
}

interface NormalizedEpisode {
  episode: EpisodeSpec;
  gaps: string[];
}

function appendGap(gaps: string[], gap: string): void {
  if (!gaps.includes(gap)) gaps.push(gap);
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function strings(values: readonly string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function score(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10
    ? value
    : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function ratio(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined;
}

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function formatScore(value: number): string {
  return value.toFixed(2);
}

function hasMeaningfulPassingEvidence(axis: QualityAxisName, evidence: QualityAxisEvidence): boolean {
  if (evidence.status !== "pass") return false;
  if (evidence.evaluator === "not-measured" || evidence.evaluator === "unspecified-evaluator") return false;
  return evidence.evidence.some((detail) => {
    const normalized = detail.trim();
    return normalized !== `No ${axis} evaluator evidence was supplied.` &&
      normalized !== "Evaluator result was supplied without supporting detail.";
  });
}

/**
 * Decide whether a receipt is adequate for a production upload.
 *
 * This intentionally does not alter `buildQualityEvidence()` or
 * `hardGateReady`: callers that create a probe or partial receipt can continue
 * to describe it honestly. Only the production QA and publishing boundary use
 * this stricter, lane-aware contract.
 */
export function assessProductionEditorialAcceptance(evidence: QualityEvidence): EditorialAcceptance {
  const lane = evidence.episode.lane.key;
  const policy = EDITORIAL_PRODUCTION_POLICIES[lane];
  if (!policy) {
    return {
      lane,
      requiredAxes: [],
      ready: false,
      blockers: [
        `content lane ${lane} has no production editorial acceptance policy; migrate legacy or unknown receipts before upload`,
      ],
    };
  }

  const blockers: string[] = [];
  if (!evidence.release.hardGateReady) {
    blockers.push(
      ...evidence.release.blockers.map((blocker) => `hard gate: ${blocker}`),
    );
  }
  for (const axis of policy.requiredAxes) {
    const axisEvidence = evidence.axes[axis];
    if (!hasMeaningfulPassingEvidence(axis, axisEvidence)) {
      blockers.push(
        `editorial ${axis} evidence must be a passing evaluator result with supporting detail (received ${axisEvidence.status})`,
      );
    }
  }

  if (policy.requiresAestheticAudioScore) {
    const audio = evidence.axes.audio;
    if (audio.score === undefined || audio.minimumScore === undefined) {
      blockers.push("audio-first lane requires a scored audio-aesthetics result with an acceptance threshold");
    }
  }

  if (policy.requiresMeasuredStory) {
    const story = evidence.episode.story;
    if (story.status !== "measured") {
      blockers.push("editorial story evidence was not measured");
    } else {
      if (!story.source) blockers.push("editorial story evidence is missing its source artifact");
      if (!story.beatCount || story.beatCount < 2) {
        blockers.push("editorial story evidence requires at least two measured beats");
      }
      if (!story.shotCount || story.shotCount < 1) {
        blockers.push("editorial story evidence requires at least one measured shot");
      }
      if (story.coverageRatio === undefined || story.coverageRatio < 0.95) {
        blockers.push("editorial story evidence requires at least 95% measured coverage");
      }
      // Only the shared Story Spine has this adapter today. Other automatic
      // families use distinct self-contained or Short-strategy evidence and
      // must not be deadlocked by a narration-semantic requirement they cannot
      // truthfully produce.
      const requiresFinalMasterNarratedStoryCoverage =
        story.source === VALIDATED_STORY_SPINE_SOURCE ||
        story.source === FINAL_MASTER_NARRATED_STORY_COVERAGE_SOURCE ||
        story.measurementKind === "narration_semantic";
      if (requiresFinalMasterNarratedStoryCoverage) {
        if (story.measurementScope !== "final_master") {
          blockers.push("Story-Spine story evidence must be measured against the final master before production release");
        }
        if (story.measurementKind !== "narration_semantic") {
          blockers.push("Story-Spine final-master coverage must declare narration-semantic measurement rather than plan-only coverage");
        }
        if (!story.finalMasterNarratedStoryReceiptFingerprint) {
          blockers.push("Story-Spine final-master coverage is missing its sealed narration-semantic receipt");
        }
      }
    }
  }

  return {
    lane,
    requiredAxes: policy.requiredAxes,
    ready: blockers.length === 0,
    blockers,
  };
}

function normalizeAxis(
  axis: QualityAxisName,
  input: QualityAxisInput | undefined,
  gaps: string[],
  fallbackMinimumScore?: number,
): NormalizedAxisInput {
  if (!input) {
    return {
      evaluator: "not-measured",
      evidence: [`No ${axis} evaluator evidence was supplied.`],
      hadSupportingEvidence: false,
    };
  }

  const evaluator = nonEmpty(input.evaluator) ?? "unspecified-evaluator";
  const evidence = strings(input.evidence);
  const normalizedScore = score(input.score);
  const inputMinimum = score(input.minimumScore);
  const normalizedMinimum = inputMinimum ?? fallbackMinimumScore;

  if (input.score !== undefined && normalizedScore === undefined) {
    appendGap(gaps, `${axis}: ignored an invalid score; expected a finite 0–10 value.`);
  }
  if (input.minimumScore !== undefined && inputMinimum === undefined) {
    appendGap(gaps, `${axis}: ignored an invalid minimum score; expected a finite 0–10 value.`);
  }

  if (!evidence.length && (input.passed !== undefined || normalizedScore !== undefined)) {
    appendGap(gaps, `${axis}: evaluator result has no supporting evidence detail.`);
    evidence.push("Evaluator result was supplied without supporting detail.");
  }
  if (!evidence.length && input.passed === undefined && normalizedScore === undefined) {
    return {
      evaluator,
      evidence: [`No ${axis} evaluator evidence was supplied.`],
      hadSupportingEvidence: false,
    };
  }

  return {
    passed: input.passed,
    score: normalizedScore,
    minimumScore: normalizedMinimum,
    evaluator,
    evidence,
    hadSupportingEvidence: true,
  };
}

function assessAxis(input: NormalizedAxisInput): QualityAxisEvidence {
  if (!input.hadSupportingEvidence) {
    return {
      status: "not_measured",
      evaluator: input.evaluator,
      evidence: input.evidence,
    };
  }

  const hasScoredThreshold = input.score !== undefined && input.minimumScore !== undefined;
  const failedThreshold = hasScoredThreshold && input.score! < input.minimumScore!;
  const passedThreshold = hasScoredThreshold && input.score! >= input.minimumScore!;
  const status: QualityAxisStatus = input.passed === false || failedThreshold
    ? "fail"
    : input.passed === true || passedThreshold
      ? "pass"
      : "advisory";

  return {
    status,
    evaluator: input.evaluator,
    evidence: input.evidence,
    ...(input.score === undefined ? {} : { score: input.score }),
    ...(input.minimumScore === undefined ? {} : { minimumScore: input.minimumScore }),
  };
}

function normalizeCandidateSelection(
  input: EpisodeSpecInput["candidateSelection"],
  gaps: string[],
): EpisodeSpec["candidateSelection"] | undefined {
  if (!input) return undefined;
  const generated = count(input.generated);
  let selected = count(input.selected);
  let rejected = count(input.rejected);
  const evidence = strings(input.evidence);

  for (const [label, raw, normalized] of [
    ["generated", input.generated, generated],
    ["selected", input.selected, selected],
    ["rejected", input.rejected, rejected],
  ] as const) {
    if (raw !== undefined && normalized === undefined) {
      appendGap(gaps, `candidate selection: ignored invalid ${label} count.`);
    }
  }
  if (generated !== undefined && selected !== undefined && selected > generated) {
    appendGap(gaps, "candidate selection: selected count exceeds generated count and was omitted.");
    selected = undefined;
  }
  if (generated !== undefined && rejected !== undefined && rejected > generated) {
    appendGap(gaps, "candidate selection: rejected count exceeds generated count and was omitted.");
    rejected = undefined;
  }
  if (
    generated !== undefined &&
    selected !== undefined &&
    rejected !== undefined &&
    selected + rejected > generated
  ) {
    appendGap(gaps, "candidate selection: rejected count conflicts with selected/generated counts and was omitted.");
    rejected = undefined;
  }

  if (generated === undefined && selected === undefined && rejected === undefined && !evidence.length) return undefined;
  return CandidateSelectionEvidenceSchema.parse({
    ...(generated === undefined ? {} : { generated }),
    ...(selected === undefined ? {} : { selected }),
    ...(rejected === undefined ? {} : { rejected }),
    ...(evidence.length ? { evidence } : {}),
  });
}

function normalizeRepairs(
  input: EpisodeSpecInput["repairs"],
  gaps: string[],
): EpisodeSpec["repairs"] | undefined {
  if (!input) return undefined;
  const attempted = count(input.attempted);
  let succeeded = count(input.succeeded);
  let failed = count(input.failed);
  const evidence = strings(input.evidence);

  for (const [label, raw, normalized] of [
    ["attempted", input.attempted, attempted],
    ["succeeded", input.succeeded, succeeded],
    ["failed", input.failed, failed],
  ] as const) {
    if (raw !== undefined && normalized === undefined) {
      appendGap(gaps, `repairs: ignored invalid ${label} count.`);
    }
  }
  if (attempted !== undefined && succeeded !== undefined && succeeded > attempted) {
    appendGap(gaps, "repairs: successful count exceeds attempted count and was omitted.");
    succeeded = undefined;
  }
  if (attempted !== undefined && failed !== undefined && failed > attempted) {
    appendGap(gaps, "repairs: failed count exceeds attempted count and was omitted.");
    failed = undefined;
  }
  if (
    attempted !== undefined &&
    succeeded !== undefined &&
    failed !== undefined &&
    succeeded + failed > attempted
  ) {
    appendGap(gaps, "repairs: failed count conflicts with successful/attempted counts and was omitted.");
    failed = undefined;
  }

  if (attempted === undefined && succeeded === undefined && failed === undefined && !evidence.length) return undefined;
  return RepairEvidenceSchema.parse({
    ...(attempted === undefined ? {} : { attempted }),
    ...(succeeded === undefined ? {} : { succeeded }),
    ...(failed === undefined ? {} : { failed }),
    ...(evidence.length ? { evidence } : {}),
  });
}

function normalizeEpisode(input: EpisodeSpecInput): NormalizedEpisode {
  const gaps: string[] = [];
  const story = input.story;
  const storyPlan = story?.plan === undefined
    ? undefined
    : SelfContainedStoryPlanEvidenceSchema.parse(story.plan);
  const beatCount = storyPlan ? storyPlan.counts.beatCount : count(story?.beatCount);
  const shotCount = storyPlan ? storyPlan.counts.shotCount : count(story?.shotCount);
  const coverageRatio = storyPlan ? undefined : ratio(story?.coverageRatio);
  const storySource = storyPlan ? "self-contained-story-receipt/v1" : nonEmpty(story?.source);
  const measurementScope = storyPlan ? "plan" as const : story?.measurementScope;
  const measurementKind = storyPlan ? undefined : story?.measurementKind;
  const finalMasterNarratedStoryReceiptFingerprint = storyPlan
    ? undefined
    : nonEmpty(story?.finalMasterNarratedStoryReceiptFingerprint);
  const hasStoryMeasurement = storyPlan !== undefined || beatCount !== undefined || shotCount !== undefined || coverageRatio !== undefined || measurementScope !== undefined || measurementKind !== undefined || finalMasterNarratedStoryReceiptFingerprint !== undefined;

  if (storyPlan) {
    if (story?.coverageRatio !== undefined) {
      throw new Error("pre-render self-contained plan evidence cannot claim final-master coverage");
    }
    if (story?.beatCount !== undefined && count(story.beatCount) !== storyPlan.counts.beatCount) {
      throw new Error("self-contained plan beat count conflicts with the sealed receipt");
    }
    if (story?.shotCount !== undefined && count(story.shotCount) !== storyPlan.counts.shotCount) {
      throw new Error("self-contained plan shot count conflicts with the sealed receipt");
    }
    if (story?.measurementScope !== undefined && story.measurementScope !== "plan") {
      throw new Error("pre-render self-contained plan evidence cannot claim final-master scope");
    }
    if (story?.measurementKind !== undefined || story?.finalMasterNarratedStoryReceiptFingerprint !== undefined) {
      throw new Error("pre-render self-contained plan evidence cannot carry a final-master narrated-story receipt");
    }
  }

  if (!storyPlan && story?.beatCount !== undefined && beatCount === undefined) {
    appendGap(gaps, "story: ignored invalid beat count.");
  }
  if (!storyPlan && story?.shotCount !== undefined && shotCount === undefined) {
    appendGap(gaps, "story: ignored invalid shot count.");
  }
  if (!storyPlan && story?.coverageRatio !== undefined && coverageRatio === undefined) {
    appendGap(gaps, "story: ignored invalid coverage ratio.");
  }

  const durationSec = positive(input.durationSec);
  if (input.durationSec !== undefined && durationSec === undefined) {
    appendGap(gaps, "episode: ignored invalid duration; expected a positive finite second count.");
  }
  const renderer = nonEmpty(input.lane.renderer);
  const title = nonEmpty(input.title);
  const candidateSelection = normalizeCandidateSelection(input.candidateSelection, gaps);
  const repairs = normalizeRepairs(input.repairs, gaps);

  const episode = EpisodeSpecSchema.parse({
    version: QUALITY_EVIDENCE_VERSION,
    lane: {
      key: input.lane.key.trim(),
      ...(renderer ? { renderer } : {}),
    },
    topic: input.topic.trim(),
    ...(title ? { title } : {}),
    ...(durationSec === undefined ? {} : { durationSec }),
    story: storyPlan
      ? {
          status: "measured",
          measurementScope: "plan",
          source: storySource,
          beatCount,
          shotCount,
          plan: storyPlan,
        }
      : {
          status: hasStoryMeasurement ? "measured" : "not_measured",
          ...(storySource ? { source: storySource } : {}),
          ...(beatCount === undefined ? {} : { beatCount }),
          ...(shotCount === undefined ? {} : { shotCount }),
          ...(coverageRatio === undefined ? {} : { coverageRatio }),
          ...(measurementScope === undefined ? {} : { measurementScope }),
          ...(measurementKind === undefined ? {} : { measurementKind }),
          ...(finalMasterNarratedStoryReceiptFingerprint === undefined
            ? {}
            : { finalMasterNarratedStoryReceiptFingerprint }),
        },
    ...(candidateSelection ? { candidateSelection } : {}),
    ...(repairs ? { repairs } : {}),
  });
  return { episode, gaps };
}

/** Build just the episode receipt when a caller needs it outside final QA. */
export function buildEpisodeSpec(input: EpisodeSpecInput): EpisodeSpec {
  return normalizeEpisode(input).episode;
}

/**
 * Creates a quality receipt without promoting missing information to a pass.
 * Hard release blockers intentionally come from only three explicit policies:
 * a failed technical verdict, a visual score below its supplied threshold, and
 * required audio without a qualifying score.
 */
export function buildQualityEvidence(input: QualityEvidenceBuildInput): QualityEvidence {
  const normalizedEpisode = normalizeEpisode(input.episode);
  const calibrationGaps = [...normalizedEpisode.gaps];
  const requiredAudioMinimum = input.requiredAudio?.required
    ? score(input.requiredAudio.minimumScore)
    : undefined;
  if (input.requiredAudio?.required && requiredAudioMinimum === undefined) {
    appendGap(calibrationGaps, "audio: required audio policy has no valid 0–10 acceptance threshold.");
  }

  const normalized = {
    technical: normalizeAxis("technical", input.technical, calibrationGaps),
    visual: normalizeAxis("visual", input.visual, calibrationGaps),
    temporal: normalizeAxis("temporal", input.temporal, calibrationGaps),
    narrative: normalizeAxis("narrative", input.narrative, calibrationGaps),
    audio: normalizeAxis("audio", input.audio, calibrationGaps, requiredAudioMinimum),
    brand: normalizeAxis("brand", input.brand, calibrationGaps),
  };
  const axes = {
    technical: assessAxis(normalized.technical),
    visual: assessAxis(normalized.visual),
    temporal: assessAxis(normalized.temporal),
    narrative: assessAxis(normalized.narrative),
    audio: assessAxis(normalized.audio),
    brand: assessAxis(normalized.brand),
  };

  for (const axis of QualityAxisNameSchema.options) {
    const normalizedAxis = normalized[axis];
    if (!normalizedAxis.hadSupportingEvidence) {
      appendGap(calibrationGaps, `${axis}: no evaluator evidence was supplied.`);
    }
    if (normalizedAxis.score !== undefined && normalizedAxis.minimumScore === undefined) {
      appendGap(calibrationGaps, `${axis}: score is present but no acceptance threshold was supplied.`);
    }
  }
  if (normalizedEpisode.episode.story.status === "not_measured") {
    appendGap(calibrationGaps, "story: no beat, shot, or coverage measurement was supplied.");
  }

  const blockers: string[] = [];
  if (normalized.technical.passed === false) {
    blockers.push("technical evaluator explicitly failed");
  }
  if (
    normalized.visual.score !== undefined &&
    normalized.visual.minimumScore !== undefined &&
    normalized.visual.score < normalized.visual.minimumScore
  ) {
    blockers.push(
      `visual score ${formatScore(normalized.visual.score)} is below required threshold ${formatScore(normalized.visual.minimumScore)}`,
    );
  }
  if (input.requiredAudio?.required && requiredAudioMinimum !== undefined) {
    const label = nonEmpty(input.requiredAudio.label) ?? "audio";
    if (normalized.audio.score === undefined) {
      blockers.push(`${label} score is missing for a lane that requires audio quality`);
    } else if (normalized.audio.score < requiredAudioMinimum) {
      blockers.push(
        `${label} score ${formatScore(normalized.audio.score)} is below required threshold ${formatScore(requiredAudioMinimum)}`,
      );
    }
  }

  return QualityEvidenceSchema.parse({
    version: QUALITY_EVIDENCE_VERSION,
    episode: normalizedEpisode.episode,
    axes,
    release: {
      hardGateReady: blockers.length === 0,
      calibrationComplete: calibrationGaps.length === 0,
      blockers,
    },
    calibrationGaps,
  });
}
