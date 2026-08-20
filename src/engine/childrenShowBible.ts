import { createHash } from "node:crypto";

import { z } from "zod";

import {
  assertEpisodeGraph,
  assertSceneManifestMatchesEpisodeGraph,
  episodeGraphFingerprint,
  type EpisodeGraph,
} from "./episodeGraph";
import { assertLearningContract, type LearningContract } from "./learningContract";
import { ContentLaneSchema } from "./contentLane";
import {
  assertCurriculumEpisodeSeedMatchesShowBible,
  assertCurriculumEpisodeSeeded,
  curriculumEpisodeSeedKeys,
} from "./curriculumEpisodeSeed";

/**
 * Provider-free admission for an original, supervised children’s show.
 *
 * This is deliberately a reusable episode-format contract, rather than a
 * generator or a child-channel family switch. An operator supplies the show
 * bible and a real child-editor review. The module then proves that the
 * episode graph, learning contract, recurring original identity, and five-part
 * participation pattern are all still the exact material the editor approved.
 */
export const CHILDREN_SHOW_BIBLE_VERSION = "children-show-bible/v1" as const;
export const CHILDREN_SHOW_BIBLE_ADMISSION_VERSION = "children-show-bible-admission/v1" as const;
/**
 * Per-episode editorial material is deliberately an invocation seed, not a
 * channel-default parameter. It must be supplied anew and is frozen into the
 * durable run before the supervised lane can do any paid work.
 */
export const CHILDREN_SHOW_BIBLE_INPUT_SEED_KEY = "childrenShowBibleInput" as const;
export const CHILD_EDITORIAL_REVIEW_MAX_AGE_DAYS = 30;
const CHILD_EDITORIAL_REVIEW_MAX_AGE_MS =
  CHILD_EDITORIAL_REVIEW_MAX_AGE_DAYS * 24 * 60 * 60 * 1_000;
const FUTURE_REVIEW_CLOCK_SKEW_MS = 5 * 60 * 1_000;

const identifier = (prefix: string) =>
  z.string().regex(
    new RegExp(`^${prefix}-[a-z0-9][a-z0-9-]{1,119}$`),
    `expected ${prefix}- prefixed identifier`,
  );
const sha256 = z.string().regex(/^[a-f0-9]{64}$/, "expected sha256 fingerprint");
const text = (maximum: number) => z.string().trim().min(1).max(maximum);

export const ChildAgeBandSchema = z
  .object({
    label: z.enum(["toddler", "preschool", "early_primary"]),
    minimumYears: z.number().int().min(2).max(8),
    maximumYears: z.number().int().min(2).max(8),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.maximumYears < value.minimumYears) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "maximumYears must be greater than or equal to minimumYears",
        path: ["maximumYears"],
      });
    }
    if (value.maximumYears - value.minimumYears > 3) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "age band must span no more than three years",
        path: ["maximumYears"],
      });
    }
  });

const ChildrenAssessmentSchema = z
  .object({
    responseMode: z.enum(["say", "point", "sort", "choose", "demonstrate"]),
    requiredCorrectResponses: z.number().int().min(1).max(3),
    prompt: text(240),
  })
  .strict();

export const ChildrenShowLearningObjectiveSchema = z
  .object({
    id: identifier("objective"),
    /** Must exactly match the one objective carried by the active lesson contract. */
    statement: text(240),
    observableAction: text(240),
    assessment: ChildrenAssessmentSchema,
  })
  .strict();

const ChildrenShowWorldSchema = z
  .object({
    settingId: identifier("setting"),
    displayName: text(120),
    continuityLock: text(600),
    /** What is original about this world, in the operator’s own words. */
    originalIdentity: text(600),
  })
  .strict();

const RecurringCharacterSchema = z
  .object({
    characterId: identifier("character"),
    displayName: text(80),
    continuityLock: text(600),
    role: z.enum(["guide", "learner", "helper"]),
    /** A declared show-format commitment, reviewed by a human editor. */
    plannedEpisodeMinimum: z.number().int().min(3).max(500),
    /** What makes the character distinct from a borrowed character identity. */
    originalIdentity: text(600),
  })
  .strict();

const OriginalityDeclarationSchema = z
  .object({
    createdForThisSeries: z.literal(true),
    noBorrowedOrIpAdjacentIdentity: z.literal(true),
    differentiation: text(600),
  })
  .strict();

const ChildrenShowIdentitySchema = z
  .object({
    seriesTitle: text(120),
    world: ChildrenShowWorldSchema,
    recurringCharacters: z.array(RecurringCharacterSchema).min(1).max(12),
    originalityDeclaration: OriginalityDeclarationSchema,
  })
  .strict();

export const ChildrenStoryPatternKindSchema = z.enum([
  "familiar_problem",
  "guided_attempt",
  "varied_repetition",
  "participation",
  "resolution_recall",
]);

