/**
 * Deterministic creator-intent diagnosis.
 *
 * The Program Brief is the creator's immutable promise and the Program Route
 * is the catalog-owned interpretation of that promise. This receipt exposes
 * the reusable editorial consequences of their sealed pairing without asking
 * a model to infer meaning from free-form wording. It is deliberately a
 * planning/admission artifact, never a provider instruction or score.
 */
import { z } from "zod";

import {
  assertCanonicalChannelProgramBrief,
  channelProgramBriefFingerprint,
  SerializedProgramSchema,
  type SerializedProgram,
} from "@/engine/channelProgramBrief";
import {
  assertChannelProgramRouteBinding,
  channelProgramRouteFingerprint,
  type ChannelProgramRoute,
  type ChannelProgramRouteKey,
} from "@/engine/channelProgramRoute";
import type { FamilyKey } from "@/engine/families";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export const CREATOR_INTENT_DIAGNOSIS_VERSION = "creator-intent-diagnosis/v1" as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export type CreatorIntentViewerJobKind =
  | "understand_a_repeatable_editorial_lesson"
  | "enter_a_guided_listening_state"
  | "receive_a_concise_original_payoff"
  | "enter_an_original_instrumental_focus_session"
  | "solve_a_sourced_fact_challenge"
  | "understand_an_illustrated_explainer"
  | "understand_a_drawn_whiteboard_explainer"
  | "experience_an_original_motion_comic"
  | "experience_a_causally_coherent_cinematic_episode"
  | "experience_a_first_person_lore_micro_documentary"
  | "explore_a_disclosed_counterfactual";

export type CreatorIntentClaimMode =
  | "factual_editorial"
  | "factual_certified"
  | "fictional_disclosed";

export type CreatorIntentEditorialGrammarKind =
  | "narrated_editorial_episode"
  | "guided_listening_episode"
  | "short_form_payoff_episode"
  | "original_music_loop_episode"
  | "sourced_quiz_challenge"
  | "illustrated_explainer_episode"
  | "drawn_whiteboard_explainer_episode"
  | "motion_comic_episode"
  | "cinematic_narrative_episode"
  | "first_person_lore_micro_documentary_episode"
  | "fictional_thought_experiment";

export type CreatorIntentEvidenceBurdenKind =
  | "editorial_policy_and_episode_review"
  | "source_provenance_per_fact"
  | "fictional_disclosure_and_internal_consistency";

export type CreatorIntentAmbiguityState =
  | "none"
  | "episode_claim_scope_unresolved";

export interface CreatorIntentDiagnosis {
  readonly version: typeof CREATOR_INTENT_DIAGNOSIS_VERSION;
  readonly programBriefFingerprint: string;
  readonly programRouteFingerprint: string;
  readonly routeKey: ChannelProgramRouteKey;
  readonly family: FamilyKey;
  readonly viewerJob: {
    readonly kind: CreatorIntentViewerJobKind;
    /** Exact catalog-owned route wording, not a model paraphrase. */
    readonly statement: string;
  };
  readonly claimMode: CreatorIntentClaimMode;
  readonly editorialGrammar: {
    readonly kind: CreatorIntentEditorialGrammarKind;
    readonly topicRules: readonly string[];
    readonly scriptRules: readonly string[];
    readonly criticFocus: readonly string[];
  };
  readonly evidenceBurden: {
    readonly kind: CreatorIntentEvidenceBurdenKind;
    readonly requiresExternalSources: boolean;
    readonly requiresPerClaimProvenance: boolean;
    readonly requiresFictionDisclosure: boolean;
  };
  readonly outputShape: {
    readonly contentLaneKey: string;
    readonly requiredBlocks: readonly string[];
    readonly requiredBlockOrder: readonly (readonly [string, string])[];
    readonly quizProfile?: string;
    readonly syntheticScenarioProfile?: string;
    /** Route-owned recurrence semantics, never a mutable pipeline override. */
    readonly serializedProgram?: SerializedProgram;
  };
  /**
   * A channel-level route can deliberately leave the exact factual scope to
   * later episode admission. This makes that limit explicit instead of
   * pretending arbitrary creator prose was semantically resolved.
   */
  readonly ambiguity: {
    readonly state: CreatorIntentAmbiguityState;
    readonly reasons: readonly string[];
    readonly requiresEpisodeAdmission: boolean;
  };
  /** The route is catalog-sealed; this is classification certainty, not a quality score. */
  readonly confidence: 1;
  readonly fingerprint: string;
}

