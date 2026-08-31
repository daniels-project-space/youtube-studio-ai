/**
 * Declarative creative-capability catalog.
 *
 * A channel family owns its base visual lane. Capabilities are smaller,
 * reusable overlays: source-attributed data storytelling, a supervised
 * Casefile intake, or a supervised children's-show intake. Keeping their
 * discovery, admission, selection semantics, and pipeline obligations here
 * prevents the creator, API, and compiler from each growing a separate
 * `if (block === ...)` branch.
 *
 * This file is deliberately server-safe metadata. It must never import the
 * executable block registry or a provider runtime; the authorized designer is
 * still the only place that compiles a runnable pipeline and reserves spend.
 */
import { MODULE_CONTRACTS } from "../moduleContracts";
import type { FamilyKey } from "../families";
import type { PipelineEntry } from "../types";
import {
  SOURCE_ATTRIBUTED_DATA_STORY,
  dataStoryInsertParams,
  dataStoryRecommendationForIntent,
  type DataStoryContract,
} from "../dataStory";

// Bump whenever an offer changes so a cached browser cannot submit a selection
// against a less restrictive catalog.
export const CREATIVE_CAPABILITY_CATALOG_VERSION = "creative-capability-catalog/v4" as const;

export type CreativeCapabilityKey =
  | "source_attributed_data_story"
  | "editorial_evidence_packet"
  | "casefile_cinematic"
  | "children_show_bible";

export type CreativeCapabilitySelectionMode = "explicit_opt_in" | "private_review_only";

export interface CreativeCapabilityIntent {
  concept?: string;
  niche?: string;
  nicheKey?: string;
  audience?: string;
  sampleTopics?: readonly string[];
}

/**
 * This is the only client-to-server capability reference. The server always
 * recomputes eligibility from the current catalog; the fingerprint catches a
 * stale browser offer before it can become a hidden pipeline mutation.
 */
export interface CreativeCapabilitySelection {
  capability: CreativeCapabilityKey;
  catalogFingerprint: string;
}

export interface CreativeCapabilityModule {
  block: string;
  profile: string;
  contract?: DataStoryContract;
  /** A capability may give individual review stages more specific remediation. */
  automationAdmission?: CreativeCapabilityAdmission;
  requirements: readonly string[];
  qualityFocus: readonly string[];
}

export interface CreativeCapabilityAdmission {
  autonomous: boolean;
  blockers: readonly string[];
  remediation: string;
}

export interface CreativeCapabilityPipelineObligation {
  block: string;
  /** Required key/value subset on the effective compiled block. */
  params?: Readonly<Record<string, unknown>>;
}

/**
 * A Show Profile retry may first apply its sealed composition compatibility
 * fence. That fence—not the current generic offer—is authoritative for
 * versioned operations such as the Phase-I Episode Graph.
 */
export interface CreativeCapabilityPipelineObligationValidationOptions {
  readonly deferMaterializationOwnedObligations?: boolean;
}

export interface CreativeCapabilityOffer {
  capability: CreativeCapabilityKey;
  title: string;
  description: string;
  selectionMode: CreativeCapabilitySelectionMode;
  /** A private-review link is informational only; it is never a render authority. */
  reviewHref?: string;
  modules: readonly CreativeCapabilityModule[];
  automationAdmission: CreativeCapabilityAdmission;
  requirements: readonly string[];
  qualityFocus: readonly string[];
  /**
   * Exact effective-pipeline evidence required if this capability is selected.
   * Review-only capabilities intentionally have no automatic compiler path.
   */
  pipelineObligations: readonly CreativeCapabilityPipelineObligation[];
}

export interface CreativeCapabilityDefinition {
  capability: CreativeCapabilityKey;
  supportedFamilies: readonly FamilyKey[];
  selectionMode: CreativeCapabilitySelectionMode;
  /**
   * An explicit reference to the V8-safe, versioned composition fragment the
   * capability owns when selected. The fragment itself is sealed in the
   * composition catalog so durable retry validation need not import this rich
   * creator catalog. It does not grant automated build or release authority.
   */
  compositionFragmentVersion?: string;
  matches: (intent: CreativeCapabilityIntent, family: FamilyKey) => boolean;
  /**
   * Explicit opt-in for reporting an otherwise-unhosted private-review intent
   * at a cross-family admission boundary. It never creates a selection.
   */
  crossFamilySafetyGate?: (intent: CreativeCapabilityIntent) => boolean;
  materialize: (intent: CreativeCapabilityIntent, family: FamilyKey) => CreativeCapabilityOffer;
}

