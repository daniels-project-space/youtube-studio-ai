/**
 * Channel-format advisor.
 *
 * This is deliberately more than a style keyword picker. A recommendation is
 * grounded in the real family catalog, durable lane contracts, provider and
 * source-evidence requirements, and the fact that no channel is promotable
 * until a held-out validation render passes. It is deliberately deterministic:
 * selecting a format must never make a provider call or imply that a
 * Gemini-backed planner is autonomous.
 */
import {
  FAMILIES,
  FAMILY_CREW,
  FAMILY_KEYS,
  FAMILY_RUNTIME_PIPELINE,
  familyAutonomousPlanningCapability,
  familyDurationContract,
  familyProductionReadiness,
  formatFamilyDurationContract,
  type FamilyKey,
} from "@/engine/families";
import { CONTENT_LANE_POLICIES, contentLaneForFamily } from "@/engine/contentLane";
import type { DataStoryContract } from "@/engine/dataStory";
import {
  CREATIVE_CAPABILITY_CATALOG_FINGERPRINT,
  privateReviewCapabilityOffers,
  resolveCreativeCapabilities,
  type CreativeCapabilityOffer,
} from "@/engine/creative/creativeCapabilityCatalog";
import { nichePreset } from "@/engine/golden";
import { assessPipelineVideoRuntimeReadiness } from "@/engine/runtimeCapability";
import {
  familyChannelInceptionCapability,
  familySupervisedChannelInceptionCapability,
  type CreatorAdmissionCapability,
} from "@/engine/channelInceptionCapability";

const KNOWN_ROLES = ["director", "cinematographer", "editor", "composer", "critic"] as const;
export type FormatCrewRole = (typeof KNOWN_ROLES)[number];

export interface FormatSelectionInput {
  /** The operator's description of the channel they want to build. */
  concept: string;
  /** Display-friendly niche context. */
  niche?: string;
  /** Canonical niche key used by the pipeline designer when available. */
  nicheKey?: string;
  audience?: string;
  sampleTopics?: string[];
  /** Optional desired final runtime. The authoritative compiler checks it again before spend. */
  targetDurationSeconds?: number;
  /** Optional hard creator budget cap. Omit it to receive the family floor only. */
  maxPerVideoBudgetUsd?: number;
}

export interface FormatRecipe {
  family: FamilyKey;
  /** Repeatable channel concepts that the existing modules can actually make. */
  channelTypes: readonly string[];
  /** Intent signals used by the deterministic no-model fallback. */
  signals: readonly string[];
  qualityFocus: readonly string[];
  tradeoff: string;
}

export interface RankedFormatCandidate {
  family: FamilyKey;
  score: number;
  matchedSignals: string[];
}

export interface FormatPlanningPreflight {
  /** Whether the family has a registered planner that never requires Gemini at runtime. */
  ready: boolean;
  mode: "registered_non_gemini" | "unregistered";
  capabilityId?: string;
  plannerBlock?: string;
  provenance?: string;
  blockers: string[];
  remediation?: string;
}

/**
 * Creator-facing admission is deliberately broader than automatic planning.
 * `registered_supervised_non_gemini` exposes a real private-review intake,
 * never a production-ready or public-output claim.
 */
export interface FormatCreatorAdmission {
  mode: CreatorAdmissionCapability["mode"];
  selectable: boolean;
  autonomous: boolean;
  privateReviewOnly: boolean;
  capabilityId?: string;
  provenance?: string;
  coveredStages: string[];
  requiredArtifacts: string[];
  reviewHref?: string;
  blockers: string[];
  remediation?: string;
}

export interface FormatRuntimePreflight {
  /** True only when every video-producing block's pinned profile is runnable on the current fleet. */
  ready: boolean;
  videoRequired: boolean;
  blockers: string[];
  assessedBlocks: {
    blockId: string;
    profileId?: string;
    ready: boolean;
    blockers: string[];
  }[];
}

export interface FormatModuleAdmission {
  block: string;
  profile: string;
  /** The concept explicitly asked for this module's visual grammar. */
  requiredForConcept: boolean;
  autonomous: boolean;
  blockers: string[];
  remediation: string;
  requirements: string[];
}

