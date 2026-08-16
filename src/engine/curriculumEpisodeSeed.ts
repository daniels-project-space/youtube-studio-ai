import { createHash } from "node:crypto";

import { z } from "zod";

import { ContentLaneSchema } from "./contentLane";

/**
 * Provider-free, child-editor-bound episode intent for the supervised children
 * lane. It deliberately precedes Story Spine / Episode Graph planning: a
 * planner may elaborate this signed intent, but may not substitute a new age
 * band, objective, vocabulary/action set, assessment, world, or cast.
 */
export const CURRICULUM_EPISODE_SEED_VERSION = "curriculum-episode-seed/v1" as const;
export const CURRICULUM_EPISODE_SEED_ADMISSION_VERSION =
  "curriculum-episode-seed-admission/v1" as const;
export const CURRICULUM_EPISODE_SEED_INPUT_SEED_KEY = "curriculumEpisodeSeedInput" as const;
export const CHILD_EDITORIAL_SEED_REVIEW_MAX_AGE_DAYS = 30;

const CHILD_EDITORIAL_SEED_REVIEW_MAX_AGE_MS =
  CHILD_EDITORIAL_SEED_REVIEW_MAX_AGE_DAYS * 24 * 60 * 60 * 1_000;
const FUTURE_REVIEW_CLOCK_SKEW_MS = 5 * 60 * 1_000;

const identifier = (prefix: string) => z.string().regex(
  new RegExp(`^${prefix}-[a-z0-9][a-z0-9-]{1,119}$`),
  `expected ${prefix}- prefixed identifier`,
);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/, "expected sha256 fingerprint");
const text = (maximum: number, minimum = 1) => z.string().trim().min(minimum).max(maximum);

export const CurriculumEpisodeAgeBandSchema = z.object({
  label: z.enum(["toddler", "preschool", "early_primary"]),
  minimumYears: z.number().int().min(2).max(8),
  maximumYears: z.number().int().min(2).max(8),
}).strict().superRefine((value, context) => {
  if (value.maximumYears < value.minimumYears) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["maximumYears"], message: "maximumYears must be greater than or equal to minimumYears" });
  }
  if (value.maximumYears - value.minimumYears > 3) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["maximumYears"], message: "age band must span no more than three years" });
  }
});

export const CurriculumEpisodeAssessmentSchema = z.object({
  responseMode: z.enum(["say", "point", "sort", "choose", "demonstrate"]),
  requiredCorrectResponses: z.number().int().min(1).max(3),
  prompt: text(240, 8),
}).strict();

export const CurriculumEpisodeObjectiveSchema = z.object({
  id: identifier("objective"),
  statement: text(240, 8),
  observableAction: text(240, 8),
}).strict();

export const CurriculumVocabularyActionSchema = z.object({
  term: text(80, 2),
  childFriendlyMeaning: text(240, 8),
  requiredAction: text(240, 8),
}).strict();

const CurriculumWorldSchema = z.object({
  settingId: identifier("setting"),
  displayName: text(120, 2),
  continuityLock: text(600, 8),
  originalIdentity: text(600, 8),
}).strict();

const CurriculumRecurringCharacterSchema = z.object({
  characterId: identifier("character"),
  displayName: text(80, 2),
  continuityLock: text(600, 8),
  role: z.enum(["guide", "learner", "helper"]),
  plannedEpisodeMinimum: z.number().int().min(3).max(500),
  originalIdentity: text(600, 8),
}).strict();

const CurriculumOriginalityDeclarationSchema = z.object({
  createdForThisSeries: z.literal(true),
  noBorrowedOrIpAdjacentIdentity: z.literal(true),
  differentiation: text(600, 8),
}).strict();

export const CurriculumEpisodeIdentitySchema = z.object({
  seriesTitle: text(120, 2),
  world: CurriculumWorldSchema,
  recurringCharacters: z.array(CurriculumRecurringCharacterSchema).min(1).max(12),
  originalityDeclaration: CurriculumOriginalityDeclarationSchema,
}).strict();

export const CurriculumEpisodeEditorialReviewSchema = z.object({
  id: identifier("child-editor-review"),
  decision: z.literal("approved"),
  reviewerId: identifier("child-editor"),
  reviewedAt: z.string().datetime({ offset: true }),
  reviewedCurriculumEpisodeSeedFingerprint: sha256,
  ageBandConfirmed: z.literal(true),
  measurableObjectiveConfirmed: z.literal(true),
  vocabularyAndActionsConfirmed: z.literal(true),
  assessmentConfirmed: z.literal(true),
  originalIdentityConfirmed: z.literal(true),
}).strict();