/** A selected capability resolved from the current server-owned catalog. */
export interface ResolvedCreativeCapabilitySelection {
  selection: CreativeCapabilitySelection;
  offer: CreativeCapabilityOffer;
  /**
   * The capability's declared composition-fragment version.  Keep this next
   * to the resolved selection so composition callers cannot silently resolve
   * an unrelated current fragment after the creator catalog changes.
   */
  compositionFragmentVersion?: string;
}

/**
 * A single materialized admission layer that prevents automatic channel
 * creation. Capabilities own the default admission; an individual module may
 * make that admission stricter for a specific review stage.
 */
export interface CreativeCapabilityAutomaticBuildBlocker {
  selection: CreativeCapabilitySelection;
  offer: CreativeCapabilityOffer;
  admission: CreativeCapabilityAdmission;
  /** Omitted when the capability-level admission is the blocking layer. */
  block?: string;
}

/**
 * Server-safe result for the boundary that may reserve spend or dispatch a
 * build. Selection eligibility and automatic-build eligibility are separate:
 * an explicit opt-in can legitimately compile as a draft while still being
 * barred from an automatic paid run until its evidence admission is ready.
 */
export interface CreativeCapabilityAutomaticBuildAdmission {
  autonomous: boolean;
  blockers: readonly CreativeCapabilityAutomaticBuildBlocker[];
}

/**
 * A supervised/private-review route whose intent matches an existing catalog
 * capability, but whose selected family cannot host that capability. This is
 * diagnostic only: it carries no selection and enables no pipeline modules.
 */
export interface UnhostedSupervisedCreativeCapabilityIntent {
  kind: "unhosted_supervised_intent";
  selectedFamily: FamilyKey;
  compatibleFamilies: readonly FamilyKey[];
  offer: CreativeCapabilityOffer;
}

const CASEFILE_CINEMATIC_SIGNALS = [
  "true crime",
  "casefile",
  "cold case",
  "missing person",
  "missing people",
  "murder",
  "homicide",
  "criminal investigation",
  "crime investigation",
  "real crime",
  "historical crime",
  "factual reconstruction",
  "documentary reconstruction",
  // The Casefile evidence chain is not crime-specific. These are all existing
  // supervised Casefile kinds; exposing them here expands discovery without
  // inventing a renderer or relaxing source/editorial admission.
  "systems failure",
  "system failure",
  "engineering failure",
  "industrial disaster",
  "historical disaster",
  "aviation disaster",
  "aviation accident",
  "financial fraud",
  "corporate fraud",
  "company scandal",
  "corporate scandal",
] as const;

const CASEFILE_SOURCE_REQUIREMENTS = [
  "source-first Case Packet",
  "one allowed primary-source URL and provenance record per factual claim",
  "exhaustive source-asset usage and rights-basis ledger",
  "fresh fingerprint-bound human editorial approval",
] as const;

const CASEFILE_SHOT_MAP_REQUIREMENTS = [
  "admitted Casefile source packet",
  "claim-to-source-to-scene-to-shot coverage map with a fresh reviewer signature",
] as const;

const CASEFILE_SEQUENCE_REQUIREMENTS = [
  "admitted evidence-shot map",
  "reviewer-signed causal multi-shot sequence with faceless mannequin wardrobe, prop, era, and location continuity locks",
] as const;

const EDITORIAL_EVIDENCE_PACKET_SIGNALS = [
  "factual explainer",
  "fact based",
  "fact-based",
  "source based",
  "source-based",
  "source led",
  "source-led",
  "evidence based",
  "evidence-led",
  "research-backed",
  "historical",
  "history",
  "geography",
  "science",
  "scientific",
  "how it works",
  "real world",
  "real-world",
  "systems explained",
  "data driven",
  "data-driven",
  "statistics",
  "documentary",
  "true story",
  "biography",
] as const;