/**
 * A reviewable module required by the stated channel concept. This stays
 * deliberately small so the creator can describe real modules from different
 * production lanes without importing their executable Trigger implementations.
 */
export interface FormatModuleRecommendation {
  block: string;
  profile: string;
  /** Present for source-attributed Data Story; retained for existing creator clients. */
  contract?: DataStoryContract;
  automationAdmission: {
    autonomous: boolean;
    blockers: readonly string[];
    remediation: string;
  };
  requirements: readonly string[];
  qualityFocus: readonly string[];
}

export interface FormatPreflight {
  /** The catalogued family and its lane contract are available in this build. */
  templateAvailable: boolean;
  /** True only if its actual production renderer can execute on the current fleet. */
  productionReady: boolean;
  /**
   * All current automatic-production blockers, retained under the legacy
   * field name so existing creator clients do not mistake a blocked route for
   * a runnable one. Use `planning`, `runtime`, and `moduleAdmissions` for the
   * precise owner of each blocker.
   */
  runtimeBlockers: string[];
  /** Actual no-Gemini planning admission for this family. */
  planning: FormatPlanningPreflight;
  /**
   * Channel/episode intake route visible to the creator. This intentionally
   * remains separate from `productionReady`.
   */
  creatorAdmission: FormatCreatorAdmission;
  /** Actual pinned video-runtime assessment for this family. */
  runtime: FormatRuntimePreflight;
  /** A possible substitute for explicit operator consideration; never silently selected. */
  fallbackFamily?: FamilyKey;
  /** Runtime pipeline compilation happens in the authorized design task. */
  runtimeCompilationRequired: true;
  contentLane?: string;
  primaryRenderer?: string;
  /** Required provider capabilities; credential presence is never exposed here. */
  providerRequirements: string[];
  /** Mandatory source/claim inputs that must be supplied before a render. */
  sourceRequirements: string[];
  /** False whenever the creator has not supplied all source/module evidence implied by this concept. */
  sourceRequirementsReady: boolean;
  /** Certified modules implied by the concept, including private-review-only routes. */
  recommendedModules: FormatModuleRecommendation[];
  /** Reusable intent-matched capability offers; only explicit opt-ins may be submitted. */
  creativeCapabilities: CreativeCapabilityOffer[];
  /** Current declarative catalog identity; stale browser selections are rejected server-side. */
  capabilityCatalogFingerprint: string;
  /**
   * The automation status of modules implied by the creator's stated concept.
   * A module with `requiredForConcept: true` blocks automatic production when
   * it does not have a non-Gemini admission path.
   */
  moduleAdmissions: FormatModuleAdmission[];
  missingRequirements: string[];
  /**
   * Conservative floor for a standard episode, backed by the current default
   * compiler reservation. Custom duration and runtime choices are compiled
   * again before any provider work can begin.
   */
  minimumPerVideoBudgetUsd: number;
  budget: {
    minimumUsd: number;
    requestedMaxUsd?: number;
    withinRequestedBudget: boolean;
    shortfallUsd?: number;
  };
  /** The authored story unit, exposed before a creator selects a length. */
  duration: {
    minimumSeconds: number;
    maximumSeconds: number;
    defaultSeconds: number;
    inputUnit: "minutes" | "seconds" | "fixed";
    label: string;
    rationale: string;
    targetSeconds?: number;
    withinFamilyContract: boolean;
  };
  /** Required end-to-end visual chain, not a synthetic full runtime pipeline. */
  requiredPipelineModules: string[];
  /**
   * One or more complete, interchangeable renderer chains. A creator must
   * never read the shared assembly/QA blocks as proof that an actual visual
   * renderer is present.
   */
  requiredRendererChains: string[][];
  /** Non-negotiable companions for a renderer path, such as source-bound cinematic direction. */
  rendererChainGuards: Array<{ whenPresent: string[]; requires: string[] }>;
  qualityFocus: string[];
  warnings: string[];
  /** Never inferred from a showcase sample: every new channel needs this proof. */
  validationRenderRequired: true;
}

