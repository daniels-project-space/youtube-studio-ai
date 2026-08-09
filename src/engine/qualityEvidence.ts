import { z } from "zod";

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
export type EpisodeSpec = z.infer<typeof EpisodeSpecSchema>;
export type QualityEvidence = z.infer<typeof QualityEvidenceSchema>;

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
  const beatCount = count(story?.beatCount);
  const shotCount = count(story?.shotCount);
  const coverageRatio = ratio(story?.coverageRatio);
  const storySource = nonEmpty(story?.source);
  const hasStoryMeasurement = beatCount !== undefined || shotCount !== undefined || coverageRatio !== undefined;

  if (story?.beatCount !== undefined && beatCount === undefined) {
    appendGap(gaps, "story: ignored invalid beat count.");
  }
  if (story?.shotCount !== undefined && shotCount === undefined) {
    appendGap(gaps, "story: ignored invalid shot count.");
  }
  if (story?.coverageRatio !== undefined && coverageRatio === undefined) {
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
    story: {
      status: hasStoryMeasurement ? "measured" : "not_measured",
      ...(storySource ? { source: storySource } : {}),
      ...(beatCount === undefined ? {} : { beatCount }),
      ...(shotCount === undefined ? {} : { shotCount }),
      ...(coverageRatio === undefined ? {} : { coverageRatio }),
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