const EDITORIAL_EVIDENCE_PACKET_REQUIREMENTS = [
  "reviewed Editorial Evidence Packet with named sources, approved claims, and immutable source snapshots",
  "fresh human-editorial approval bound to the packet fingerprint",
  "reviewed map, chart, or factual visual manifests bound to the same source URL and snapshot before Episode Graph compilation",
] as const;

const CHILDREN_SHOW_REQUIREMENTS = [
  "age-banded original Children’s Show Bible",
  "one observable learning objective and assessment",
  "original recurring-character and world continuity locks with no IP-adjacent identity",
  "five-stage familiar-problem → guided-attempt → participation → resolution-recall → varied-repetition pattern",
  "fresh child-editor approval bound to the Show Bible, Episode Graph, and lesson contract",
] as const;

const CHILDREN_AUDIENCE_SIGNAL = /\b(?:children|child|kids|kid|preschool|toddler|kindergarten)\b/u;
const CHILDREN_SHOW_SIGNAL = /\b(?:show|series|episode|learning|education|educational|phonics|language|participation|nursery)\b/u;

function normalizedIntent(input: CreativeCapabilityIntent): string {
  return [
    input.concept,
    input.niche,
    input.nicheKey?.replace(/[_-]+/g, " "),
    input.audience,
    ...(input.sampleTopics ?? []),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLocaleLowerCase()
    .replace(/[_-]+/g, " ");
}

/** Shared by the advisor and source requirement gate so factual fiction stays distinct. */
export function isCasefileCinematicIntent(
  input: CreativeCapabilityIntent,
  family: FamilyKey,
): boolean {
  if (family !== "cinematic") return false;
  return isCasefileSupervisedIntent(input);
}

function isCasefileSupervisedIntent(input: CreativeCapabilityIntent): boolean {
  const intent = normalizedIntent(input);
  if (/\b(fictional|fiction|screenplay|original story)\b/.test(intent)) return false;
  return CASEFILE_CINEMATIC_SIGNALS.some((signal) => intent.includes(signal));
}

/**
 * Factual illustrated work is deliberately distinct from the existing
 * fictional/no-external-claims illustrated lane. It may use the same local
 * scene compiler only after a reviewer has bound its factual visual inputs.
 */
export function isReviewedFactualIllustratedExplainerIntent(
  input: CreativeCapabilityIntent,
  family: FamilyKey,
): boolean {
  if (family !== "illustrated_explainer") return false;
  const intent = normalizedIntent(input);
  if (/\b(fictional|fiction|original story|made up|made-up|hypothetical|thought experiment|scenario)\b/.test(intent)) {
    return false;
  }
  return EDITORIAL_EVIDENCE_PACKET_SIGNALS.some((signal) => intent.includes(signal));
}

function isChildrenShowBibleIntent(input: CreativeCapabilityIntent): boolean {
  const intent = normalizedIntent(input);
  return CHILDREN_AUDIENCE_SIGNAL.test(intent) && CHILDREN_SHOW_SIGNAL.test(intent);
}

function sourceAttributedDataStoryOffer(
  input: CreativeCapabilityIntent,
  family: FamilyKey,
): CreativeCapabilityOffer {
  // Selection validation and the designer intentionally do not need to repeat
  // a creator's prose. Use a canonical matching phrase only to recover the
  // data-story contract metadata; eligibility itself remains enforced by
  // `matches()` at the creator/API boundary.
  const recommendation = dataStoryRecommendationForIntent(input, family)[0]
    ?? dataStoryRecommendationForIntent({
      concept: "source-attributed data storytelling with animated charts",
    }, family)[0];
  if (!recommendation) {
    throw new Error("source-attributed data-story offer was materialized outside its declared eligibility");
  }
  const contract = recommendation.contract ?? SOURCE_ATTRIBUTED_DATA_STORY;
  const insertParams = dataStoryInsertParams(contract);
  return {
    capability: "source_attributed_data_story",
    title: "Source-attributed data story",
    description:
      "Chart-led statistics and comparisons with a named source and spoken numeric anchor for every rendered claim.",
    selectionMode: "explicit_opt_in",
    modules: [{
      block: recommendation.block,
      profile: recommendation.profile,
      contract,
      requirements: recommendation.requirements,
      qualityFocus: recommendation.qualityFocus,
    }],
    automationAdmission: recommendation.automationAdmission,
    requirements: recommendation.requirements,
    qualityFocus: recommendation.qualityFocus,
    pipelineObligations: [
      { block: "episode_graph" },
      { block: "timeline_assemble" },
      { block: "visual_inserts", params: insertParams },
      { block: "script_gen", params: { dataRich: true, sourceAttributionRequired: true } },
      {
        block: "qa_script",
        params: {
          dataStoryContract: contract.version,
          requireNamedSource: true,
          requireSpokenNumericAnchor: true,
        },
      },
    ],
  };
}

function editorialEvidencePacketOffer(): CreativeCapabilityOffer {
  const admission: CreativeCapabilityAdmission = {
    autonomous: false,
    blockers: ["Factual illustrated-explainer evidence admission is private human-editorial review only."],
    remediation:
      "Supply a reviewed Editorial Evidence Packet, then bind every factual map, chart, or visual to its exact source URL and immutable snapshot before Episode Graph compilation.",
  };
  return {
    capability: "editorial_evidence_packet",
    title: "Reviewed factual illustrated explainer",
    description:
      "A private factual-explainer intake: reviewed sources, claims, and immutable snapshots must bind the maps, charts, and scene evidence before the deterministic scene compiler is allowed to receive them.",
    selectionMode: "private_review_only",
    modules: [{
      block: "editorial_evidence_packet",
      profile: "editorial-evidence-packet/v1",
      automationAdmission: admission,
      requirements: EDITORIAL_EVIDENCE_PACKET_REQUIREMENTS,
      qualityFocus: ["factual source-to-visual traceability", "immutable snapshot integrity", "human-reviewed causal explanation"],
    }],
    automationAdmission: admission,
    requirements: EDITORIAL_EVIDENCE_PACKET_REQUIREMENTS,
    qualityFocus: ["factual source-to-visual traceability", "immutable snapshot integrity", "human-reviewed causal explanation"],
    reviewHref: "/editorial-evidence",
    // This is an editorial intake, not a compiler mutation. The packet is
    // supplied to the supervised episode-graph path only after review.
    pipelineObligations: [],
  };
}

function casefileCinematicOffer(): CreativeCapabilityOffer {
  const admission: CreativeCapabilityAdmission = {
    autonomous: false,
    blockers: ["Casefile source admission is private human-editorial review only."],
    remediation: "Supply the source-first packet and a current fingerprint-bound editorial approval.",
  };
  const modules: readonly CreativeCapabilityModule[] = [
    {
      block: "casefile_source_packet",
      profile: "source_first_casefile/v1",
      automationAdmission: admission,
      requirements: CASEFILE_SOURCE_REQUIREMENTS,
      qualityFocus: ["primary-source claim integrity", "rights-aware visual provenance"],
    },
    {
      block: "casefile_evidence_shot_map",
      profile: "claim_to_source_to_shot_map/v1",
      automationAdmission: {
        autonomous: false,
        blockers: ["Casefile evidence-to-shot mapping is private human-editorial review only."],
        remediation: "Bind every factual claim to admitted source, scene, and coverage shots, then obtain current map approval.",
      },
      requirements: CASEFILE_SHOT_MAP_REQUIREMENTS,
      qualityFocus: ["no unsupported visual reconstruction", "claim-to-shot traceability"],
    },
    {
      block: "cinematic_case_sequence",
      profile: "faceless_source_bound_cinematic_sequence/v1",
      automationAdmission: {
        autonomous: false,
        blockers: ["Cinematic Casefile sequences remain private human-review candidates, not automatic channel output."],
        remediation: "Approve a fingerprint-bound sequence with faceless cast, wardrobe, prop, era, and cut-continuity locks.",
      },
      requirements: CASEFILE_SEQUENCE_REQUIREMENTS,
      qualityFocus: ["causal tension-and-reveal edit", "faceless wardrobe continuity", "source-bound multi-shot coverage"],
    },
  ];
  return {
    capability: "casefile_cinematic",
    title: "Source-bound cinematic Casefile",
    description:
      "A factual reconstruction intake with claim-to-source-to-shot traceability and faceless continuity locks.",
    selectionMode: "private_review_only",
    reviewHref: "/casefile",
    modules,
    automationAdmission: admission,
    requirements: modules.flatMap((module) => module.requirements),
    qualityFocus: modules.flatMap((module) => module.qualityFocus),
    pipelineObligations: [],
  };
}

function childrenShowBibleOffer(): CreativeCapabilityOffer {
  const admission: CreativeCapabilityAdmission = {
    autonomous: false,
    blockers: ["Children’s show admission is private child-editorial review only."],
    remediation:
      "Supply an age-banded original Show Bible with one observable objective, five-stage participation pattern, and a current graph-and-lesson-bound child-editor approval.",
  };
  return {
    capability: "children_show_bible",
    title: "Original children’s Show Bible",
    description:
      "An age-banded, original learning-show intake with a measurable lesson, safe recurring world, and child-editor approval.",
    selectionMode: "private_review_only",
    modules: [{
      block: "children_show_bible",
      profile: "original_child_show_bible/v1",
      requirements: CHILDREN_SHOW_REQUIREMENTS,
      qualityFocus: ["age-appropriate causal learning", "original character/world continuity", "participation-and-recall rhythm"],
    }],
    automationAdmission: admission,
    requirements: CHILDREN_SHOW_REQUIREMENTS,
    qualityFocus: ["age-appropriate causal learning", "original character/world continuity", "participation-and-recall rhythm"],
    pipelineObligations: [],
  };
}

export const CREATIVE_CAPABILITY_CATALOG: readonly CreativeCapabilityDefinition[] = [
  {
    capability: "source_attributed_data_story",
    supportedFamilies: ["narrated_stock"],
    selectionMode: "explicit_opt_in",
    compositionFragmentVersion: "v2",
    matches: (intent, family) => dataStoryRecommendationForIntent(intent, family).length > 0,
    materialize: sourceAttributedDataStoryOffer,
  },
  {
    capability: "editorial_evidence_packet",
    supportedFamilies: ["illustrated_explainer"],
    selectionMode: "private_review_only",
    matches: isReviewedFactualIllustratedExplainerIntent,
    materialize: () => editorialEvidencePacketOffer(),
  },
  {
    capability: "casefile_cinematic",
    supportedFamilies: ["cinematic"],
    selectionMode: "private_review_only",
    matches: isCasefileCinematicIntent,
    crossFamilySafetyGate: isCasefileSupervisedIntent,
    materialize: () => casefileCinematicOffer(),
  },
  {
    capability: "children_show_bible",
    supportedFamilies: ["children_learning"],
    selectionMode: "private_review_only",
    matches: (_intent, family) => family === "children_learning",
    crossFamilySafetyGate: isChildrenShowBibleIntent,
    materialize: () => childrenShowBibleOffer(),
  },
] as const;

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * A deterministic content fingerprint, not an authorization signature. The
 * server recomputes eligibility and never trusts it as authority.
 */
export const CREATIVE_CAPABILITY_CATALOG_FINGERPRINT = `${CREATIVE_CAPABILITY_CATALOG_VERSION}:${fnv1a(
  JSON.stringify(CREATIVE_CAPABILITY_CATALOG.map((definition) => {
    const offer = definition.materialize(
      { concept: "source-attributed data storytelling with animated charts" },
      definition.supportedFamilies[0]!,
    );
    return {
      capability: definition.capability,
      supportedFamilies: definition.supportedFamilies,
      selectionMode: definition.selectionMode,
      compositionFragmentVersion: definition.compositionFragmentVersion,
      offer,
    };
  })),
)}`;

function definitionFor(capability: string): CreativeCapabilityDefinition | undefined {
  return CREATIVE_CAPABILITY_CATALOG.find((definition) => definition.capability === capability);
}

/** Resolve every capability the stated concept can honestly expose. */
export function resolveCreativeCapabilities(
  input: CreativeCapabilityIntent,
  family: FamilyKey,
): CreativeCapabilityOffer[] {
  assertCreativeCapabilityCatalog();
  return CREATIVE_CAPABILITY_CATALOG
    .filter((definition) => definition.supportedFamilies.includes(family))
    .filter((definition) => definition.matches(input, family))
    .map((definition) => definition.materialize(input, family));
}

/**
 * A review-only offer is an intake destination, never an executable selected
 * capability. Keeping the classification here lets every caller use the
 * same catalog rule instead of re-identifying Casefile/children modules by
 * profile string.
 */
export function privateReviewCapabilityOffers(
  offers: readonly CreativeCapabilityOffer[],
): CreativeCapabilityOffer[] {
  return offers.filter((offer) => offer.selectionMode === "private_review_only");
}

/**
 * Discover supervised intent that the chosen family cannot host. Every
 * declared compatible family is evaluated so this guard cannot be bypassed by
 * choosing a generic family; it only reports an existing private-review route
 * and never creates a capability selection or pipeline obligation.
 */
export function resolveUnhostedSupervisedCreativeCapabilityIntents(
  input: CreativeCapabilityIntent,
  selectedFamily: FamilyKey,
): UnhostedSupervisedCreativeCapabilityIntent[] {
  assertCreativeCapabilityCatalog();
  return CREATIVE_CAPABILITY_CATALOG
    .filter(
      (definition) => definition.selectionMode === "private_review_only" && definition.crossFamilySafetyGate,
    )
    .filter((definition) => !definition.supportedFamilies.includes(selectedFamily))
    .flatMap((definition) => {
      if (!definition.crossFamilySafetyGate!(input)) return [];
      const compatibleFamilies = definition.supportedFamilies.filter(
        (family) => definition.matches(input, family),
      );
      if (!compatibleFamilies.length) return [];
      return [{
        kind: "unhosted_supervised_intent" as const,
        selectedFamily,
        compatibleFamilies,
        offer: definition.materialize(input, compatibleFamilies[0]!),
      }];
    });
}

export function creativeCapabilitySelection(
  capability: CreativeCapabilityKey,
): CreativeCapabilitySelection {
  return { capability, catalogFingerprint: CREATIVE_CAPABILITY_CATALOG_FINGERPRINT };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Strict parser at the HTTP boundary; unknown fields are not executable authority. */
export function parseCreativeCapabilitySelections(value: unknown): CreativeCapabilitySelection[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("capabilitySelections must be an array");
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`capabilitySelections[${index}] must be an object`);
    const capability = entry.capability;
    const catalogFingerprint = entry.catalogFingerprint;
    if (typeof capability !== "string" || !capability.trim()) {
      throw new Error(`capabilitySelections[${index}].capability is required`);
    }
    if (typeof catalogFingerprint !== "string" || !catalogFingerprint.trim()) {
      throw new Error(`capabilitySelections[${index}].catalogFingerprint is required`);
    }
    if (seen.has(capability)) throw new Error(`capabilitySelections repeats ${capability}`);
    seen.add(capability);
    return {
      capability: capability as CreativeCapabilityKey,
      catalogFingerprint,
    };
  });
}