const CurriculumEpisodeSeedBaseSchema = z.object({
  version: z.literal(CURRICULUM_EPISODE_SEED_VERSION),
  seriesId: identifier("series"),
  episodeId: identifier("episode"),
  /** Exact topic the signed child-editor brief allows planners to elaborate. */
  episodeTopic: text(240, 2),
  ageBand: CurriculumEpisodeAgeBandSchema,
  measurableObjective: CurriculumEpisodeObjectiveSchema,
  vocabularyAndActions: z.array(CurriculumVocabularyActionSchema).min(1).max(12),
  assessment: CurriculumEpisodeAssessmentSchema,
  identity: CurriculumEpisodeIdentitySchema,
  editorialReview: CurriculumEpisodeEditorialReviewSchema,
}).strict();

function validateUniqueSeedIdentity(
  value: z.infer<typeof CurriculumEpisodeSeedBaseSchema>,
  context: z.RefinementCtx,
): void {
  const seenTerms = new Set<string>();
  for (const item of value.vocabularyAndActions) {
    const key = item.term.toLocaleLowerCase();
    if (seenTerms.has(key)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["vocabularyAndActions"], message: "vocabulary terms must be unique" });
      break;
    }
    seenTerms.add(key);
  }
  const characters = new Set<string>();
  for (const character of value.identity.recurringCharacters) {
    if (characters.has(character.characterId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["identity", "recurringCharacters"], message: "recurring character ids must be unique" });
      break;
    }
    characters.add(character.characterId);
  }
}

export const CurriculumEpisodeSeedInputSchema = CurriculumEpisodeSeedBaseSchema
  .superRefine(validateUniqueSeedIdentity);

export const CurriculumEpisodeSeedContentSchema = CurriculumEpisodeSeedBaseSchema
  .omit({ editorialReview: true })
  .strict();

export const CurriculumEpisodeSeedSchema = CurriculumEpisodeSeedBaseSchema.extend({
  contentFingerprint: sha256,
  release: z.literal("private_human_child_editor_review_only"),
  allowedPublishMode: z.literal("draft"),
}).strict().superRefine(validateUniqueSeedIdentity);

export const CurriculumEpisodeSeedApprovalReceiptSchema = z.object({
  version: z.literal(CURRICULUM_EPISODE_SEED_ADMISSION_VERSION),
  seriesId: identifier("series"),
  episodeId: identifier("episode"),
  curriculumEpisodeSeedFingerprint: sha256,
  editorialReview: CurriculumEpisodeEditorialReviewSchema,
  release: z.literal("private_human_child_editor_review_only"),
  allowedPublishMode: z.literal("draft"),
  requiresHumanChildEditor: z.literal(true),
}).strict();

export type CurriculumEpisodeSeedInput = z.infer<typeof CurriculumEpisodeSeedInputSchema>;
export type CurriculumEpisodeSeed = z.infer<typeof CurriculumEpisodeSeedSchema>;
export type CurriculumEpisodeSeedApprovalReceipt = z.infer<typeof CurriculumEpisodeSeedApprovalReceiptSchema>;

export interface CurriculumEpisodeSeedIssue {
  code:
    | "seed_schema_invalid"
    | "children_lane_required"
    | "editorial_review_fingerprint_mismatch"
    | "editorial_review_stale"
    | "story_topic_mismatch"
    | "show_bible_mismatch";
  message: string;
  remediation: string;
}

export interface CurriculumEpisodeSeedAdmissionReport {
  safe: boolean;
  issues: CurriculumEpisodeSeedIssue[];
}

