/**
 * Channel-format advisor.
 *
 * This is deliberately more than a style keyword picker. A recommendation is
 * grounded in the real family catalog, durable lane contracts, provider and
 * source-evidence requirements, and the fact that no channel is promotable
 * until a held-out validation render passes. The LLM is a semantic vote; the
 * deterministic ranking and preflight keep the result useful when a
 * model/provider is absent.
 */
import {
  FAMILIES,
  FAMILY_CREW,
  FAMILY_KEYS,
  familyDurationContract,
  familyProductionReadiness,
  formatFamilyDurationContract,
  isFamilyProductionReady,
  productionReadyFamilyFallback,
  type FamilyKey,
} from "@/engine/families";
import { CONTENT_LANE_POLICIES, contentLaneForFamily } from "@/engine/contentLane";
import {
  dataStoryRecommendationForIntent,
  type DataStoryModuleRecommendation,
} from "@/engine/dataStory";
import { nichePreset } from "@/engine/golden";
import { geminiJson } from "@/lib/gemini";

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

export interface FormatPreflight {
  /** The catalogued family and its lane contract are available in this build. */
  templateAvailable: boolean;
  /** True only if its actual production renderer can execute on the current fleet. */
  productionReady: boolean;
  /** Provider/hardware blockers that prevent a paid validation render. */
  runtimeBlockers: string[];
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
  /** Optional certified modules the operator may explicitly add after review. */
  recommendedModules: DataStoryModuleRecommendation[];
  missingRequirements: string[];
  /**
   * Conservative floor for a standard episode, backed by the current default
   * compiler reservation. Custom duration and runtime choices are compiled
   * again before any provider work can begin.
   */
  minimumPerVideoBudgetUsd: number;
  /** The authored story unit, exposed before a creator selects a length. */
  duration: {
    minimumSeconds: number;
    maximumSeconds: number;
    defaultSeconds: number;
    inputUnit: "minutes" | "seconds" | "fixed";
    label: string;
    rationale: string;
  };
  /** Required end-to-end visual chain, not a synthetic full runtime pipeline. */
  requiredPipelineModules: string[];
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
  /** true → semantic model output was unavailable or contradicted strong intent. */
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
    channelTypes: ["narrated visual essays", "research-led history", "psychology / finance-lite explainers", "source-attributed data stories", "ranked chart-led analyses", "motivational series"],
    signals: ["visual essay", "deep dive", "stoicism", "psychology", "finance", "history", "documentary", "explainer", "narrated", "data story", "data storytelling", "data visualization", "animated charts", "chart-led", "ranked comparison", "statistical breakdown", "market share", "economic data"],
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
    channelTypes: ["animated visual explainers", "science and systems lessons", "geography / history atlases", "language micro-courses", "original illustrated serial stories"],
    signals: ["animated explainer", "visual explainer", "science animation", "map animation", "diagram", "systems explained", "language lesson", "visual lesson", "how it works"],
    qualityFocus: ["causal Episode Graph", "diagram and label legibility", "narration-to-state timing", "original scene continuity"],
    tradeoff: "A provider-independent visual language for causal lessons and stories; every scene must communicate a real state change rather than fill time with decoration.",
  },
  children_learning: {
    family: "children_learning",
    channelTypes: ["original early-learning stories", "life-skills mini shows", "preschool observation lessons", "gentle language learning"],
    signals: ["kids learning", "children learning", "preschool", "toddler learning", "life skills for kids", "early learning", "children story", "kids animation"],
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

function sourceRequirements(family: FamilyKey): string[] {
  if (family === "documentary_collage_short") {
    return ["structured sourceReferences", "per-claim claimEvidence"];
  }
  return [];
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
  const requiredSources = sourceRequirements(family);
  const missingRequirements = [...requiredSources];
  const templateAvailable = Boolean(spec.available && lane);
  const readiness = familyProductionReadiness(family);
  const duration = familyDurationContract(family);
  const productionReady = templateAvailable && readiness.productionReady;
  const fallbackFamily = !productionReady && templateAvailable
    ? productionReadyFamilyFallback(family)
    : undefined;
  return {
    templateAvailable,
    productionReady,
    runtimeBlockers: [...readiness.blockers],
    ...(fallbackFamily
      ? { fallbackFamily }
      : {}),
    runtimeCompilationRequired: true,
    ...(lane ? { contentLane: lane.key, primaryRenderer: lane.primaryRenderer } : {}),
    providerRequirements: [...spec.requiresKeys],
    sourceRequirements: requiredSources,
    recommendedModules: dataStoryRecommendationForIntent(input, family),
    missingRequirements,
    minimumPerVideoBudgetUsd: spec.defaultRunBudgetUsd ?? 0.5,
    duration: {
      minimumSeconds: duration.minimumSeconds,
      maximumSeconds: duration.maximumSeconds,
      defaultSeconds: duration.defaultSeconds,
      inputUnit: duration.inputUnit,
      label: formatFamilyDurationContract(family),
      rationale: duration.rationale,
    },
    requiredPipelineModules: laneDefinition ? [...laneDefinition.requiredBlocks] : [],
    qualityFocus: [...FORMAT_RECIPES[family].qualityFocus],
    warnings: [
      ...(templateAvailable ? [] : ["No available content-lane contract is registered for this family."]),
      ...(productionReady ? [] : readiness.blockers),
      "The authorized channel-design task must compile the exact runtime pipeline and cost reservation before any validation render can start.",
    ],
    validationRenderRequired: true,
  };
}

/** A compact, truthful view of every runnable channel recipe for the semantic picker. */
function catalogForPrompt(input: FormatSelectionInput): string {
  return FAMILY_KEYS.map((family) => {
    const spec = FAMILIES[family];
    const recipe = FORMAT_RECIPES[family];
    const preflight = formatPreflight(family, input);
    return [
      `- ${family}: ${spec.label}; channel types: ${recipe.channelTypes.join(", ")}.`,
      `  renderer=${preflight.primaryRenderer ?? spec.visualEngine}; ${spec.narrated ? "narrated" : "not narrated"};`,
      `  lane=${preflight.contentLane ?? "NOT registered"}; required visual chain=${preflight.requiredPipelineModules.join(", ") || "none"}; providers=${preflight.providerRequirements.join(", ") || "none"};`,
      `  duration=${preflight.duration.label}; production=${preflight.productionReady ? "READY" : `BLOCKED (${preflight.runtimeBlockers.join(" ")})`}; source requirements=${preflight.sourceRequirements.join(", ") || "none"}; optional certified modules=${preflight.recommendedModules.map((module) => `${module.block}/${module.profile}`).join(", ") || "none"}; quality focus=${recipe.qualityFocus.join(", ")}.`,
      `  tradeoff: ${recipe.tradeoff}`,
    ].join(" ");
  }).join("\n");
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
 * Public deterministic path for tests and offline clients. It covers the full
 * family catalog and never calls a model or provider.
 */
export function recommendFormatDeterministically(
  input: FormatSelectionInput,
  reasoning?: string,
): FormatRecommendation {
  const ranked = rankFormatCandidates(input);
  const chosen = ranked[0] ?? { family: "narrated_stock" as FamilyKey, score: 0.1, matchedSignals: [] };
  const family = chosen.family;
  const preflight = formatPreflight(family, input);
  return {
    family,
    available: preflight.productionReady,
    crew: canonicalCrew(family, input),
    reasoning: reasoning ?? (!preflight.productionReady
      ? `${FAMILIES[family].label} is the correct authored format for this intent, but its production renderer is currently blocked. No unlike substitute was selected automatically; ${preflight.fallbackFamily ? `${FAMILIES[preflight.fallbackFamily].label} is shown only as an operator-visible alternative.` : "a benchmarked renderer is required."}`
      : chosen.matchedSignals.length
      ? `Matched ${chosen.matchedSignals.join(", ")} to the ${FAMILIES[family].label} production recipe.`
      : "No specialist intent was detected, so this uses the most broadly capable narrated production recipe."),
    confidence: confidenceForRank(chosen, ranked[1]),
    alternates: ranked
      .filter((candidate) => candidate.family !== family && isFamilyProductionReady(candidate.family))
      .slice(0, 2)
      .map((candidate) => ({ family: candidate.family, why: alternateReason(candidate) })),
    preflight,
    fallback: true,
  };
}

interface RawPick {
  family?: string;
  reasoning?: string;
  confidence?: number;
  alternates?: { family?: string; why?: string }[];
}

function validFamily(value: unknown): value is FamilyKey {
  return typeof value === "string" && FAMILY_KEYS.includes(value as FamilyKey);
}

function modelAlternates(raw: RawPick | null, chosen: FamilyKey, ranked: RankedFormatCandidate[]): { family: FamilyKey; why: string }[] {
  const fromModel = (Array.isArray(raw?.alternates) ? raw!.alternates : [])
    .flatMap((item) => validFamily(item?.family) && item.family !== chosen && isFamilyProductionReady(item.family)
      ? [{ family: item.family, why: typeof item?.why === "string" && item.why.trim() ? item.why.trim() : alternateReason(ranked.find((candidate) => candidate.family === item.family) ?? { family: item.family, score: 0, matchedSignals: [] }) }]
      : []);
  const fallback = ranked
    .filter((candidate) => candidate.family !== chosen && isFamilyProductionReady(candidate.family))
    .map((candidate) => ({ family: candidate.family, why: alternateReason(candidate) }));
  const unique = new Map<FamilyKey, { family: FamilyKey; why: string }>();
  for (const item of [...fromModel, ...fallback]) if (!unique.has(item.family)) unique.set(item.family, item);
  return [...unique.values()].slice(0, 2);
}

/**
 * Recommend a production format. The model gives semantic nuance, while real
 * pipeline preflight prevents an attractive label from being represented as a
 * viable auto-created channel when its renderer or required evidence is absent.
 */
export async function selectFormat(
  input: FormatSelectionInput,
  log: (message: string) => void = () => {},
): Promise<FormatRecommendation> {
  const concept = input.concept?.trim();
  if (!concept) {
    return recommendFormatDeterministically(input, "No concept provided — defaulted to the most general narrated production recipe.");
  }

  const ranked = rankFormatCandidates(input);
  const deterministic = recommendFormatDeterministically(input);
  const prompt =
    "You are a YouTube channel architect. Choose the one repeatable PRODUCTION FORMAT that best fits the channel's storytelling unit, audience, and visual grammar. " +
    "Do not choose based on a fashionable aesthetic alone. Respect source-evidence requirements and explain the main tradeoff. " +
    "Every selection still requires a held-out validation render before a channel can be promoted.\n\n" +
    `CHANNEL CONCEPT: ${concept}\n` +
    (input.niche ? `NICHE: ${input.niche}\n` : "") +
    (input.audience ? `AUDIENCE: ${input.audience}\n` : "") +
    (input.sampleTopics?.length ? `SAMPLE TOPICS: ${input.sampleTopics.join("; ")}\n` : "") +
    `\nREAL FORMAT CATALOG:\n${catalogForPrompt(input)}\n\n` +
    "Return STRICT JSON: {\"family\":\"<exact key>\",\"reasoning\":\"<=2 sentences\",\"confidence\":0..1," +
    "\"alternates\":[{\"family\":\"<key>\",\"why\":\"<short tradeoff>\"}]}.";

  let pick: RawPick | null = null;
  try {
    pick = await geminiJson<RawPick>({ prompt, maxTokens: 600, temperature: 0.2 });
  } catch (error) {
    log(`selectFormat: semantic advisor unavailable (${error instanceof Error ? error.message : error}); using deterministic ranking`);
  }

  const modelFamily = validFamily(pick?.family) ? pick.family : undefined;
  const modelRank = modelFamily ? ranked.find((candidate) => candidate.family === modelFamily) : undefined;
  const strongDeterministicLead = ranked[0].score >= 3 && (modelRank?.score ?? 0) === 0;
  if (!modelFamily || strongDeterministicLead) {
    const reason = strongDeterministicLead
      ? `The semantic pick conflicted with a strong, explicit format signal; ${deterministic.reasoning}`
      : pick?.reasoning?.trim() || deterministic.reasoning;
    log(`selectFormat: deterministic → ${deterministic.family}${strongDeterministicLead ? " (model contradicted explicit format signal)" : ""}`);
    return { ...deterministic, reasoning: reason };
  }

  const family = modelFamily;
  const preflight = formatPreflight(family, input);
  const confidence = Math.max(0, Math.min(1, typeof pick?.confidence === "number" ? pick.confidence : confidenceForRank(modelRank!, ranked[1])));
  log(`selectFormat: ${modelFamily} → ${family} (confidence ${confidence.toFixed(2)}, production=${preflight.productionReady ? "ready" : "blocked"})`);
  return {
    family,
    available: preflight.productionReady,
    crew: canonicalCrew(family, input),
    reasoning: !preflight.productionReady
      ? `${FAMILIES[family].label} is the best semantic fit, but its production renderer is currently blocked. No unlike substitute was selected automatically; ${preflight.fallbackFamily ? `${FAMILIES[preflight.fallbackFamily].label} is shown only as an operator-visible alternative.` : "a benchmarked renderer is required."}`
      : pick?.reasoning?.trim() || `Best semantic fit for the ${FAMILIES[modelFamily].label} production recipe.`,
    confidence,
    alternates: modelAlternates(pick, family, ranked),
    preflight,
    fallback: false,
  };
}