export interface ValidateCreativeCapabilitySelectionsInput {
  family: FamilyKey;
  selections: unknown;
  /** Pass the original creator input to require a current matching offer. */
  intent?: CreativeCapabilityIntent;
}

/**
 * Validates a creator's selected capability against current catalog shape,
 * family compatibility, freshness, and—when present—the stated channel intent.
 * Private-review capabilities deliberately cannot enter an automatic build.
 */
export function validateCreativeCapabilitySelections(
  input: ValidateCreativeCapabilitySelectionsInput,
): ResolvedCreativeCapabilitySelection[] {
  assertCreativeCapabilityCatalog();
  const selections = parseCreativeCapabilitySelections(input.selections);
  return selections.map((selection) => {
    if (selection.catalogFingerprint !== CREATIVE_CAPABILITY_CATALOG_FINGERPRINT) {
      throw new Error(`capability ${selection.capability} uses a stale creative-capability catalog fingerprint`);
    }
    const definition = definitionFor(selection.capability);
    if (!definition) throw new Error(`unknown creative capability: ${selection.capability}`);
    if (!definition.supportedFamilies.includes(input.family)) {
      throw new Error(`creative capability ${selection.capability} is not eligible for ${input.family}`);
    }
    if (definition.selectionMode !== "explicit_opt_in") {
      const reviewOffer = definition.materialize(input.intent ?? {}, input.family);
      throw new Error(
        `${selection.capability} is private review only${reviewOffer.reviewHref ? `; use ${reviewOffer.reviewHref}` : ""}`,
      );
    }
    if (input.intent && !definition.matches(input.intent, input.family)) {
      throw new Error(`creative capability ${selection.capability} is not eligible for the stated channel concept`);
    }
    return {
      selection,
      offer: definition.materialize(input.intent ?? {}, input.family),
      ...(definition.compositionFragmentVersion === undefined
        ? {}
        : { compositionFragmentVersion: definition.compositionFragmentVersion }),
    };
  });
}

