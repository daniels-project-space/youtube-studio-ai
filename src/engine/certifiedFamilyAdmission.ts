import {
  CERTIFIED_CHANNEL_COMPOSITIONS,
} from "./channelCompositionCatalog";
import {
  CERTIFIED_CHANNEL_PROGRAM_ROUTE_DEFINITIONS,
} from "./channelProgramRoute";
import {
  familyChannelInceptionCapability,
  familySupervisedChannelInceptionCapability,
} from "./channelInceptionCapability";
import {
  assertVisualMatterReferenceAdmissionCatalog,
  CONTENT_LANE_BY_FAMILY,
} from "./contentLane";
import {
  FAMILY_KEYS,
  FAMILY_RUNTIME_PIPELINE,
  familyProductionReadiness,
  type FamilyKey,
} from "./families";
import {
  assertReferenceQualityContracts,
  referenceQualityContractFor,
} from "./creative/referenceQuality";
import { hasProductionEditorialPolicy } from "./qualityEvidence";
import {
  assessPipelineVideoRuntimeReadiness,
  type NovitaVideoRuntimeTarget,
} from "./runtimeCapability";

/**
 * A production-ready family is a claim across several independently-owned
 * catalogs. Keep the approved automatic surface deliberately small and
 * explicit: adding a family or route requires a reviewable declaration here,
 * rather than silently inheriting a green readiness bit.
 */
export const CERTIFIED_FAMILY_ADMISSION_VERSION = "certified-family-admission/v1" as const;

interface CertifiedAutomaticFamilyAdmissionDefinition {
  readonly family: FamilyKey;
  readonly contentLane: string;
  /** Every current automatic program route for this family. */
  readonly routeKeys: readonly string[];
  /** Immutable no-capability baseline composition identity for the family. */
  readonly composition: Readonly<{ key: string; definitionVersion: string }>;
}

export const CERTIFIED_AUTOMATIC_FAMILY_ADMISSION_DEFINITIONS = [
  {
    family: "narrated_stock",
    contentLane: "narrated_documentary",
    routeKeys: ["narrated-stock/foundation/v1"],
    composition: { key: "narrated_visual_essay", definitionVersion: "v1" },
  },
  {
    family: "sleep",
    contentLane: "ambient_guided",
    routeKeys: ["sleep/foundation/v1"],
    composition: { key: "guided_relaxation", definitionVersion: "v1" },
  },
  {
    family: "music_loop",
    contentLane: "music_loop",
    routeKeys: ["music-loop/foundation/v1"],
    composition: { key: "original_music_loop", definitionVersion: "v1" },
  },
  {
    family: "comic",
    contentLane: "motion_comic",
    routeKeys: ["comic/foundation/v1"],
    composition: { key: "motion_comic_storytelling", definitionVersion: "v1" },
  },
  {
    family: "shorts",
    contentLane: "short_form",
    routeKeys: ["shorts/foundation/v1"],
    composition: { key: "vertical_micro_explainer", definitionVersion: "v1" },
  },
  {
    family: "cinematic",
    contentLane: "cinematic_ai",
    routeKeys: ["cinematic/foundation/v1"],
    composition: { key: "cinematic_visual_control_story", definitionVersion: "v1" },
  },
  {
    family: "whiteboard",
    contentLane: "whiteboard_explainer",
    routeKeys: ["whiteboard/foundation/v1"],
    composition: { key: "drawn_whiteboard_explainer", definitionVersion: "v1" },
  },
  {
    family: "loreshort",
    contentLane: "lore_micro_doc",
    routeKeys: ["loreshort/foundation/v1"],
    composition: { key: "lore_micro_documentary", definitionVersion: "v1" },
  },
  {
    family: "quizyear",
    contentLane: "quiz_year",
    routeKeys: [
      "quizyear/certified-profile/v1",
      "quizyear/sports-championship-timeline/v1",
    ],
    composition: { key: "interactive_curated_trivia", definitionVersion: "v1" },
  },
  {
    family: "illustrated_explainer",
    contentLane: "illustrated_explainer",
    routeKeys: [
      "illustrated-explainer/foundation/v1",
      "illustrated-explainer/fictional-decision-lab/v1",
      "illustrated-explainer/fictional-ai-town/v1",
      "illustrated-explainer/fictional-ai-pov/v1",
    ],
    composition: { key: "illustrated_original_explainer", definitionVersion: "v1" },
  },
] as const satisfies readonly CertifiedAutomaticFamilyAdmissionDefinition[];