export interface FormatRecommendation {
  family: FamilyKey;
  /** True only when the selected family is production-runnable on the current fleet. */
  available: boolean;
  /** The canonical crew the designer will actually insert, in execution order. */
  crew: FormatCrewRole[];
  reasoning: string;
  /** 0..1 — confidence in the selected format, not a quality promise. */
  confidence: number;
  alternates: { family: FamilyKey; why: string }[];
  /** A transparent readiness contract for the creator UI. */
  preflight: FormatPreflight;
  /** Always true: this advisor is deterministic and never calls an AI provider. */
  fallback: boolean;
}

/**
 * These are production recipes, not phantom engines. They expose the larger
 * channel surface already unlocked by the ten families without claiming that a
 * different editorial wrapper is a separate renderer.
 */
export const FORMAT_RECIPES: Record<FamilyKey, FormatRecipe> = {
  narrated_stock: {
    family: "narrated_stock",
    channelTypes: ["narrated visual essays", "research-led history", "economic- and business-history causal explainers", "psychology / finance-lite explainers", "source-attributed data stories", "ranked chart-led analyses", "motivational series"],
    signals: ["visual essay", "deep dive", "stoicism", "psychology", "finance", "history", "economic history", "business history", "company history", "market history", "documentary", "explainer", "narrated", "data story", "data storytelling", "data visualization", "animated charts", "chart-led", "ranked comparison", "statistical breakdown", "market share", "economic data"],
    qualityFocus: ["causal story spine", "voice performance", "evidence-matched b-roll", "retention pacing", "source-attributed numeric claims"],
    tradeoff: "Best general long-form lane; chart-led data stories are an explicit opt-in and require named sources for every visualized number.",
  },
  music_loop: {
    family: "music_loop",
    channelTypes: ["lo-fi study rooms", "focus music", "rainy animated loops", "ambient work sessions"],
    signals: ["lofi", "lo-fi", "study beats", "chillhop", "music loop", "focus music", "animated loop", "background music"],
    qualityFocus: ["original music aesthetics", "seam continuity", "long-form mix", "recognizable visual world"],
    tradeoff: "Audio is the product, so the final music-aesthetic score and seamless-loop proof are release gates.",
  },
  sleep: {
    family: "sleep",
    channelTypes: ["sleep stories", "guided meditation", "breathwork", "calm gratitude sessions"],
    signals: ["sleep", "insomnia", "meditation", "breathwork", "white noise", "calm down", "guided relaxation", "ambient"],
    qualityFocus: ["comforting voice", "safe loudness", "slow visual continuity", "no jarring transitions"],
    tradeoff: "Requires restraint: pacing, mix, and motion must calm rather than optimize for rapid clicks.",
  },
  comic: {
    family: "comic",
    channelTypes: ["motion-comic history", "illustrated true stories", "graphic-novel biographies", "character-led mini stories"],
    signals: ["motion comic", "comic", "graphic novel", "illustrated story", "drawn page", "panels", "comic history"],
    qualityFocus: ["panel legibility", "character continuity", "dialogue timing", "page-turn rhythm"],
    tradeoff: "High editorial identity, but continuity and readable panels matter more than raw shot count.",
  },
  shorts: {
    family: "shorts",
    channelTypes: ["high-retention vertical facts", "motivational micro-lessons", "caption-led reels", "fast topical explainers"],
    signals: ["shorts", "short-form", "short form", "tiktok", "reel", "vertical", "9:16", "viral"],
    qualityFocus: ["first-second hook", "caption readability", "pattern interrupts", "clear payoff"],
    tradeoff: "Fast iteration lane; every second needs a deliberate retention beat rather than a compressed long-form edit.",
  },
  documentary_collage_short: {
    family: "documentary_collage_short",
    channelTypes: ["source-led micro-documentaries", "archival evidence Shorts", "news-history visual explainers", "fact-checked vertical timelines"],
    signals: ["micro documentary", "documentary short", "documentary shorts", "archival", "source led", "source-led", "evidence", "timeline short", "fact checked"],
    qualityFocus: ["claim-to-source traceability", "vertical evidence design", "fast causal clarity", "rights-aware media selection"],
    tradeoff: "Cannot render responsibly without structured source references and per-claim evidence.",
  },
  whiteboard: {
    family: "whiteboard",
    channelTypes: ["whiteboard explainers", "visual learning", "science / math concepts", "business mechanism explainers"],
    signals: ["whiteboard", "drawn explainer", "hand draw", "hand-draw", "doodle", "sketch", "visualized", "how does"],
    qualityFocus: ["conceptual clarity", "draw timing", "diagram legibility", "narration synchronization"],
    tradeoff: "Best when the viewer needs to understand a mechanism, not merely watch atmospheric footage.",
  },
  loreshort: {
    family: "loreshort",
    channelTypes: ["lore micro-docs", "first-person history", "mythology / universe lore", "character POV stories"],
    signals: ["lore", "mythology", "first person", "first-person", "pov history", "character pov", "worldbuilding", "legend"],
    qualityFocus: ["narrative voice", "world consistency", "micro-story causality", "vertical visual payoff"],
    tradeoff: "A compact story lane: it needs a single clear perspective and an earned ending, not an encyclopedia summary.",
  },
  quizyear: {
    family: "quizyear",
    channelTypes: ["interactive trivia", "guess-the-year games", "multiple-choice learning", "fast fact challenges"],
    signals: ["quiz", "trivia", "guess the year", "guess-the-year", "multiple choice", "question", "challenge", "capitals", "currencies"],
    qualityFocus: ["fact correctness", "question clarity", "answer timing", "interactive pacing"],
    tradeoff: "The question bank and reveal timing are the product; source integrity matters as much as visual polish.",
  },
  illustrated_explainer: {
    family: "illustrated_explainer",
    channelTypes: ["animated visual explainers", "animated science and systems lessons", "animated geography atlases", "language micro-courses", "original illustrated serial stories"],
    signals: ["animated explainer", "visual explainer", "science animation", "animated science", "science lesson", "map animation", "animated geography", "geography atlas", "diagram", "systems explained", "language lesson", "visual lesson", "how it works"],
    qualityFocus: ["causal Episode Graph", "diagram and label legibility", "narration-to-state timing", "original scene continuity"],
    tradeoff: "A provider-independent visual language for causal lessons and stories; every scene must communicate a real state change rather than fill time with decoration.",
  },
  children_learning: {
    family: "children_learning",
    channelTypes: ["original early-learning stories", "life-skills mini shows", "preschool observation lessons", "gentle language learning"],
    signals: ["kids learning", "children learning", "preschool", "toddler learning", "life skills for kids", "early learning", "children story", "kids animation", "kids show", "children show", "animated kids", "animated children", "bedtime story for kids", "nursery rhyme"],
    qualityFocus: ["age-banded learning objective", "original character continuity", "clear safe resolution", "human child-content approval"],
    tradeoff: "This is a supervised product lane, not an autonomous nursery-rhyme generator: it produces review candidates only and cannot be public or scheduled automatically.",
  },
  cinematic: {
    family: "cinematic",
    channelTypes: ["cinematic reconstructions", "true-crime / history scenes", "atmospheric mini-films", "story-led AI cinematics"],
    signals: ["cinematic", "reconstruction", "true crime", "heist", "thriller", "crime", "ai scenes", "mini film", "mini-film"],
    qualityFocus: ["shot continuity", "character / setting locks", "causal scene progression", "cinematic sound and edit"],
    tradeoff: "The highest visual-control lane: its Novita shot chain is only ready after a pinned story, Visual Matter, and per-shot QA.",
  },
};