/**
 * Resolve the declared fragment-version contract for automatic capability
 * selections.  The composition catalog remains V8-safe and does not import
 * this rich creator catalog, so callers pass these exact bindings into its
 * sealed-plan resolver rather than allowing a mutable "current" lookup to
 * become an untracked source of authority.
 */
export function creativeCapabilityCompositionFragmentVersionBindings(
  resolved: readonly ResolvedCreativeCapabilitySelection[],
): Readonly<Record<string, string>> {
  const bindings: Record<string, string> = {};
  for (const { selection, compositionFragmentVersion } of resolved) {
    if (!compositionFragmentVersion) {
      throw new Error(
        `creative capability ${selection.capability} has no declared composition fragment version`,
      );
    }
    bindings[selection.capability] = compositionFragmentVersion;
  }
  return bindings;
}

/**
 * Decides whether the already-resolved selected capabilities may cross the
 * automatic build boundary. This deliberately evaluates materialized
 * admissions rather than selectionMode: explicit opt-in means a creator may
 * request the capability, not that it may reserve spend or dispatch a task.
 *
 * Modules only add a blocker when they explicitly tighten the offer-level
 * admission. Modules without an override inherit the offer admission and must
 * not produce duplicate remediation entries.
 */
export function assessCreativeCapabilityAutomaticBuildAdmission(
  resolved: readonly ResolvedCreativeCapabilitySelection[],
): CreativeCapabilityAutomaticBuildAdmission {
  const blockers: CreativeCapabilityAutomaticBuildBlocker[] = [];
  for (const item of resolved) {
    if (!item.offer.automationAdmission.autonomous) {
      blockers.push({
        selection: item.selection,
        offer: item.offer,
        admission: item.offer.automationAdmission,
      });
    }
    for (const creativeModule of item.offer.modules) {
      if (creativeModule.automationAdmission && !creativeModule.automationAdmission.autonomous) {
        blockers.push({
          selection: item.selection,
          offer: item.offer,
          admission: creativeModule.automationAdmission,
          block: creativeModule.block,
        });
      }
    }
  }
  return { autonomous: blockers.length === 0, blockers };
}