type CreatorIntentDiagnosisBody = Omit<CreatorIntentDiagnosis, "fingerprint">;

const CreatorIntentDiagnosisSchema = z.object({
  version: z.literal(CREATOR_INTENT_DIAGNOSIS_VERSION),
  programBriefFingerprint: z.string().regex(SHA256_PATTERN),
  programRouteFingerprint: z.string().regex(SHA256_PATTERN),
  routeKey: z.string().min(1).max(160),
  family: z.string().min(1).max(80),
  viewerJob: z.object({
    kind: z.enum([
      "understand_a_repeatable_editorial_lesson",
      "enter_a_guided_listening_state",
      "receive_a_concise_original_payoff",
      "solve_a_sourced_fact_challenge",
      "understand_an_illustrated_explainer",
      "understand_a_drawn_whiteboard_explainer",
      "experience_an_original_motion_comic",
      "explore_a_disclosed_counterfactual",
    ]),
    statement: z.string().min(1).max(300),
  }).strict(),
  claimMode: z.enum(["factual_editorial", "factual_certified", "fictional_disclosed"]),
  editorialGrammar: z.object({
    kind: z.enum([
      "narrated_editorial_episode",
      "guided_listening_episode",
      "short_form_payoff_episode",
      "sourced_quiz_challenge",
      "illustrated_explainer_episode",
      "drawn_whiteboard_explainer_episode",
      "motion_comic_episode",
      "fictional_thought_experiment",
    ]),
    topicRules: z.array(z.string().min(1).max(400)).min(1).max(8),
    scriptRules: z.array(z.string().min(1).max(400)).min(1).max(8),
    criticFocus: z.array(z.string().min(1).max(400)).min(1).max(8),
  }).strict(),
  evidenceBurden: z.object({
    kind: z.enum([
      "editorial_policy_and_episode_review",
      "source_provenance_per_fact",
      "fictional_disclosure_and_internal_consistency",
    ]),
    requiresExternalSources: z.boolean(),
    requiresPerClaimProvenance: z.boolean(),
    requiresFictionDisclosure: z.boolean(),
  }).strict(),
  outputShape: z.object({
    contentLaneKey: z.string().min(1).max(160),
    requiredBlocks: z.array(z.string().min(1).max(160)).min(1).max(32),
    requiredBlockOrder: z.array(z.tuple([z.string().min(1).max(160), z.string().min(1).max(160)])).max(32),
    quizProfile: z.string().min(1).max(160).optional(),
    syntheticScenarioProfile: z.string().min(1).max(160).optional(),
    serializedProgram: SerializedProgramSchema.optional(),
  }).strict(),
  ambiguity: z.object({
    state: z.enum(["none", "episode_claim_scope_unresolved"]),
    reasons: z.array(z.string().min(1).max(400)).max(4),
    requiresEpisodeAdmission: z.boolean(),
  }).strict(),
  confidence: z.literal(1),
  fingerprint: z.string().regex(SHA256_PATTERN),
}).strict();

function diagnosisBody(value: CreatorIntentDiagnosis): CreatorIntentDiagnosisBody {
  const body = { ...value } as CreatorIntentDiagnosisBody & { fingerprint?: string };
  delete body.fingerprint;
  return body;
}

function freezeDiagnosis(value: CreatorIntentDiagnosis): CreatorIntentDiagnosis {
  return Object.freeze({
    ...value,
    viewerJob: Object.freeze({ ...value.viewerJob }),
    editorialGrammar: Object.freeze({
      ...value.editorialGrammar,
      topicRules: Object.freeze([...value.editorialGrammar.topicRules]),
      scriptRules: Object.freeze([...value.editorialGrammar.scriptRules]),
      criticFocus: Object.freeze([...value.editorialGrammar.criticFocus]),
    }),
    evidenceBurden: Object.freeze({ ...value.evidenceBurden }),
    outputShape: Object.freeze({
      ...value.outputShape,
      requiredBlocks: Object.freeze([...value.outputShape.requiredBlocks]),
      requiredBlockOrder: Object.freeze(
        value.outputShape.requiredBlockOrder.map((pair) => Object.freeze([...pair] as [string, string])),
      ),
    }),
    ambiguity: Object.freeze({
      ...value.ambiguity,
      reasons: Object.freeze([...value.ambiguity.reasons]),
    }),
  });
}