export type CertifiedFamilyAdmissionMode = "automatic" | "supervised" | "blocked";

export interface CertifiedFamilyAdmission {
  readonly version: typeof CERTIFIED_FAMILY_ADMISSION_VERSION;
  readonly family: FamilyKey;
  readonly contentLane: string;
  readonly mode: CertifiedFamilyAdmissionMode;
  /** The only value that permits automatic new-channel inception at this boundary. */
  readonly automatic: boolean;
  readonly routeKeys: readonly string[];
  readonly compositionKey?: string;
  readonly checks: Readonly<{
    productionReadiness: boolean;
    route: boolean;
    composition: boolean;
    inception: boolean;
    editorialPolicy: boolean;
    /** A sealed, mechanics-only quality benchmark must exist before automatic production. */
    referenceQuality: boolean;
    runtime: boolean;
  }>;
  readonly blockers: readonly string[];
  readonly remediation?: string;
  readonly reviewScope?: "private_human_review_only" | "private_human_child_editor_review_only";
}

/**
 * A reviewed runtime can only complete an otherwise fully registered family.
 * This lets channel inception defer the one owner-scoped runtime lookup for
 * candidates such as cinematic, while rejecting every missing route,
 * composition, inception, quality, or reference contract before it touches
 * owner/provider infrastructure.
 */
export function certifiedFamilyAdmissionCanAwaitRuntimeEvidence(
  admission: CertifiedFamilyAdmission,
): boolean {
  return !admission.automatic
    && !admission.checks.runtime
    && admission.checks.route
    && admission.checks.composition
    && admission.checks.inception
    && admission.checks.editorialPolicy
    && admission.checks.referenceQuality;
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length
    && sortedLeft.every((value, index) => value === sortedRight[index]);
}

function automaticDefinitionFor(
  family: FamilyKey,
): CertifiedAutomaticFamilyAdmissionDefinition | undefined {
  return CERTIFIED_AUTOMATIC_FAMILY_ADMISSION_DEFINITIONS.find((definition) => definition.family === family);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}

/**
 * Materialize the provider-free cross-check for one family. A supervised
 * capability is surfaced as a useful creator destination, but never becomes
 * automatic merely because it has a route or an available renderer.
 */
/**
 * Static callers stay fail-closed on the locked runtime. Only a server-derived,
 * owner-reviewed target may satisfy the independent runtime check.
 */