function matchesRequiredParams(
  actual: Readonly<Record<string, unknown>> | undefined,
  expected: Readonly<Record<string, unknown>> | undefined,
): boolean {
  if (!expected) return true;
  if (!actual) return false;
  return Object.entries(expected).every(([key, value]) => {
    const candidate = actual[key];
    return Array.isArray(value)
      ? Array.isArray(candidate) && candidate.length === value.length && candidate.every((item, index) => item === value[index])
      : candidate === value;
  });
}

/**
 * Proves a selected opt-in is represented by the effective compiled pipeline,
 * rather than merely being displayed as an advisor suggestion.
 */
export function assertResolvedCreativeCapabilityPipelineObligations(
  resolved: readonly ResolvedCreativeCapabilitySelection[],
  pipeline: readonly Pick<PipelineEntry, "block" | "params">[],
  options: CreativeCapabilityPipelineObligationValidationOptions = {},
): void {
  for (const { selection, offer } of resolved) {
    for (const obligation of offer.pipelineObligations) {
      // This operation was introduced by the sealed v4 source-data
      // materialization. Historical v1-v3 receipts must prove only their own
      // materialization below; a current/new capability selection keeps the
      // default generic requirement and the v4 plan independently proves it.
      if (
        options.deferMaterializationOwnedObligations &&
        selection.capability === "source_attributed_data_story" &&
        obligation.block === "episode_graph"
      ) {
        continue;
      }
      const entry = pipeline.find((candidate) => candidate.block === obligation.block);
      if (!entry) {
        throw new Error(
          `creative capability ${selection.capability} requires effective pipeline block ${obligation.block}`,
        );
      }
      if (!matchesRequiredParams(entry.params, obligation.params)) {
        throw new Error(
          `creative capability ${selection.capability} has incomplete effective pipeline evidence at ${obligation.block}`,
        );
      }
    }
  }
}