function viewerJobKind(routeKey: ChannelProgramRouteKey): CreatorIntentViewerJobKind {
  switch (routeKey) {
    case "narrated-stock/foundation/v1":
      return "understand_a_repeatable_editorial_lesson";
    case "sleep/foundation/v1":
      return "enter_a_guided_listening_state";
    case "shorts/foundation/v1":
      return "receive_a_concise_original_payoff";
    case "music-loop/foundation/v1":
      return "enter_an_original_instrumental_focus_session";
    case "quizyear/certified-profile/v1":
    case "quizyear/sports-championship-timeline/v1":
    case "quizyear/portrait-supervised/v1":
      return "solve_a_sourced_fact_challenge";
    case "whiteboard/foundation/v1":
      return "understand_a_drawn_whiteboard_explainer";
    case "comic/foundation/v1":
      return "experience_an_original_motion_comic";
    case "cinematic/foundation/v1":
      return "experience_a_causally_coherent_cinematic_episode";
    case "loreshort/foundation/v1":
      return "experience_a_first_person_lore_micro_documentary";
    case "illustrated-explainer/foundation/v1":
      return "understand_an_illustrated_explainer";
    case "illustrated-explainer/fictional-decision-lab/v1":
    case "illustrated-explainer/fictional-ai-town/v1":
    case "illustrated-explainer/fictional-ai-pov/v1":
      return "explore_a_disclosed_counterfactual";
  }
}

function editorialGrammarKind(routeKey: ChannelProgramRouteKey): CreatorIntentEditorialGrammarKind {
  switch (routeKey) {
    case "narrated-stock/foundation/v1":
      return "narrated_editorial_episode";
    case "sleep/foundation/v1":
      return "guided_listening_episode";
    case "shorts/foundation/v1":
      return "short_form_payoff_episode";
    case "music-loop/foundation/v1":
      return "original_music_loop_episode";
    case "quizyear/certified-profile/v1":
    case "quizyear/sports-championship-timeline/v1":
    case "quizyear/portrait-supervised/v1":
      return "sourced_quiz_challenge";
    case "whiteboard/foundation/v1":
      return "drawn_whiteboard_explainer_episode";
    case "comic/foundation/v1":
      return "motion_comic_episode";
    case "cinematic/foundation/v1":
      return "cinematic_narrative_episode";
    case "loreshort/foundation/v1":
      return "first_person_lore_micro_documentary_episode";
    case "illustrated-explainer/foundation/v1":
      return "illustrated_explainer_episode";
    case "illustrated-explainer/fictional-decision-lab/v1":
    case "illustrated-explainer/fictional-ai-town/v1":
    case "illustrated-explainer/fictional-ai-pov/v1":
      return "fictional_thought_experiment";
  }
}

function claimConsequences(route: ChannelProgramRoute): Pick<
  CreatorIntentDiagnosis,
  "claimMode" | "evidenceBurden" | "ambiguity"
> {
  switch (route.directives.claimMode) {
    case "editorial_lane_policy":
      return {
        claimMode: "factual_editorial",
        evidenceBurden: {
          kind: "editorial_policy_and_episode_review",
          requiresExternalSources: false,
          requiresPerClaimProvenance: false,
          requiresFictionDisclosure: false,
        },
        ambiguity: {
          state: "episode_claim_scope_unresolved",
          reasons: [
            "The sealed channel route defines an editorial lane; each episode still owns its factual claim scope.",
          ],
          requiresEpisodeAdmission: true,
        },
      };
    case "certified_quiz_facts":
      return {
        claimMode: "factual_certified",
        evidenceBurden: {
          kind: "source_provenance_per_fact",
          requiresExternalSources: true,
          requiresPerClaimProvenance: true,
          requiresFictionDisclosure: false,
        },
        ambiguity: {
          state: "none",
          reasons: [],
          requiresEpisodeAdmission: false,
        },
      };
    case "fictional_scenario_no_external_claims":
      return {
        claimMode: "fictional_disclosed",
        evidenceBurden: {
          kind: "fictional_disclosure_and_internal_consistency",
          requiresExternalSources: false,
          requiresPerClaimProvenance: false,
          requiresFictionDisclosure: true,
        },
        ambiguity: {
          state: "none",
          reasons: [],
          requiresEpisodeAdmission: false,
        },
      };
  }
}

