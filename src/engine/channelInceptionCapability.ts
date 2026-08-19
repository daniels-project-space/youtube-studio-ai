import type { FamilyKey } from "./families";
import {
  narratedPlanningFoundation,
  type NarratedFoundationFamily,
} from "./narratedPlanningFoundation";

/**
 * A channel family is not an autonomous creator merely because its episode
 * pipeline has a non-Gemini planner.  The shared channel-inception workflow
 * also owns positioning, brand assets, and the first admitted starter slate.
 *
 * Keep this contract pure and explicit so creator admission can fail before
 * bootstrap, provider setup, or a draft-shell write.  A future family becomes
 * eligible only by registering every one of those stages here with a real
 * deterministic/non-Gemini implementation.
 */
export type ChannelInceptionCapability =
  | {
      readonly mode: "registered_non_gemini";
      readonly id: string;
      readonly provenance: string;
      readonly coveredStages: readonly string[];
    }
  | {
      readonly mode: "unregistered";
      readonly blockers: readonly string[];
      readonly remediation: string;
    };

/**
 * A real, provider-free admission route that is intentionally narrower than
 * automatic Channel Inception. It may advance a private editorial package,
 * but it never makes a family production-ready or publishable.
 */
export type RegisteredSupervisedNonGeminiChannelAdmission = {
  readonly mode: "registered_supervised_non_gemini";
  readonly id: string;
  readonly provenance: string;
  readonly coveredStages: readonly string[];
  readonly reviewScope: "private_human_review_only" | "private_human_child_editor_review_only";
  readonly requiredArtifacts: readonly string[];
  /** A real in-studio desk when the supervised workflow has one. */
  readonly reviewHref?: string;
};

/**
 * What the creator can truthfully select. The supervised variant is separate
 * from `ChannelInceptionCapability` so automatic callers cannot mistake a
 * private review route for production or publishing authority.
 */
export type CreatorAdmissionCapability =
  | ChannelInceptionCapability
  | RegisteredSupervisedNonGeminiChannelAdmission;

const DEFAULT_UNREGISTERED: ChannelInceptionCapability = Object.freeze({
  mode: "unregistered" as const,
  blockers: Object.freeze([
    "no deterministic/non-Gemini positioning, brand-art, and starter-slate route is registered",
  ]),
  remediation:
    "Register a deterministic or explicitly non-Gemini implementation for positioning, channel art, and the admitted starter slate before enabling automatic channel creation.",
});

/**
 * The shared narrated foundation is the complete creator route, not merely a
 * script generator.  Keeping this conversion here makes a new narrated family
 * opt in to both the episode and channel-creation contracts independently.
 */
function registeredNarratedChannelInceptionCapability(
  family: NarratedFoundationFamily,
): ChannelInceptionCapability {
  const foundation = narratedPlanningFoundation(family);
  if (!foundation) throw new Error(`missing narrated channel-inception foundation for ${family}`);
  return Object.freeze({
    mode: "registered_non_gemini" as const,
    id: foundation.inception.id,
    provenance: foundation.inception.provenance,
    coveredStages: foundation.inception.coveredStages,
  });
}

/**
 * This is intentionally a partial map.  The default is fail-closed so adding
 * a non-Gemini episode planner cannot accidentally make channel inception
 * available. QuizYear is the first fully wired route: its source-first,
 * draft-only foundation deliberately returns before the generic creator's
 * provider-backed research, art, and starter-plan stages.
 */
const EXPLICIT_CHANNEL_INCEPTION_CAPABILITIES: Readonly<
  Partial<Record<FamilyKey, ChannelInceptionCapability>>