function normalizedIntent(input: FormatSelectionInput): string {
  return [input.concept, input.niche, input.nicheKey, input.audience, ...(input.sampleTopics ?? [])]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9: ]+/g, " ");
}

/** Deterministically rank every family, so no-model selection covers every lane. */
export function rankFormatCandidates(input: FormatSelectionInput): RankedFormatCandidate[] {
  const intent = normalizedIntent(input);
  return FAMILY_KEYS.map((family) => {
    const recipe = FORMAT_RECIPES[family];
    const matchedSignals = recipe.signals.filter((signal) => intent.includes(signal.replace(/[^a-z0-9: ]+/g, " ")));
    // Multi-word phrases carry more semantic specificity than broad single-word matches.
    const score = matchedSignals.reduce((total, signal) => total + (signal.includes(" ") || signal.includes("-") ? 3 : 1), 0)
      + (family === "narrated_stock" ? 0.1 : 0);
    return { family, score, matchedSignals };
  }).sort((a, b) => b.score - a.score || a.family.localeCompare(b.family));
}

function canonicalCrew(family: FamilyKey, input: FormatSelectionInput): FormatCrewRole[] {
  const nicheKey = input.nicheKey ?? input.niche;
  const presetCrew = nicheKey ? nichePreset(nicheKey)?.crew : undefined;
  const source = presetCrew ?? FAMILY_CREW[family] ?? [];
  const known = new Set(source.filter((role): role is FormatCrewRole => (KNOWN_ROLES as readonly string[]).includes(role)));
  // A critic is a release contract, not a stylistic preference.
  known.add("critic");
  return KNOWN_ROLES.filter((role) => known.has(role));
}