export const ChildrenStoryPatternStepSchema = z
  .object({
    kind: ChildrenStoryPatternKindSchema,
    summary: text(400),
    /** Explicit graph-beat handoff keeps the story pattern visible to renderers. */
    episodeBeatIds: z.array(identifier("beat")).min(1).max(80),
    participationPrompt: text(240).optional(),
    recallPrompt: text(240).optional(),
    /** Varied repetition must change at least two of these dimensions. */
    variationDimensions: z.array(z.enum(["object", "context", "cue", "action"])).min(1).max(4).optional(),
  })
  .strict();

/** A real human approval, not a mutable boolean on a channel. */
export const ChildrenEditorialReviewSchema = z
  .object({
    id: identifier("child-editor-review"),
    decision: z.literal("approved"),
    reviewerId: identifier("child-editor"),
    reviewedAt: z.string().datetime({ offset: true }),
    reviewedShowBibleFingerprint: sha256,
    reviewedEpisodeGraphFingerprint: sha256,
    reviewedLessonContractFingerprint: sha256,
    ageBandConfirmed: z.literal(true),
    learningObjectiveConfirmed: z.literal(true),
    originalIdentityConfirmed: z.literal(true),
    storyPatternConfirmed: z.literal(true),
  })
  .strict();

export const ChildrenShowBibleInputSchema = z
  .object({
    version: z.literal(CHILDREN_SHOW_BIBLE_VERSION),
    seriesId: identifier("series"),
    ageBand: ChildAgeBandSchema,
    learningObjective: ChildrenShowLearningObjectiveSchema,
    identity: ChildrenShowIdentitySchema,
    /** The five-stage pattern is fixed so a channel cannot silently skip participation. */
    storyPattern: z.array(ChildrenStoryPatternStepSchema).length(5),
    editorialReview: ChildrenEditorialReviewSchema,
  })
  .strict();

/** The editorial review is excluded from the thing the editor signs. */
export const ChildrenShowBibleContentSchema = ChildrenShowBibleInputSchema
  .omit({ editorialReview: true })
  .strict();

export const ChildrenShowBibleSchema = ChildrenShowBibleInputSchema
  .extend({
    contentFingerprint: sha256,
    episodeGraphFingerprint: sha256,
    lessonContractFingerprint: sha256,
    release: z.literal("private_human_child_editor_review_only"),
    allowedPublishMode: z.literal("draft"),
  })
  .strict();

export const ChildrenShowBibleApprovalReceiptSchema = z
  .object({
    version: z.literal(CHILDREN_SHOW_BIBLE_ADMISSION_VERSION),
    seriesId: identifier("series"),
    showBibleFingerprint: sha256,
    episodeGraphFingerprint: sha256,
    lessonContractFingerprint: sha256,
    ageBand: ChildAgeBandSchema,
    editorialReview: ChildrenEditorialReviewSchema,
    release: z.literal("private_human_child_editor_review_only"),
    allowedPublishMode: z.literal("draft"),
    requiresHumanChildEditor: z.literal(true),
  })
  .strict();

export type ChildrenShowBibleInput = z.infer<typeof ChildrenShowBibleInputSchema>;
export type ChildrenShowBible = z.infer<typeof ChildrenShowBibleSchema>;
export type ChildrenShowBibleApprovalReceipt = z.infer<typeof ChildrenShowBibleApprovalReceiptSchema>;
export type ChildrenStoryPatternKind = z.infer<typeof ChildrenStoryPatternKindSchema>;
export type ChildrenStoryPatternStep = z.infer<typeof ChildrenStoryPatternStepSchema>;

type ChildrenLearningExperienceBible = Pick<
  ChildrenShowBibleInput,
  "identity" | "learningObjective" | "storyPattern"
>;

type ChildrenLearningMoment = {
  beatId: string;
  text: string;
  characterIds: readonly string[];
  settingId?: string;
};