> = Object.freeze({
  narrated_stock: registeredNarratedChannelInceptionCapability("narrated_stock"),
  sleep: registeredNarratedChannelInceptionCapability("sleep"),
  shorts: registeredNarratedChannelInceptionCapability("shorts"),
  quizyear: Object.freeze({
    mode: "registered_non_gemini" as const,
    id: "quizyear-deterministic-channel-foundation/v1",
    provenance:
      "profile-bound local SVG brand assets plus a CC0 Wikidata source-first starter slate; all artifacts are content-addressed and verified before the channel remains draft-only",
    coveredStages: Object.freeze([
      "deterministic-positioning",
      "local-avatar-and-banner",
      "source-first-starter-slate",
      "immutable-artifact-persistence",
      "draft-only-publication-state",
    ]),
  }),
  illustrated_explainer: Object.freeze({
    mode: "registered_non_gemini" as const,
    id: "illustrated-explainer-deterministic-channel-foundation/v1",
    provenance:
      "profile-bound local SVG scenario-board brand assets plus an explicit fictional/no-external-claims starter slate; every artifact is content-addressed and verified before the channel remains draft-only",
    coveredStages: Object.freeze([
      "deterministic-positioning",
      "local-avatar-and-banner",
      "fictional-no-external-claims-starter-slate",
      "immutable-artifact-persistence",
      "draft-only-publication-state",
    ]),
  }),
});

const CHILDREN_SUPERVISED_CHANNEL_ADMISSION: RegisteredSupervisedNonGeminiChannelAdmission = Object.freeze({
  mode: "registered_supervised_non_gemini" as const,
  id: "children-show-bible-private-review/v1",
  provenance:
    "the local children_show_bible admission validates an operator-supplied original, age-banded Show Bible and fingerprint-bound child-editor receipt; it emits only a private review receipt",
  coveredStages: Object.freeze([
    "age-banded-original-show-bible",
    "episode-graph-and-learning-contract-binding",
    "fresh-human-child-editor-approval",
    "private-review-only-receipt",
  ]),
  reviewScope: "private_human_child_editor_review_only" as const,
  requiredArtifacts: Object.freeze([
    "age-banded original Children’s Show Bible",
    "one observable learning objective and assessment",
    "fresh child-editor approval bound to the Show Bible, Episode Graph, and lesson contract",
  ]),
});

const CASEFILE_SUPERVISED_CHANNEL_ADMISSION: RegisteredSupervisedNonGeminiChannelAdmission = Object.freeze({
  mode: "registered_supervised_non_gemini" as const,
  id: "casefile-cinematic-private-review/v1",
  provenance:
    "the Casefile desk locally advances an operator-supplied source packet through evidence-to-shot mapping and an editor-reviewed faceless cinematic sequence; it cannot render, spend, or publish",
  coveredStages: Object.freeze([
    "source-first-case-packet",
    "claim-to-source-to-shot-evidence-map",
    "faceless-mannequin-cinematic-sequence-review",
    "private-render-package-only",
  ]),
  reviewScope: "private_human_review_only" as const,
  requiredArtifacts: Object.freeze([
    "source-first Case Packet",
    "claim-to-source-to-shot evidence map",
    "current human editorial approval for the factual cinematic sequence",
  ]),
  reviewHref: "/casefile",
});

/**
 * Returns the independently admitted creator capability for a family.  The
 * episode planner registry deliberately does not satisfy this contract.
 */
export function familyChannelInceptionCapability(family: FamilyKey): ChannelInceptionCapability {
  return EXPLICIT_CHANNEL_INCEPTION_CAPABILITIES[family] ?? DEFAULT_UNREGISTERED;
}

/**
 * Returns a selectable private-review admission only when the caller has
 * identified the exact supervised route. In particular, the cinematic
 * registration applies to factual Casefile work, never all cinematic concepts.
 */
export function familySupervisedChannelInceptionCapability(
  family: FamilyKey,
  options: { casefileCinematic?: boolean } = {},
): RegisteredSupervisedNonGeminiChannelAdmission | undefined {
  if (family === "children_learning") return CHILDREN_SUPERVISED_CHANNEL_ADMISSION;
  if (family === "cinematic" && options.casefileCinematic) return CASEFILE_SUPERVISED_CHANNEL_ADMISSION;
  return undefined;
}