export interface AdmittedCurriculumEpisodeSeed {
  input: CurriculumEpisodeSeedInput;
  seed: CurriculumEpisodeSeed;
  receipt: CurriculumEpisodeSeedApprovalReceipt;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** Stable target for the child editor’s review signature. */
export function curriculumEpisodeSeedContentFingerprint(
  value: Omit<CurriculumEpisodeSeedInput, "editorialReview"> | CurriculumEpisodeSeedInput,
): string {
  const content = CurriculumEpisodeSeedContentSchema.parse({
    version: value.version,
    seriesId: value.seriesId,
    episodeId: value.episodeId,
    episodeTopic: value.episodeTopic,
    ageBand: value.ageBand,
    measurableObjective: value.measurableObjective,
    vocabularyAndActions: value.vocabularyAndActions,
    assessment: value.assessment,
    identity: value.identity,
  });
  return fingerprint({
    ...content,
    vocabularyAndActions: [...content.vocabularyAndActions].sort((left, right) =>
      left.term.localeCompare(right.term),
    ),
    identity: {
      ...content.identity,
      recurringCharacters: [...content.identity.recurringCharacters].sort((left, right) =>
        left.characterId.localeCompare(right.characterId),
      ),
    },
  });
}

function issue(
  code: CurriculumEpisodeSeedIssue["code"],
  message: string,
  remediation: string,
): CurriculumEpisodeSeedIssue {
  return { code, message, remediation };
}

function parseReviewedAt(value: string): Date | undefined {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

/** Required external invocation seeds for the supervised children lane. */
export function curriculumEpisodeSeedKeys(contentLane: unknown): string[] {
  const lane = ContentLaneSchema.safeParse(contentLane);
  return lane.success && lane.data.key === "children_learning_supervised"
    ? [CURRICULUM_EPISODE_SEED_INPUT_SEED_KEY]
    : [];
}

/** Fail before planning/provider preflight when the reviewer packet is absent. */
export function assertCurriculumEpisodeSeeded(
  contentLane: unknown,
  store: Record<string, unknown>,
): void {
  if (
    curriculumEpisodeSeedKeys(contentLane).length > 0 &&
    !Object.prototype.hasOwnProperty.call(store, CURRICULUM_EPISODE_SEED_INPUT_SEED_KEY)
  ) {
    throw new Error(
      "children_learning_supervised requires an operator-supplied child-editor-approved curriculumEpisodeSeedInput before Story Spine or Episode Graph planning",
    );
  }
}

/** Evaluates a reviewer-signed episode intent without provider calls or side effects. */
export function evaluateCurriculumEpisodeSeed(
  args: { input: unknown; contentLane: unknown },
  options: { now?: Date } = {},
): CurriculumEpisodeSeedAdmissionReport {
  const parsed = CurriculumEpisodeSeedInputSchema.safeParse(args.input);
  if (!parsed.success) {
    return {
      safe: false,
      issues: [issue(
        "seed_schema_invalid",
        "The curriculum episode seed must bind one age-banded objective, vocabulary/actions, assessment prompt, and original recurring identity.",
        "Supply a complete, child-editor-ready CurriculumEpisodeSeed input before planning.",
      )],
    };
  }
  const input = parsed.data;
  const issues: CurriculumEpisodeSeedIssue[] = [];
  const lane = ContentLaneSchema.safeParse(args.contentLane);
  if (!lane.success || lane.data.key !== "children_learning_supervised" || lane.data.family !== "children_learning") {
    issues.push(issue(
      "children_lane_required",
      "The CurriculumEpisodeSeed can only be used in the supervised children-learning lane.",
      "Use contentLane children_learning_supervised; this module never opens public or scheduled production.",
    ));
  }
  const contentFingerprint = curriculumEpisodeSeedContentFingerprint(input);
  if (input.editorialReview.reviewedCurriculumEpisodeSeedFingerprint !== contentFingerprint) {
    issues.push(issue(
      "editorial_review_fingerprint_mismatch",
      "The child-editor approval was not issued for this exact curriculum episode seed.",
      "Obtain a fresh child-editor approval after any topic, age, objective, vocabulary, assessment, world, or cast change.",
    ));
  }
  const now = options.now ?? new Date();
  const reviewedAt = parseReviewedAt(input.editorialReview.reviewedAt);
  if (
    !reviewedAt ||
    reviewedAt.getTime() > now.getTime() + FUTURE_REVIEW_CLOCK_SKEW_MS ||
    now.getTime() - reviewedAt.getTime() > CHILD_EDITORIAL_SEED_REVIEW_MAX_AGE_MS
  ) {
    issues.push(issue(
      "editorial_review_stale",
      `Child-editor seed approval must be valid, non-future, and no older than ${CHILD_EDITORIAL_SEED_REVIEW_MAX_AGE_DAYS} days.`,
      "Obtain a fresh child-editor approval before planning the episode.",
    ));
  }
  return { safe: issues.length === 0, issues };
}

/** Throws a remediation-rich error and emits a private-review-only handoff. */
export function assertCurriculumEpisodeSeed(
  args: { input: unknown; contentLane: unknown },
  options: { now?: Date } = {},
): AdmittedCurriculumEpisodeSeed {
  const report = evaluateCurriculumEpisodeSeed(args, options);
  if (!report.safe) {
    throw new Error(
      `curriculum episode seed admission blocked: ${report.issues
        .map((entry) => `${entry.code}: ${entry.message} Remediation: ${entry.remediation}`)
        .join(" | ")}`,
    );
  }
  const input = CurriculumEpisodeSeedInputSchema.parse(args.input);
  const contentFingerprint = curriculumEpisodeSeedContentFingerprint(input);
  const seed = CurriculumEpisodeSeedSchema.parse({
    ...input,
    contentFingerprint,
    release: "private_human_child_editor_review_only",
    allowedPublishMode: "draft",
  });
  const receipt = CurriculumEpisodeSeedApprovalReceiptSchema.parse({
    version: CURRICULUM_EPISODE_SEED_ADMISSION_VERSION,
    seriesId: input.seriesId,
    episodeId: input.episodeId,
    curriculumEpisodeSeedFingerprint: contentFingerprint,
    editorialReview: input.editorialReview,
    release: "private_human_child_editor_review_only",
    allowedPublishMode: "draft",
    requiresHumanChildEditor: true,
  });
  return { input, seed, receipt };
}

function assertAdmittedSeed(
  seedValue: unknown,
  approvalValue: unknown,
): { seed: CurriculumEpisodeSeed; approval: CurriculumEpisodeSeedApprovalReceipt } {
  const seed = CurriculumEpisodeSeedSchema.parse(seedValue);
  const approval = CurriculumEpisodeSeedApprovalReceiptSchema.parse(approvalValue);
  if (
    approval.curriculumEpisodeSeedFingerprint !== seed.contentFingerprint ||
    approval.seriesId !== seed.seriesId ||
    approval.episodeId !== seed.episodeId ||
    approval.editorialReview.reviewedCurriculumEpisodeSeedFingerprint !== seed.contentFingerprint ||
    approval.release !== "private_human_child_editor_review_only" ||
    approval.allowedPublishMode !== "draft" ||
    approval.requiresHumanChildEditor !== true
  ) {
    throw new Error("curriculum_episode_seed: child-editor approval is not bound to this exact private episode seed");
  }
  return { seed, approval };
}

/**
 * Runtime precondition for the generic Story Spine. Kept separate from its
 * block consumes list so general/non-children lanes retain their lean graph.
 */
export function assertCurriculumEpisodeSeedForStoryInput(args: {
  curriculumEpisodeSeed: unknown;
  curriculumEpisodeSeedApproval: unknown;
  contentLane: unknown;
  topic: unknown;
}): CurriculumEpisodeSeed {
  const { seed } = assertAdmittedSeed(args.curriculumEpisodeSeed, args.curriculumEpisodeSeedApproval);
  const lane = ContentLaneSchema.parse(args.contentLane);
  if (lane.key !== "children_learning_supervised" || lane.family !== "children_learning") {
    throw new Error("curriculum_episode_seed: supervised children-learning lane is required before Story Spine planning");
  }
  if (String(args.topic).trim() !== seed.episodeTopic) {
    throw new Error("curriculum_episode_seed: selected topic does not match the child-editor-approved episode topic");
  }
  return seed;
}

/**
 * Binds the earlier review packet to the existing Show Bible contract without
 * importing that module (avoids a circular runtime dependency).
 */
export function assertCurriculumEpisodeSeedMatchesShowBible(args: {
  curriculumEpisodeSeed: unknown;
  curriculumEpisodeSeedApproval: unknown;
  showBibleInput: unknown;
}): CurriculumEpisodeSeed {
  const { seed } = assertAdmittedSeed(args.curriculumEpisodeSeed, args.curriculumEpisodeSeedApproval);
  const showBible = args.showBibleInput as {
    seriesId?: unknown;
    ageBand?: unknown;
    learningObjective?: { statement?: unknown; observableAction?: unknown; assessment?: unknown };
    identity?: {
      seriesTitle?: unknown;
      world?: { settingId?: unknown; displayName?: unknown; continuityLock?: unknown; originalIdentity?: unknown };
      recurringCharacters?: Array<{ characterId?: unknown; displayName?: unknown; continuityLock?: unknown; role?: unknown; plannedEpisodeMinimum?: unknown; originalIdentity?: unknown }>;
    };
  } | undefined;
  const equal = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
  const showBibleCharacters = showBible?.identity?.recurringCharacters;
  const sameCharacters = Array.isArray(showBibleCharacters) &&
    equal(
      [...showBibleCharacters].sort((left, right) => String(left.characterId).localeCompare(String(right.characterId))),
      [...seed.identity.recurringCharacters].sort((left, right) => left.characterId.localeCompare(right.characterId)),
    );
  if (
    showBible?.seriesId !== seed.seriesId ||
    !equal(showBible?.ageBand, seed.ageBand) ||
    showBible?.learningObjective?.statement !== seed.measurableObjective.statement ||
    showBible?.learningObjective?.observableAction !== seed.measurableObjective.observableAction ||
    !equal(showBible?.learningObjective?.assessment, seed.assessment) ||
    showBible?.identity?.seriesTitle !== seed.identity.seriesTitle ||
    !equal(showBible?.identity?.world, seed.identity.world) ||
    !sameCharacters
  ) {
    throw new Error(
      "curriculum_episode_seed: Show Bible does not match the child-editor-approved age band, objective, assessment, original world, or recurring characters",
    );
  }
  return seed;
}