/** Stable SHA-256 of every diagnosis field except its self-reference. */
export function creatorIntentDiagnosisFingerprint(value: unknown): string {
  const parsed = CreatorIntentDiagnosisSchema.parse(value) as CreatorIntentDiagnosis;
  return sha256Hex(canonicalJson(diagnosisBody(parsed)));
}

/** Parse an already persisted receipt without silently normalizing it. */
export function parseCreatorIntentDiagnosis(value: unknown): CreatorIntentDiagnosis {
  const parsed = CreatorIntentDiagnosisSchema.parse(value) as CreatorIntentDiagnosis;
  if (parsed.fingerprint !== creatorIntentDiagnosisFingerprint(parsed)) {
    throw new Error("creator intent diagnosis fingerprint is invalid");
  }
  return freezeDiagnosis(parsed);
}

/**
 * Derive the complete diagnosis from the canonical brief and current sealed
 * route. Free-form concept wording never selects a grammar or claim mode.
 */
export function deriveCreatorIntentDiagnosis(input: {
  readonly programBrief: unknown;
  readonly programRoute: unknown;
}): CreatorIntentDiagnosis {
  const programBrief = assertCanonicalChannelProgramBrief(input.programBrief);
  const programRoute = assertChannelProgramRouteBinding({
    route: input.programRoute,
    programBrief,
  });
  const consequences = claimConsequences(programRoute);
  const body: CreatorIntentDiagnosisBody = {
    version: CREATOR_INTENT_DIAGNOSIS_VERSION,
    programBriefFingerprint: channelProgramBriefFingerprint(programBrief),
    programRouteFingerprint: channelProgramRouteFingerprint(programRoute),
    routeKey: programRoute.routeKey,
    family: programRoute.family,
    viewerJob: {
      kind: viewerJobKind(programRoute.routeKey),
      statement: programRoute.directives.viewerJob,
    },
    claimMode: consequences.claimMode,
    editorialGrammar: {
      kind: editorialGrammarKind(programRoute.routeKey),
      topicRules: [...programRoute.directives.topicRules],
      scriptRules: [...programRoute.directives.scriptRules],
      criticFocus: [...programRoute.directives.criticFocus],
    },
    evidenceBurden: consequences.evidenceBurden,
    outputShape: {
      contentLaneKey: programRoute.contentLaneKey,
      requiredBlocks: [...programRoute.requiredBlocks],
      requiredBlockOrder: programRoute.requiredBlockOrder.map((pair) => [pair[0], pair[1]] as const),
      ...(programRoute.quizProfile ? { quizProfile: programRoute.quizProfile } : {}),
      ...(programRoute.syntheticScenarioProfile
        ? { syntheticScenarioProfile: programRoute.syntheticScenarioProfile }
        : {}),
      ...(programRoute.serializedProgram
        ? { serializedProgram: programRoute.serializedProgram }
        : {}),
    },
    ambiguity: consequences.ambiguity,
    confidence: 1,
  };
  const diagnosis: CreatorIntentDiagnosis = {
    ...body,
    fingerprint: sha256Hex(canonicalJson(body)),
  };
  return freezeDiagnosis(diagnosis);
}

/**
 * Require an untrusted persisted/payload receipt to be exactly the current
 * derivation. This catches valid-looking but semantically mismatched receipts,
 * catalog drift, and tampering before a retry can reuse prior work.
 */
export function assertCreatorIntentDiagnosisBinding(input: {
  readonly diagnosis: unknown;
  readonly programBrief: unknown;
  readonly programRoute: unknown;
}): CreatorIntentDiagnosis {
  const actual = parseCreatorIntentDiagnosis(input.diagnosis);
  const expected = deriveCreatorIntentDiagnosis({
    programBrief: input.programBrief,
    programRoute: input.programRoute,
  });
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error("creator intent diagnosis does not match the canonical program brief and route");
  }
  return actual;
}