export function certifiedFamilyAdmission(
  family: FamilyKey,
  runtimeTarget?: NovitaVideoRuntimeTarget,
): CertifiedFamilyAdmission {
  const definition = automaticDefinitionFor(family);
  const readiness = familyProductionReadiness(family, runtimeTarget);
  const runtime = assessPipelineVideoRuntimeReadiness(FAMILY_RUNTIME_PIPELINE[family], runtimeTarget);
  const inception = familyChannelInceptionCapability(family);
  const contentLane = CONTENT_LANE_BY_FAMILY[family];
  const actualRouteKeys = CERTIFIED_CHANNEL_PROGRAM_ROUTE_DEFINITIONS
    .filter((route) => route.family === family)
    .map((route) => route.key);
  const composition = definition
    ? CERTIFIED_CHANNEL_COMPOSITIONS.find(
        (candidate) => candidate.key === definition.composition.key
          && candidate.definitionVersion === definition.composition.definitionVersion,
      )
    : undefined;
  const routeMatches = Boolean(
    definition
    && sameMembers(actualRouteKeys, definition.routeKeys)
    && actualRouteKeys.length > 0,
  );
  const compositionMatches = Boolean(
    definition
    && composition
    && composition.family === family
    && composition.requiredCapabilityKeys.length === 0,
  );
  const inceptionMatches = inception.mode === "registered_non_gemini";
  // Quality-policy availability and automatic-admission registration are
  // distinct facts. A blocked family can already have a real final-release
  // policy; reporting that it does not obscures the actual missing route /
  // composition / inception evidence an operator must supply.
  const editorialPolicyAvailable = hasProductionEditorialPolicy(contentLane);
  const editorialPolicyMatches = Boolean(
    editorialPolicyAvailable
    && (!definition || definition.contentLane === contentLane),
  );
  // Quality policies define release safety. Reference-quality contracts define
  // the positive, transferable standard the automatic system must meet. Keep
  // them independent: a family cannot become automatic merely because it has
  // a generic editorial policy.
  let referenceQualityMatches = false;
  try {
    assertReferenceQualityContracts();
    const referenceQuality = referenceQualityContractFor(family);
    referenceQualityMatches = referenceQuality.calibration === "calibrated"
      && referenceQuality.sources.length > 0
      && referenceQuality.requirements.length > 0
      && referenceQuality.unresolvedAreas.length === 0;
  } catch {
    // A malformed static contract is an admission failure, not a UI/runtime
    // exception that could bypass the creator's fail-closed path.
    referenceQualityMatches = false;
  }

  const checks = Object.freeze({
    productionReadiness: readiness.productionReady,
    route: routeMatches,
    composition: compositionMatches,
    inception: inceptionMatches,
    editorialPolicy: editorialPolicyMatches,
    referenceQuality: referenceQualityMatches,
    runtime: runtime.ready,
  });
  const blockers = unique([
    ...readiness.blockers,
    ...(!definition
      ? [
          `${family} has no explicit CertifiedFamilyAdmission definition; register one only after its route, composition, inception, and runtime evidence agree.`,
        ]
      : []),
    ...(definition && !routeMatches
      ? [`${family} automatic program routes do not exactly match its CertifiedFamilyAdmission declaration.`]
      : []),
    ...(definition && !compositionMatches
      ? [`${family} has no matching current baseline certified composition.`]
      : []),
    ...(!inceptionMatches
      ? [`${family} has no registered non-Gemini channel-inception capability.`]
      : []),
    ...(!editorialPolicyAvailable
      ? [`${family} content lane ${contentLane} has no matching production editorial quality gate.`]
      : []),
    ...(!referenceQualityMatches
      ? [`${family} has no complete mechanics-only reference-quality calibration for automatic production.`]
      : []),
    ...(definition && definition.contentLane !== contentLane
      ? [
          `${family} CertifiedFamilyAdmission declares ${definition.contentLane}, but the active content lane is ${contentLane}.`,
        ]
      : []),
    ...(!runtime.ready
      ? runtime.blockers.map((blocker) => `${family} runtime: ${blocker}`)
      : []),
  ]);
  const automatic = blockers.length === 0;
  if (automatic && definition) {
    return {
      version: CERTIFIED_FAMILY_ADMISSION_VERSION,
      family,
      contentLane,
      mode: "automatic",
      automatic: true,
      routeKeys: [...definition.routeKeys],
      compositionKey: definition.composition.key,
      checks,
      blockers: [],
    };
  }

  const supervised = familySupervisedChannelInceptionCapability(family);
  return {
    version: CERTIFIED_FAMILY_ADMISSION_VERSION,
    family,
    contentLane,
    mode: supervised ? "supervised" : "blocked",
    automatic: false,
    routeKeys: [...actualRouteKeys],
    ...(definition ? { compositionKey: definition.composition.key } : {}),
    checks,
    blockers,
    remediation: supervised
      ? `Use the registered ${supervised.reviewScope} admission; it cannot authorize automatic production.`
      : (readiness.remediation
        ?? "Register every CertifiedFamilyAdmission requirement before enabling automatic production."),
    ...(supervised ? { reviewScope: supervised.reviewScope } : {}),
  };
}

/**
 * Test and catalog-tool assertion: a green legacy readiness bit is valid only
 * when this cross-check also grants automatic admission. It intentionally
 * rejects an automatic declaration for a supervised or otherwise blocked
 * family.
 */
export function assertCertifiedFamilyAdmissionCatalog(): void {
  // The only paid Visual Matter extension is deliberately outside automatic
  // family admission. Keep its cinematic-only QA-consumer contract in the
  // same certification sweep that guards catalog drift.
  assertVisualMatterReferenceAdmissionCatalog();
  const seen = new Set<FamilyKey>();
  for (const definition of CERTIFIED_AUTOMATIC_FAMILY_ADMISSION_DEFINITIONS) {
    if (seen.has(definition.family)) {
      throw new Error(`duplicate CertifiedFamilyAdmission definition for ${definition.family}`);
    }
    seen.add(definition.family);
  }

  for (const family of FAMILY_KEYS) {
    const admission = certifiedFamilyAdmission(family);
    const readiness = familyProductionReadiness(family);
    if (admission.automatic !== readiness.productionReady) {
      throw new Error(
        `${family} productionReady disagrees with CertifiedFamilyAdmission: ${admission.blockers.join(" ")}`,
      );
    }
    if (admission.automatic && admission.mode !== "automatic") {
      throw new Error(`${family} automatic admission has a non-automatic mode`);
    }
    if (!admission.automatic && admission.mode === "automatic") {
      throw new Error(`${family} blocked admission must never report automatic mode`);
    }
  }
}