function normalizedPrompt(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function assertPromptAppearsInStage(args: {
  stage: ChildrenStoryPatternStep;
  prompt: string | undefined;
  label: "participation" | "resolution/recall";
  guideIds: ReadonlySet<string>;
  moments: readonly ChildrenLearningMoment[];
  surface: "Episode Graph" | "Scene Manifest";
}): void {
  const prompt = args.prompt ? normalizedPrompt(args.prompt) : "";
  if (!prompt) {
    throw new Error(`children_learning_experience: ${args.label} has no declared prompt`);
  }
  const stageMoments = args.moments.filter((moment) => args.stage.episodeBeatIds.includes(moment.beatId));
  if (!stageMoments.length) {
    throw new Error(
      `children_learning_experience: ${args.label} has no ${args.surface} moment for its approved story-stage beats`,
    );
  }
  const promptedMoments = stageMoments.filter((moment) => normalizedPrompt(moment.text).includes(prompt));
  if (!promptedMoments.length) {
    throw new Error(
      `children_learning_experience: ${args.label} must say its exact approved prompt in timed ${args.surface} text`,
    );
  }
  if (!promptedMoments.some((moment) => moment.characterIds.some((id) => args.guideIds.has(id)))) {
    const article = args.surface === "Episode Graph" ? "an" : "a";
    throw new Error(
      `children_learning_experience: ${args.label} prompt must be delivered in ${article} ${args.surface} moment containing a declared original guide`,
    );
  }
}

/**
 * Proves that a supervised children episode contains the approved invitation
 * and retrieval cue in its actual timed presentation—not solely in the Show
 * Bible metadata—and that its original guide/world still reach that plan.
 *
 * It is intentionally provider-free and can run both when the Show Bible is
 * admitted (Graph) and at the final child-safety boundary (Scene Manifest).
 */
export function assertChildrenLearningExperience(args: {
  showBible: ChildrenLearningExperienceBible;
  episodeGraph: unknown;
  lessonContract: unknown;
  sceneManifest?: unknown;
}): void {
  const graph = assertEpisodeGraph(args.episodeGraph);
  const lessonContract = assertLearningContract(args.lessonContract, graph);
  const charactersById = new Map(graph.characters.map((character) => [character.id, character]));
  const settingsById = new Map(graph.settings.map((setting) => [setting.id, setting]));

  const world = settingsById.get(args.showBible.identity.world.settingId);
  if (
    !world ||
    world.displayName !== args.showBible.identity.world.displayName ||
    world.continuityLock !== args.showBible.identity.world.continuityLock
  ) {
    throw new Error("children_learning_experience: original world does not match the active Episode Graph catalog");
  }
  for (const character of args.showBible.identity.recurringCharacters) {
    const active = charactersById.get(character.characterId);
    if (
      !active ||
      active.displayName !== character.displayName ||
      active.continuityLock !== character.continuityLock
    ) {
      throw new Error(
        `children_learning_experience: original recurring character ${character.characterId} does not match the active Episode Graph catalog`,
      );
    }
  }

  const guideIds = new Set(
    args.showBible.identity.recurringCharacters
      .filter((character) => character.role === "guide")
      .map((character) => character.characterId),
  );
  if (!guideIds.size) {
    throw new Error("children_learning_experience: no declared original guide character is available for the learning moments");
  }

  const graphMoments: ChildrenLearningMoment[] = graph.beats.map((beat) => ({
    beatId: beat.id,
    text: beat.text,
    characterIds: beat.characterIds,
    ...(beat.settingId ? { settingId: beat.settingId } : {}),
  }));
  const surfaces: Array<{ name: "Episode Graph" | "Scene Manifest"; moments: readonly ChildrenLearningMoment[] }> = [
    { name: "Episode Graph", moments: graphMoments },
  ];
  if (args.sceneManifest !== undefined) {
    const manifest = assertSceneManifestMatchesEpisodeGraph(args.sceneManifest, graph);
    surfaces.push({
      name: "Scene Manifest",
      moments: manifest.scenes.map((scene) => ({
        beatId: scene.beatId,
        text: scene.text,
        characterIds: scene.characterIds,
        ...(scene.settingId ? { settingId: scene.settingId } : {}),
      })),
    });
  }

  const participation = args.showBible.storyPattern.find((step) => step.kind === "participation");
  const resolution = args.showBible.storyPattern.find((step) => step.kind === "resolution_recall");
  if (!participation || !resolution) {
    throw new Error("children_learning_experience: approved story pattern must include participation and resolution/recall stages");
  }
  if (participation.participationPrompt !== args.showBible.learningObjective.assessment.prompt) {
    throw new Error("children_learning_experience: participation prompt no longer matches the approved measurable assessment");
  }
  if (resolution.recallPrompt !== lessonContract.retrievalPractice.prompt) {
    throw new Error("children_learning_experience: resolution/recall prompt no longer matches the active retrieval-practice contract");
  }
  for (const surface of surfaces) {
    assertPromptAppearsInStage({
      stage: participation,
      prompt: args.showBible.learningObjective.assessment.prompt,
      label: "participation",
      guideIds,
      moments: surface.moments,
      surface: surface.name,
    });
    assertPromptAppearsInStage({
      stage: resolution,
      prompt: lessonContract.retrievalPractice.prompt,
      label: "resolution/recall",
      guideIds,
      moments: surface.moments,
      surface: surface.name,
    });

    for (const step of args.showBible.storyPattern) {
      const stageMoments = surface.moments.filter((moment) => step.episodeBeatIds.includes(moment.beatId));
      if (!stageMoments.some((moment) => moment.characterIds.some((id) => guideIds.has(id)))) {
        throw new Error(
          `children_learning_experience: no declared original guide appears in the ${step.kind} ${surface.name} stage`,
        );
      }
    }
    const worldStageCount = args.showBible.storyPattern.filter((step) =>
      surface.moments
        .filter((moment) => step.episodeBeatIds.includes(moment.beatId))
        .some((moment) => moment.settingId === args.showBible.identity.world.settingId),
    ).length;
    if (worldStageCount < 3) {
      throw new Error(
        `children_learning_experience: original world is not carried through at least three ${surface.name} story stages`,
      );
    }
  }
}

/** External seed keys required by a content lane before pipeline execution. */
export function childrenShowBibleSeedKeys(contentLane: unknown): string[] {
  const lane = ContentLaneSchema.safeParse(contentLane);
  return lane.success && lane.data.key === "children_learning_supervised"
    ? [...curriculumEpisodeSeedKeys(contentLane), CHILDREN_SHOW_BIBLE_INPUT_SEED_KEY]
    : [];
}

/**
 * Keep a missing child-editor packet from becoming a late, ambiguous block
 * failure. Schema/approval integrity remains the responsibility of the
 * children_show_bible block itself.
 */
export function assertChildrenShowBibleSeeded(
  contentLane: unknown,
  store: Record<string, unknown>,
): void {
  assertCurriculumEpisodeSeeded(contentLane, store);
  if (
    childrenShowBibleSeedKeys(contentLane).length > 0 &&
    !Object.prototype.hasOwnProperty.call(store, CHILDREN_SHOW_BIBLE_INPUT_SEED_KEY)
  ) {
    throw new Error(
      "children_learning_supervised requires an operator-supplied approved childrenShowBibleInput before a review candidate can run",
    );
  }
}

export const ChildrenShowBibleIssueCodeSchema = z.enum([
  "show_bible_schema_invalid",
  "age_band_missing",
  "learning_objective_missing",
  "identity_missing",
  "story_pattern_invalid",
  "editorial_review_missing",
  "curriculum_episode_seed_invalid",
  "episode_graph_invalid",
  "learning_contract_invalid",
  "children_lane_required",
  "series_mismatch",
  "learning_objective_multiple",
  "learning_objective_mismatch",
  "identity_graph_mismatch",
  "identity_ip_adjacent",
  "identity_continuity_missing",
  "story_pattern_coverage_invalid",
  "story_pattern_semantics_invalid",
  "editorial_review_bible_mismatch",
  "editorial_review_graph_mismatch",
  "editorial_review_lesson_contract_mismatch",
  "editorial_review_stale",
]);

export type ChildrenShowBibleIssueCode = z.infer<typeof ChildrenShowBibleIssueCodeSchema>;

export interface ChildrenShowBibleIssue {
  code: ChildrenShowBibleIssueCode;
  message: string;
  remediation: string;
}

export interface ChildrenShowBibleAdmissionReport {
  safe: boolean;
  issues: ChildrenShowBibleIssue[];
}

export interface AdmittedChildrenShowBible {
  input: ChildrenShowBibleInput;
  bible: ChildrenShowBible;
  receipt: ChildrenShowBibleApprovalReceipt;
}

function issue(
  code: ChildrenShowBibleIssueCode,
  message: string,
  remediation: string,
): ChildrenShowBibleIssue {
  return { code, message, remediation };
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

/**
 * Stable review target. Pattern order is deliberately retained because it is
 * story meaning; independent character and graph-beat lists are normalized.
 */
export function childrenShowBibleContentFingerprint(
  value: Pick<
    ChildrenShowBibleInput,
    "version" | "seriesId" | "ageBand" | "learningObjective" | "identity" | "storyPattern"
  >,
): string {
  const bible = ChildrenShowBibleContentSchema.parse({
    version: value.version,
    seriesId: value.seriesId,
    ageBand: value.ageBand,
    learningObjective: value.learningObjective,
    identity: value.identity,
    storyPattern: value.storyPattern,
  });
  return fingerprint({
    ...bible,
    identity: {
      ...bible.identity,
      recurringCharacters: [...bible.identity.recurringCharacters].sort((left, right) =>
        canonicalJson(left).localeCompare(canonicalJson(right)),
      ),
    },
    storyPattern: bible.storyPattern.map((step) => ({
      ...step,
      episodeBeatIds: [...step.episodeBeatIds].sort(),
      ...(step.variationDimensions
        ? { variationDimensions: [...step.variationDimensions].sort() }
        : {}),
    })),
  });
}

function schemaIssues(value: unknown): ChildrenShowBibleIssue[] {
  const parsed = ChildrenShowBibleInputSchema.safeParse(value);
  if (parsed.success) return [];
  const paths = parsed.error.issues.map((entry) => entry.path.map(String));
  const includesPath = (field: string) => paths.some((path) => path.includes(field));
  const issues: ChildrenShowBibleIssue[] = [];
  if (includesPath("ageBand")) {
    issues.push(issue(
      "age_band_missing",
      "The show bible must declare a bounded age band.",
      "Supply toddler, preschool, or early_primary with minimumYears and maximumYears.",
    ));
  }
  if (includesPath("learningObjective")) {
    issues.push(issue(
      "learning_objective_missing",
      "The show bible must declare one measurable learning objective and assessment prompt.",
      "Supply one objective object with an observable action and 1–3 correct-response assessment.",
    ));
  }
  if (includesPath("identity")) {
    issues.push(issue(
      "identity_missing",
      "The show bible must declare an original world and recurring character identity.",
      "Add the world, at least one recurring character, and the originality declaration.",
    ));
  }
  if (includesPath("storyPattern")) {
    issues.push(issue(
      "story_pattern_invalid",
      "The show bible must contain exactly the five child-participation story stages.",
      "Provide familiar_problem, guided_attempt, varied_repetition, participation, and resolution_recall in that order.",
    ));
  }
  if (includesPath("editorialReview")) {
    issues.push(issue(
      "editorial_review_missing",
      "A structured human child-editor approval is required.",
      "Provide an approved review with reviewer id, timestamp, confirmations, and all three review fingerprints.",
    ));
  }
  if (!issues.length) {
    issues.push(issue(
      "show_bible_schema_invalid",
      "The children show bible does not conform to the reusable contract schema.",
      "Correct the input schema before requesting child-show admission.",
    ));
  }
  return issues;
}

function parseReviewedAt(value: string): Date | undefined {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function uniqueIssues(issues: readonly ChildrenShowBibleIssue[]): ChildrenShowBibleIssue[] {
  const seen = new Set<string>();
  return issues.filter((entry) => {
    const key = `${entry.code}:${entry.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const PATTERN_ORDER: readonly ChildrenStoryPatternKind[] = [
  "familiar_problem",
  "guided_attempt",
  "varied_repetition",
  "participation",
  "resolution_recall",
];

const ALLOWED_GRAPH_KINDS: Readonly<Record<ChildrenStoryPatternKind, readonly string[]>> = {
  familiar_problem: ["problem"],
  guided_attempt: ["experiment", "choice"],
  varied_repetition: ["experiment", "choice", "observation", "result"],
  participation: ["question", "choice"],
  resolution_recall: ["lesson", "resolution"],
};

// This is an obvious-signal screen, deliberately not a trademark opinion.
// The human child editor still makes the affirmative original-identity decision.
const IP_ADJACENT_IDENTITY_TERMS = [
  "disney",
  "pixar",
  "marvel",
  "dc comics",
  "pokemon",
  "mickey mouse",
  "minnie mouse",
  "peppa pig",
  "paw patrol",
  "cocomelon",
  "bluey",
  "sesame street",
  "spongebob",
  "barbie",
  "lego",
  "hello kitty",
  "super mario",
  "nintendo",
  "star wars",
  "harry potter",
] as const;

function normalizedIdentityText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function identityTerms(packet: ChildrenShowBibleInput): string[] {
  return [
    packet.identity.seriesTitle,
    packet.identity.world.displayName,
    packet.identity.world.continuityLock,
    packet.identity.world.originalIdentity,
    packet.identity.originalityDeclaration.differentiation,
    ...packet.identity.recurringCharacters.flatMap((character) => [
      character.displayName,
      character.continuityLock,
      character.originalIdentity,
    ]),
  ].map(normalizedIdentityText);
}

/**
 * Evaluates the operator-supplied input without side effects. UIs can call this
 * before a runner starts to show the child editor exactly what needs changing.
 */
export function evaluateChildrenShowBible(
  args: {
    input: unknown;
    curriculumEpisodeSeed: unknown;
    curriculumEpisodeSeedApproval: unknown;
    episodeGraph: unknown;
    lessonContract: unknown;
    contentLane: unknown;
  },
  options: { now?: Date } = {},
): ChildrenShowBibleAdmissionReport {
  const parsed = ChildrenShowBibleInputSchema.safeParse(args.input);
  if (!parsed.success) return { safe: false, issues: schemaIssues(args.input) };
  const packet = parsed.data;
  const issues: ChildrenShowBibleIssue[] = [];

  // The Show Bible is the later graph/lesson proof. It may never silently
  // substitute a curriculum, identity, or assessment approved before Story
  // Spine planning began.
  try {
    assertCurriculumEpisodeSeedMatchesShowBible({
      curriculumEpisodeSeed: args.curriculumEpisodeSeed,
      curriculumEpisodeSeedApproval: args.curriculumEpisodeSeedApproval,
      showBibleInput: packet,
    });
  } catch (error) {
    issues.push(issue(
      "curriculum_episode_seed_invalid",
      error instanceof Error ? error.message : "The curriculum episode seed is missing or invalid.",
      "Supply the current child-editor-approved CurriculumEpisodeSeed and keep its age band, objective, assessment, original world, and recurring cast identical in the Show Bible.",
    ));
  }

  let graph: EpisodeGraph | undefined;
  try {
    graph = assertEpisodeGraph(args.episodeGraph);
  } catch (error) {
    issues.push(issue(
      "episode_graph_invalid",
      error instanceof Error ? error.message : "The active Episode Graph is invalid.",
      "Rebuild and validate the children Episode Graph before binding the show bible.",
    ));
  }

  let lessonContract: LearningContract | undefined;
  if (graph) {
    try {
      lessonContract = assertLearningContract(args.lessonContract, graph);
    } catch (error) {
      issues.push(issue(
        "learning_contract_invalid",
        error instanceof Error ? error.message : "The active Learning Contract is invalid.",
        "Regenerate the source-linked Learning Contract from this exact Episode Graph.",
      ));
    }
  }

  try {
    const lane = ContentLaneSchema.parse(args.contentLane);
    if (lane.key !== "children_learning_supervised" || lane.family !== "children_learning") {
      issues.push(issue(
        "children_lane_required",
        "The children show bible can only bind the supervised children-learning lane.",
        "Use contentLane children_learning_supervised; this module never opens a public or scheduled lane.",
      ));
    }
  } catch (error) {
    issues.push(issue(
      "children_lane_required",
      error instanceof Error ? error.message : "A valid supervised children-learning lane is required.",
      "Supply the active children_learning_supervised Content Lane.",
    ));
  }

  if (!graph || !lessonContract) return { safe: false, issues: uniqueIssues(issues) };

  if (graph.audience !== "children") {
    issues.push(issue(
      "children_lane_required",
      "The show bible can only bind an Episode Graph declared for children.",
      "Use a children-audience Episode Graph in the supervised children-learning lane.",
    ));
  }
  if (packet.seriesId !== graph.seriesId) {
    issues.push(issue(
      "series_mismatch",
      `Show bible seriesId ${packet.seriesId} does not match Episode Graph ${graph.seriesId}.`,
      "Bind the show bible to the exact recurring-series identifier used by the active Episode Graph.",
    ));
  }

  const graphObjectives = [...new Set(
    graph.beats.map((beat) => beat.learningObjective).filter((value): value is string => Boolean(value)),
  )];
  if (graphObjectives.length !== 1) {
    issues.push(issue(
      "learning_objective_multiple",
      "A children show bible may carry exactly one learning objective per episode.",
      "Make every child Episode Graph beat support the same single objective before admission.",
    ));
  } else if (
    graphObjectives[0] !== packet.learningObjective.statement ||
    lessonContract.learningObjective !== packet.learningObjective.statement
  ) {
    issues.push(issue(
      "learning_objective_mismatch",
      "The measurable show-bible objective does not match the active Episode Graph and Learning Contract.",
      "Use the exact one objective from the active Learning Contract and its grounded Episode Graph beats.",
    ));
  }

  const settingsById = new Map(graph.settings.map((setting) => [setting.id, setting]));
  const world = settingsById.get(packet.identity.world.settingId);
  if (
    !world ||
    world.displayName !== packet.identity.world.displayName ||
    world.continuityLock !== packet.identity.world.continuityLock
  ) {
    issues.push(issue(
      "identity_graph_mismatch",
      "The declared world identity does not match the active Episode Graph setting catalog.",
      "Copy the exact setting id, display name, and continuity lock from the active graph before approval.",
    ));
  }

  const charactersById = new Map(graph.characters.map((character) => [character.id, character]));
  const recurringIds = new Set<string>();
  for (const character of packet.identity.recurringCharacters) {
    if (recurringIds.has(character.characterId)) {
      issues.push(issue(
        "identity_graph_mismatch",
        `Recurring character ${character.characterId} is declared more than once.`,
        "Declare each recurring character once so review and continuity stay unambiguous.",
      ));
      continue;
    }
    recurringIds.add(character.characterId);
    const graphCharacter = charactersById.get(character.characterId);
    if (
      !graphCharacter ||
      graphCharacter.displayName !== character.displayName ||
      graphCharacter.continuityLock !== character.continuityLock
    ) {
      issues.push(issue(
        "identity_graph_mismatch",
        `Recurring character ${character.characterId} does not match the active Episode Graph catalog.`,
        "Copy its exact character id, display name, and continuity lock from the active graph.",
      ));
    }
  }

  const blockedTerms = [...new Set(
    IP_ADJACENT_IDENTITY_TERMS.filter((term) =>
      identityTerms(packet).some((candidate) => candidate.includes(term)),
    ),
  )];
  if (blockedTerms.length) {
    issues.push(issue(
      "identity_ip_adjacent",
      `Original show identity contains blocked borrowed/IP-adjacent terms: ${blockedTerms.join(", ")}.`,
      "Replace the borrowed reference with an independently original series, world, and character identity; then obtain a fresh child-editor review.",
    ));
  }

  const orderedBeats = [...graph.beats].sort((left, right) => left.t0 - right.t0 || left.id.localeCompare(right.id));
  const beatById = new Map(orderedBeats.map((beat) => [beat.id, beat]));
  const positionByBeatId = new Map(orderedBeats.map((beat, index) => [beat.id, index]));
  const patternKinds = packet.storyPattern.map((step) => step.kind);
  if (PATTERN_ORDER.some((kind, index) => patternKinds[index] !== kind)) {
    issues.push(issue(
      "story_pattern_invalid",
      "The children episode must use familiar problem → guided attempt → varied repetition → participation → resolution/recall in order.",
      "Restore all five named stages in their required order; do not compress or omit child participation.",
    ));
  }

  const allLinkedIds: string[] = [];
  for (const step of packet.storyPattern) {
    for (const id of step.episodeBeatIds) {
      allLinkedIds.push(id);
      if (!beatById.has(id)) {
        issues.push(issue(
          "story_pattern_coverage_invalid",
          `Story stage ${step.kind} references unknown Episode Graph beat ${id}.`,
          "Link only beat ids from the active children Episode Graph.",
        ));
      }
    }
  }
  const uniqueLinkedIds = new Set(allLinkedIds);
  if (uniqueLinkedIds.size !== allLinkedIds.length) {
    issues.push(issue(
      "story_pattern_coverage_invalid",
      "An Episode Graph beat may not satisfy more than one child-story stage.",
      "Assign every beat to one clear story stage so the participation structure remains auditable.",
    ));
  }
  if (
    uniqueLinkedIds.size !== orderedBeats.length ||
    orderedBeats.some((beat) => !uniqueLinkedIds.has(beat.id))
  ) {
    issues.push(issue(
      "story_pattern_coverage_invalid",
      "The five child-story stages must cover every active Episode Graph beat exactly once.",
      "Map all graph beats to one story stage; remove ungrounded filler or unlinked story segments.",
    ));
  }

  for (const step of packet.storyPattern) {
    const positions = step.episodeBeatIds
      .map((id) => positionByBeatId.get(id))
      .filter((position): position is number => position !== undefined)
      .sort((left, right) => left - right);
    if (positions.some((position, index) => index > 0 && position !== positions[index - 1] + 1)) {
      issues.push(issue(
        "story_pattern_coverage_invalid",
        `Story stage ${step.kind} maps non-contiguous Episode Graph beats.`,
        "Keep each stage as one chronological block in the active causal graph.",
      ));
    }

    const linkedBeats = step.episodeBeatIds
      .map((id) => beatById.get(id))
      .filter((beat): beat is EpisodeGraph["beats"][number] => Boolean(beat));
    if (!linkedBeats.some((beat) => ALLOWED_GRAPH_KINDS[step.kind].includes(beat.kind))) {
      issues.push(issue(
        "story_pattern_semantics_invalid",
        `Story stage ${step.kind} has no compatible Episode Graph beat kind.`,
        `Include one of [${ALLOWED_GRAPH_KINDS[step.kind].join(", ")}] in its linked graph beats.`,
      ));
    }
  }

  const varied = packet.storyPattern.find((step) => step.kind === "varied_repetition");
  if (!varied || new Set(varied.variationDimensions ?? []).size < 2) {
    issues.push(issue(
      "story_pattern_semantics_invalid",
      "Varied repetition must declare at least two changed dimensions.",
      "Use two or more of object, context, cue, and action so repetition teaches rather than merely loops.",
    ));
  }
  const participation = packet.storyPattern.find((step) => step.kind === "participation");
  if (!participation || participation.participationPrompt !== packet.learningObjective.assessment.prompt) {
    issues.push(issue(
      "story_pattern_semantics_invalid",
      "Participation must use the measurable objective’s exact assessment prompt.",
      "Place the declared assessment prompt in the participation stage so the child is asked to act, not just watch.",
    ));
  }
  const resolution = packet.storyPattern.find((step) => step.kind === "resolution_recall");
  if (!resolution || resolution.recallPrompt !== lessonContract.retrievalPractice.prompt) {
    issues.push(issue(
      "story_pattern_semantics_invalid",
      "Resolution/recall must use the active Learning Contract’s retrieval-practice prompt.",
      "Use the exact retrieval-practice prompt in the final resolution/recall stage.",
    ));
  }
  if (resolution && !resolution.episodeBeatIds.includes(orderedBeats.at(-1)?.id ?? "")) {
    issues.push(issue(
      "story_pattern_coverage_invalid",
      "Resolution/recall must include the final Episode Graph beat.",
      "Move the graph’s final lesson or resolution beat into the resolution_recall stage.",
    ));
  }

  const guideIds = packet.identity.recurringCharacters
    .filter((character) => character.role === "guide")
    .map((character) => character.characterId);
  if (!guideIds.length) {
    issues.push(issue(
      "identity_continuity_missing",
      "An original recurring show needs at least one declared guide character.",
      "Declare an original guide character that appears throughout the five-stage episode pattern.",
    ));
  } else {
    for (const step of packet.storyPattern) {
      const containsGuide = step.episodeBeatIds
        .map((id) => beatById.get(id))
        .filter((beat): beat is EpisodeGraph["beats"][number] => Boolean(beat))
        .some((beat) => beat.characterIds.some((id) => guideIds.includes(id)));
      if (!containsGuide) {
        issues.push(issue(
          "identity_continuity_missing",
          `No declared guide character appears in the ${step.kind} stage.`,
          "Keep the recurring guide visibly present in every stage, or revise the graph and obtain fresh approval.",
        ));
      }
    }
  }
  const worldStageCount = packet.storyPattern.filter((step) =>
    step.episodeBeatIds
      .map((id) => beatById.get(id))
      .some((beat) => beat?.settingId === packet.identity.world.settingId),
  ).length;
  if (worldStageCount < 3) {
    issues.push(issue(
      "identity_continuity_missing",
      "The declared original world is not visibly carried through most of the episode pattern.",
      "Use the world’s setting identity in at least three story stages, or change the declared world to the actual recurring setting.",
    ));
  }

  const contentFingerprint = childrenShowBibleContentFingerprint(packet);
  const graphFingerprint = episodeGraphFingerprint(graph);
  if (packet.editorialReview.reviewedShowBibleFingerprint !== contentFingerprint) {
    issues.push(issue(
      "editorial_review_bible_mismatch",
      "The child-editor approval was not issued for this exact show-bible content.",
      "Obtain a new child-editor approval after any age, objective, identity, or story-pattern change.",
    ));
  }
  if (packet.editorialReview.reviewedEpisodeGraphFingerprint !== graphFingerprint) {
    issues.push(issue(
      "editorial_review_graph_mismatch",
      "The child-editor approval was not issued for this exact Episode Graph fingerprint.",
      "Have the child editor review the current causal graph after any beat, character, setting, or timing change.",
    ));
  }
  if (packet.editorialReview.reviewedLessonContractFingerprint !== lessonContract.fingerprint) {
    issues.push(issue(
      "editorial_review_lesson_contract_mismatch",
      "The child-editor approval was not issued for this exact Learning Contract fingerprint.",
      "Have the child editor reapprove the current objective, retrieval practice, and source-linked lesson contract.",
    ));
  }
  const now = options.now ?? new Date();
  const reviewedAt = parseReviewedAt(packet.editorialReview.reviewedAt);
  if (
    !reviewedAt ||
    reviewedAt.getTime() > now.getTime() + FUTURE_REVIEW_CLOCK_SKEW_MS ||
    now.getTime() - reviewedAt.getTime() > CHILD_EDITORIAL_REVIEW_MAX_AGE_MS
  ) {
    issues.push(issue(
      "editorial_review_stale",
      `Child-editor approval must be valid, non-future, and no older than ${CHILD_EDITORIAL_REVIEW_MAX_AGE_DAYS} days.`,
      "Obtain a fresh child-editor approval bound to the unchanged show bible, Episode Graph, and Learning Contract.",
    ));
  }

  return { safe: issues.length === 0, issues: uniqueIssues(issues) };
}

/** Throws a remediation-rich error and returns only a private-review admission. */
export function assertChildrenShowBible(
  args: {
    input: unknown;
    curriculumEpisodeSeed: unknown;
    curriculumEpisodeSeedApproval: unknown;
    episodeGraph: unknown;
    lessonContract: unknown;
    contentLane: unknown;
  },
  options: { now?: Date } = {},
): AdmittedChildrenShowBible {
  const report = evaluateChildrenShowBible(args, options);
  if (!report.safe) {
    throw new Error(
      `children show bible admission blocked: ${report.issues
        .map((entry) => `${entry.code}: ${entry.message} Remediation: ${entry.remediation}`)
        .join(" | ")}`,
    );
  }
  const input = ChildrenShowBibleInputSchema.parse(args.input);
  const graph = assertEpisodeGraph(args.episodeGraph);
  const lessonContract = assertLearningContract(args.lessonContract, graph);
  assertChildrenLearningExperience({
    showBible: input,
    episodeGraph: graph,
    lessonContract,
  });
  const contentFingerprint = childrenShowBibleContentFingerprint(input);
  const graphFingerprint = episodeGraphFingerprint(graph);
  const bible = ChildrenShowBibleSchema.parse({
    ...input,
    contentFingerprint,
    episodeGraphFingerprint: graphFingerprint,
    lessonContractFingerprint: lessonContract.fingerprint,
    release: "private_human_child_editor_review_only",
    allowedPublishMode: "draft",
  });
  const receipt = ChildrenShowBibleApprovalReceiptSchema.parse({
    version: CHILDREN_SHOW_BIBLE_ADMISSION_VERSION,
    seriesId: input.seriesId,
    showBibleFingerprint: contentFingerprint,
    episodeGraphFingerprint: graphFingerprint,
    lessonContractFingerprint: lessonContract.fingerprint,
    ageBand: input.ageBand,
    editorialReview: input.editorialReview,
    release: "private_human_child_editor_review_only",
    allowedPublishMode: "draft",
    requiresHumanChildEditor: true,
  });
  return { input, bible, receipt };
}