export function assertCreativeCapabilityPipelineObligations(
  family: FamilyKey,
  selections: readonly CreativeCapabilitySelection[],
  pipeline: readonly Pick<PipelineEntry, "block" | "params">[],
): void {
  assertResolvedCreativeCapabilityPipelineObligations(
    validateCreativeCapabilitySelections({ family, selections }),
    pipeline,
  );
}

/** Catalog integrity is checked before discovery and selection validation. */
export function assertCreativeCapabilityCatalog(
  catalog: readonly CreativeCapabilityDefinition[] = CREATIVE_CAPABILITY_CATALOG,
): void {
  const seen = new Set<string>();
  for (const definition of catalog) {
    if (seen.has(definition.capability)) throw new Error(`duplicate creative capability: ${definition.capability}`);
    seen.add(definition.capability);
    if (!definition.supportedFamilies.length) {
      throw new Error(`creative capability ${definition.capability} supports no channel family`);
    }
    for (const family of definition.supportedFamilies) {
      if (typeof family !== "string" || !family) {
        throw new Error(`creative capability ${definition.capability} has an invalid family`);
      }
    }
    // Materialize against its first declared family solely to validate static
    // block obligations. A matcher may be false for an empty intent; that is
    // irrelevant to whether the declarative module names exist.
    const offer = definition.materialize({}, definition.supportedFamilies[0]!);
    for (const block of [
      ...offer.modules.map((module) => module.block),
      ...offer.pipelineObligations.map((obligation) => obligation.block),
    ]) {
      if (!MODULE_CONTRACTS[block as keyof typeof MODULE_CONTRACTS]) {
        throw new Error(`creative capability ${definition.capability} declares unknown pipeline block ${block}`);
      }
    }
    if (definition.selectionMode === "private_review_only" && offer.pipelineObligations.length) {
      throw new Error(`private-review capability ${definition.capability} cannot declare an automatic pipeline path`);
    }
    if (
      definition.compositionFragmentVersion !== undefined &&
      (
        !definition.compositionFragmentVersion ||
        definition.selectionMode !== "explicit_opt_in"
      )
    ) {
      throw new Error(
        `creative capability ${definition.capability} cannot expose an autonomous composition fragment`,
      );
    }
    if (definition.crossFamilySafetyGate && definition.selectionMode !== "private_review_only") {
      throw new Error(`cross-family safety gate ${definition.capability} must be private review only`);
    }
    if (definition.selectionMode !== offer.selectionMode) {
      throw new Error(`creative capability ${definition.capability} materialized an inconsistent selection mode`);
    }
  }
}

/** The catalog owns the canonical data-story contract used by the compiler adapter. */
export function selectedDataStoryContract(
  selections: readonly CreativeCapabilitySelection[],
): DataStoryContract | undefined {
  return selections.some((selection) => selection.capability === "source_attributed_data_story")
    ? SOURCE_ATTRIBUTED_DATA_STORY
    : undefined;
}

/** Exported for focused tests and migration audits. */
export const CREATIVE_CAPABILITY_CATALOG_KEYS = CREATIVE_CAPABILITY_CATALOG.map(
  (definition) => definition.capability,
) as readonly CreativeCapabilityKey[];