function sourceRequirements(
  family: FamilyKey,
  creativeCapabilities: readonly CreativeCapabilityOffer[],
): string[] {
  const familyRequirements = family === "documentary_collage_short"
    ? ["structured sourceReferences", "per-claim claimEvidence"]
    : [];
  // Review-only capabilities are concept-implied intake routes, not optional
  // visual flourishes. Their source/evidence requirements come from the same
  // catalog object that supplied their module and review-desk behavior.
  return uniqueStrings([
    ...familyRequirements,
    ...privateReviewCapabilityOffers(creativeCapabilities).flatMap((capability) => capability.requirements),
  ]);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function positiveFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function planningPreflight(family: FamilyKey): FormatPlanningPreflight {
  const capability = familyAutonomousPlanningCapability(family);
  if (capability.mode === "registered_non_gemini") {
    return {
      ready: true,
      mode: capability.mode,
      capabilityId: capability.id,
      plannerBlock: capability.plannerBlock,
      provenance: capability.provenance,
      blockers: [],
    };
  }

  return {
    ready: false,
    mode: capability.mode,
    blockers: [
      `${FAMILIES[family].label}: no-Gemini automatic planning is not registered; ` +
        `the creator pipeline still requires Gemini-backed ${capability.geminiBackedBlocks.join(", ")}.`,
    ],
    remediation: "Register a deterministic or non-Gemini topic/story planner before admitting this family.",
  };
}

function creatorAdmissionPreflight(
  family: FamilyKey,
  creativeCapabilities: readonly CreativeCapabilityOffer[],
): FormatCreatorAdmission {
  // The catalog owns whether a stated intent enters a supervised capability
  // route. The channel-inception registry still owns the concrete reviewer
  // workflow, but does not get to re-parse a Casefile/children concept.
  const privateReviewOffers = privateReviewCapabilityOffers(creativeCapabilities);
  const supervised = familySupervisedChannelInceptionCapability(family, {
    casefileCinematic: family === "cinematic" && privateReviewOffers.length > 0,
  });
  const capability = supervised ?? familyChannelInceptionCapability(family);

  if (capability.mode === "registered_non_gemini") {
    return {
      mode: capability.mode,
      selectable: true,
      autonomous: true,
      privateReviewOnly: false,
      capabilityId: capability.id,
      provenance: capability.provenance,
      coveredStages: [...capability.coveredStages],
      requiredArtifacts: [],
      blockers: [],
    };
  }

  if (capability.mode === "registered_supervised_non_gemini") {
    return {
      mode: capability.mode,
      selectable: true,
      autonomous: false,
      privateReviewOnly: true,
      capabilityId: capability.id,
      provenance: capability.provenance,
      coveredStages: [...capability.coveredStages],
      requiredArtifacts: [...capability.requiredArtifacts],
      ...(capability.reviewHref ? { reviewHref: capability.reviewHref } : {}),
      blockers: [
        "This route is registered for private human review only; it does not authorize automatic production, rendering, spend, or publishing.",
      ],
      remediation: "Complete the named private-review artifacts before requesting a separately authorized render or publication action.",
    };
  }

  return {
    mode: capability.mode,
    selectable: false,
    autonomous: false,
    privateReviewOnly: false,
    coveredStages: [],
    requiredArtifacts: [],
    blockers: [...capability.blockers],
    remediation: capability.remediation,
  };
}

function runtimePreflight(family: FamilyKey): FormatRuntimePreflight {
  const assessment = assessPipelineVideoRuntimeReadiness(FAMILY_RUNTIME_PIPELINE[family]);
  return {
    ready: assessment.ready,
    videoRequired: assessment.videoRequired,
    blockers: [...assessment.blockers],
    assessedBlocks: assessment.blockAssessments.map((block) => ({
      blockId: block.blockId,
      ...(block.profileId ? { profileId: block.profileId } : {}),
      ready: block.ready,
      blockers: [...block.blockers],
    })),
  };
}

function moduleAdmissions(modules: readonly FormatModuleRecommendation[]): FormatModuleAdmission[] {
  return modules.map((module) => ({
    block: module.block,
    profile: module.profile,
    requiredForConcept: true,
    autonomous: module.automationAdmission.autonomous,
    blockers: [...module.automationAdmission.blockers],
    remediation: module.automationAdmission.remediation,
    requirements: [...module.requirements],
  }));
}

/**
 * Server-safe admission preflight. It deliberately does not import the runtime
 * block registry: the authenticated Trigger design task is the sole authority
 * that compiles executable manifests, calculates an exact reservation, and
 * decides whether a paid held-out probe may start. Keeping that boundary here
 * prevents a lightweight creator request from bundling render workers into Next.
 */
export function formatPreflight(family: FamilyKey, input: FormatSelectionInput): FormatPreflight {
  const spec = FAMILIES[family];
  const lane = contentLaneForFamily(family);
  const laneDefinition = lane ? CONTENT_LANE_POLICIES[lane.key] : undefined;
  const planning = planningPreflight(family);
  const creativeCapabilities = resolveCreativeCapabilities(input, family);
  const creatorAdmission = creatorAdmissionPreflight(family, creativeCapabilities);
  const runtime = runtimePreflight(family);
  const recommendedModules: FormatModuleRecommendation[] = creativeCapabilities.flatMap((capability) =>
    capability.modules.map((module) => ({
      block: module.block,
      profile: module.profile,
      ...(module.contract ? { contract: module.contract } : {}),
      automationAdmission: module.automationAdmission ?? capability.automationAdmission,
      requirements: module.requirements,
      qualityFocus: module.qualityFocus,
    })),
  );
  const admittedModules = moduleAdmissions(recommendedModules);
  const requiredSources = sourceRequirements(family, creativeCapabilities);
  const missingRequirements = uniqueStrings([
    ...requiredSources,
    ...admittedModules
      .filter((module) => module.requiredForConcept)
      .flatMap((module) => module.requirements),
  ]);
  const sourceRequirementsReady = missingRequirements.length === 0;
  const templateAvailable = Boolean(spec.available && lane);
  const readiness = familyProductionReadiness(family);
  const duration = familyDurationContract(family);
  const targetSeconds = positiveFiniteNumber(input.targetDurationSeconds);
  const durationWithinFamilyContract = targetSeconds === undefined
    || (targetSeconds >= duration.minimumSeconds && targetSeconds <= duration.maximumSeconds);
  const requestedMaxUsd = positiveFiniteNumber(input.maxPerVideoBudgetUsd);
  const minimumPerVideoBudgetUsd = spec.defaultRunBudgetUsd ?? 0.5;
  const budgetWithinRequestedCap = requestedMaxUsd === undefined || requestedMaxUsd >= minimumPerVideoBudgetUsd;
  const moduleBlockers = admittedModules
    .filter((module) => module.requiredForConcept && !module.autonomous)
    .flatMap((module) => module.blockers);
  const constraintBlockers = [
    ...(!durationWithinFamilyContract && targetSeconds !== undefined
      ? [`${spec.label}: requested ${targetSeconds}s is outside its ${formatFamilyDurationContract(family)} contract.`]
      : []),
    ...(!budgetWithinRequestedCap && requestedMaxUsd !== undefined
      ? [`${spec.label}: requested budget cap $${requestedMaxUsd.toFixed(2)} is below the $${minimumPerVideoBudgetUsd.toFixed(2)} standard-episode floor.`]
      : []),
  ];
  const runtimeBlockers = uniqueStrings([
    ...readiness.blockers,
    ...moduleBlockers,
    ...constraintBlockers,
    ...(!sourceRequirementsReady
      ? [`${spec.label}: source/module evidence must be supplied before automatic production.`]
      : []),
  ]);
  // Family readiness covers its declared template, planner, and runtime. The
  // creator-level decision additionally has to satisfy evidence and explicit
  // duration/budget constraints implied by this particular channel concept.
  const productionReady = templateAvailable
    && readiness.productionReady
    && planning.ready
    && runtime.ready
    && sourceRequirementsReady
    && admittedModules.every((module) => !module.requiredForConcept || module.autonomous)
    && durationWithinFamilyContract
    && budgetWithinRequestedCap;
  return {
    templateAvailable,
    productionReady,
    runtimeBlockers,
    planning,
    creatorAdmission,
    runtime,
    runtimeCompilationRequired: true,
    ...(lane ? { contentLane: lane.key, primaryRenderer: lane.primaryRenderer } : {}),
    providerRequirements: [...spec.requiresKeys],
    sourceRequirements: requiredSources,
    sourceRequirementsReady,
    recommendedModules,
    creativeCapabilities,
    capabilityCatalogFingerprint: CREATIVE_CAPABILITY_CATALOG_FINGERPRINT,
    moduleAdmissions: admittedModules,
    missingRequirements,
    minimumPerVideoBudgetUsd,
    budget: {
      minimumUsd: minimumPerVideoBudgetUsd,
      ...(requestedMaxUsd !== undefined ? { requestedMaxUsd } : {}),
      withinRequestedBudget: budgetWithinRequestedCap,
      ...(!budgetWithinRequestedCap && requestedMaxUsd !== undefined
        ? { shortfallUsd: Number((minimumPerVideoBudgetUsd - requestedMaxUsd).toFixed(2)) }
        : {}),
    },
    duration: {
      minimumSeconds: duration.minimumSeconds,
      maximumSeconds: duration.maximumSeconds,
      defaultSeconds: duration.defaultSeconds,
      inputUnit: duration.inputUnit,
      label: formatFamilyDurationContract(family),
      rationale: duration.rationale,
      ...(targetSeconds !== undefined ? { targetSeconds } : {}),
      withinFamilyContract: durationWithinFamilyContract,
    },
    requiredPipelineModules: laneDefinition ? [...laneDefinition.requiredBlocks] : [],
    requiredRendererChains: laneDefinition
      ? (laneDefinition.requiredRendererChains ?? []).map((chain) => [...chain])
      : [],
    rendererChainGuards: laneDefinition
      ? (laneDefinition.rendererChainGuards ?? []).map((guard) => ({
          whenPresent: [...guard.whenPresent],
          requires: [...guard.requires],
        }))
      : [],
    qualityFocus: uniqueStrings([
      ...FORMAT_RECIPES[family].qualityFocus,
      ...recommendedModules.flatMap((module) => module.qualityFocus),
    ]),
    warnings: [
      ...(templateAvailable ? [] : ["No available content-lane contract is registered for this family."]),
      ...(productionReady ? [] : runtimeBlockers),
      "The authorized channel-design task must compile the exact runtime pipeline and cost reservation before any validation render can start.",
    ],
    validationRenderRequired: true,
  };
}

function confidenceForRank(candidate: RankedFormatCandidate, next?: RankedFormatCandidate): number {
  if (candidate.score <= 0.1) return 0.35;
  const separation = candidate.score - (next?.score ?? 0);
  return Math.min(0.9, Math.max(0.5, 0.55 + candidate.score * 0.04 + separation * 0.04));
}

function alternateReason(candidate: RankedFormatCandidate): string {
  const recipe = FORMAT_RECIPES[candidate.family];
  return candidate.matchedSignals.length
    ? `Matched ${candidate.matchedSignals.slice(0, 2).join(" / ")}; ${recipe.tradeoff}`
    : recipe.tradeoff;
}

/**
 * A capability check is only a tie-breaker between equally explicit intents.
 * It must never replace a stronger requested visual grammar with the one
 * currently easiest to render.
 */
function preflightTieBreak(preflight: FormatPreflight): number {
  if (preflight.productionReady) return 4;
  if (preflight.templateAvailable && preflight.planning.ready && preflight.runtime.ready) return 3;
  if (preflight.templateAvailable) return 2;
  return 1;
}

function chooseDeterministicCandidate(
  ranked: readonly RankedFormatCandidate[],
  input: FormatSelectionInput,
): RankedFormatCandidate {
  const defaultCandidate = { family: "narrated_stock" as FamilyKey, score: 0.1, matchedSignals: [] };
  const first = ranked[0] ?? defaultCandidate;
  const tied = ranked.filter((candidate) => candidate.score === first.score);
  if (tied.length <= 1) return first;

  return tied.reduce((best, candidate) => {
    const bestPreflight = formatPreflight(best.family, input);
    const candidatePreflight = formatPreflight(candidate.family, input);
    return preflightTieBreak(candidatePreflight) > preflightTieBreak(bestPreflight) ? candidate : best;
  }, tied[0]!);
}

function deterministicAlternates(
  ranked: readonly RankedFormatCandidate[],
  chosen: RankedFormatCandidate,
  input: FormatSelectionInput,
): { family: FamilyKey; why: string }[] {
  return ranked
    // An alternate must independently match the stated intent and be actually
    // admitted now. A zero-signal QuizYear entry is not a genuine alternative
    // to an unavailable cinematic/documentary request.
    .filter((candidate) => candidate.family !== chosen.family && candidate.score > 0)
    .map((candidate) => ({ candidate, preflight: formatPreflight(candidate.family, input) }))
    .filter(({ preflight }) => preflight.productionReady)
    .slice(0, 2)
    .map(({ candidate }) => ({ family: candidate.family, why: alternateReason(candidate) }));
}

function recommendationReason(
  chosen: RankedFormatCandidate,
  preflight: FormatPreflight,
): string {
  const family = chosen.family;
  const match = chosen.matchedSignals.length
    ? `Matched ${chosen.matchedSignals.join(", ")} to the ${FAMILIES[family].label} production recipe.`
    : "No specialist intent was detected, so this uses the most broadly capable narrated production recipe.";

  if (preflight.productionReady) {
    return `${match} Its registered no-Gemini planner, required source inputs, and current runtime preflight are admitted; a held-out validation render is still mandatory.`;
  }

  const blockers = preflight.runtimeBlockers.slice(0, 3).join(" ") || "The family has no admitted automatic production path.";
  const requirements = preflight.missingRequirements.length
    ? ` Before automatic production, supply: ${preflight.missingRequirements.join("; ")}.`
    : "";
  return `${match} Automatic production is currently blocked: ${blockers}${requirements} The requested format remains selected; no unrelated channel was substituted.`;
}

/**
 * Public deterministic path for tests and offline clients. It covers the full
 * family catalog and never calls a model or provider.
 */
export function recommendFormatDeterministically(
  input: FormatSelectionInput,
  reasoning?: string,
): FormatRecommendation {
  const ranked = rankFormatCandidates(input);
  const chosen = chooseDeterministicCandidate(ranked, input);
  const family = chosen.family;
  const preflight = formatPreflight(family, input);
  return {
    family,
    available: preflight.productionReady,
    crew: canonicalCrew(family, input),
    reasoning: reasoning ?? recommendationReason(chosen, preflight),
    confidence: confidenceForRank(chosen, ranked[1]),
    alternates: deterministicAlternates(ranked, chosen, input),
    preflight,
    fallback: true,
  };
}

/**
 * Recommend a production format without any model/provider call. The real
 * pipeline preflight prevents an attractive label from being represented as a
 * viable auto-created channel when its planner, renderer, or required evidence
 * is absent.
 */
export async function selectFormat(
  input: FormatSelectionInput,
  log: (message: string) => void = () => {},
): Promise<FormatRecommendation> {
  const fallbackReason = input.concept?.trim()
    ? undefined
    : "No concept provided — defaulted to the most general narrated production recipe.";
  const recommendation = recommendFormatDeterministically(input, fallbackReason);
  log(
    `selectFormat: deterministic → ${recommendation.family} ` +
      `(planner=${recommendation.preflight.planning.ready ? "ready" : "blocked"}, ` +
      `runtime=${recommendation.preflight.runtime.ready ? "ready" : "blocked"}, ` +
      `production=${recommendation.available ? "ready" : "blocked"})`,
  );
  return recommendation;
}
