/**
 * Source-attributed data-story contract.
 *
 * This is intentionally a small configuration contract over the existing
 * `visual_inserts` renderer, not a new content family or renderer. It makes
 * the evidence needed for chart-led narration explicit and gives the runtime a
 * deterministic, provider-independent reason to refuse an unsupported claim.
 */
import type { FamilyKey } from "./families";

export const DATA_STORY_CONTRACT_VERSION = "source-attributed-data-story/v1" as const;
export const DATA_STORY_SUPPORTED_FAMILIES = ["narrated_stock"] as const satisfies readonly FamilyKey[];
export const DATA_STORY_INSERT_TYPES = [
  "big_stat",
  "line_chart",
  "bar_compare",
  "annotated_line",
  "lower_third",
] as const;
export const DATA_STORY_MIN_SOURCED_NUMERIC_SENTENCES = 3;

export interface DataStoryContract {
  version: typeof DATA_STORY_CONTRACT_VERSION;
  /** A visualized numeric claim must name a concrete source in its sentence. */
  requireNamedSource: true;
  /** The insert is allowed only when the exact numeric anchor is narrated. */
  requireSpokenNumericAnchor: true;
}

/**
 * The Remotion renderer itself is reusable, but its current insert planner is
 * provider-backed. Keep that fact separate from family readiness so a future
 * no-Gemini narrated-stock planner cannot accidentally admit this profile.
 */
export interface DataStoryAutomationAdmission {
  autonomous: false;
  blockers: readonly string[];
  remediation: string;
}

export const DATA_STORY_AUTOMATION_ADMISSION: DataStoryAutomationAdmission = Object.freeze({
  autonomous: false,
  blockers: [
    "Source-attributed Data Story: no-Gemini visual-insert planner is not registered; visual_inserts still uses provider-backed insert planning.",
  ],
  remediation: "Register a non-Gemini visual-insert planner that preserves the named-source and spoken-anchor contract before admitting automatic production.",
});

/**
 * The only contract accepted at the channel-design boundary. Deliberately not
 * a loose boolean: callers have to opt into every evidence requirement.
 */
export const SOURCE_ATTRIBUTED_DATA_STORY: DataStoryContract = Object.freeze({
  version: DATA_STORY_CONTRACT_VERSION,
  requireNamedSource: true,
  requireSpokenNumericAnchor: true,
});

export interface DataStoryIntent {
  concept?: string;
  niche?: string;
  nicheKey?: string;
  audience?: string;
  sampleTopics?: readonly string[];
}

export interface DataStoryModuleRecommendation {
  block: "visual_inserts";
  profile: "source_attributed_data_story";
  contract: DataStoryContract;
  /** Never claim autonomous production merely because the renderer is wired. */
  automationAdmission: DataStoryAutomationAdmission;
  /** Visible before an operator opts in; these are release requirements, not prompts. */
  requirements: readonly string[];
  qualityFocus: readonly string[];
}

const DATA_STORY_SIGNALS = [
  "data story",
  "data stories",
  "data storytelling",
  "data visualization",
  "data visualisation",
  "chart led",
  "chart-led",
  "animated charts",
  "ranked comparison",
  "ranked comparisons",
  "statistical breakdown",
  "statistics breakdown",
  "market share analysis",
  "economic data",
  "economic analysis",
  "numbers explained",
  "evidence backed data",
] as const;

const DATA_STORY_REQUIREMENTS = [
  "A named concrete source in every numeric sentence selected for an insert.",
  `At least ${DATA_STORY_MIN_SOURCED_NUMERIC_SENTENCES} named-source numeric sentences per episode; un-attributed figures do not render.`,
  "Every visual anchor must be spoken verbatim in its narration sentence.",
] as const;

const DATA_STORY_QUALITY_FOCUS = [
  "claim-to-source traceability",
  "spoken-number fidelity",
  "legible chart timing",
] as const;

export function isDataStoryContract(value: unknown): value is DataStoryContract {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === DATA_STORY_CONTRACT_VERSION
    && candidate.requireNamedSource === true
    && candidate.requireSpokenNumericAnchor === true;
}

/** Module-level admission is intentionally distinct from family readiness. */
export function dataStoryProductionReadiness(): DataStoryAutomationAdmission {
  return DATA_STORY_AUTOMATION_ADMISSION;
}

/** Strict runtime recognition for the serialized block params. */
export function hasSourceAttributedDataStoryParams(params: Record<string, unknown> | undefined): boolean {
  return params?.dataStoryContract === DATA_STORY_CONTRACT_VERSION
    && params.requireNamedSource === true
    && params.requireSpokenNumericAnchor === true;
}

export function supportsDataStoryFamily(family: string | undefined): family is (typeof DATA_STORY_SUPPORTED_FAMILIES)[number] {
  return Boolean(family && (DATA_STORY_SUPPORTED_FAMILIES as readonly string[]).includes(family));
}

export function dataStoryInsertParams(contract: DataStoryContract): Record<string, unknown> {
  return {
    insertTypes: [...DATA_STORY_INSERT_TYPES],
    dataStoryContract: contract.version,
    requireNamedSource: contract.requireNamedSource,
    requireSpokenNumericAnchor: contract.requireSpokenNumericAnchor,
  };
}

function normalizedIntent(input: DataStoryIntent): string {
  return [
    input.concept,
    input.niche,
    input.nicheKey?.replace(/[_-]+/g, " "),
    input.audience,
    ...(input.sampleTopics ?? []),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLocaleLowerCase();
}

/**
 * Deliberately conservative discovery: generic finance, history, and generic
 * "data" language are not enough to activate a recommendation. The operator
 * sees a recommendation, then explicitly accepts its contract in the wizard.
 */
export function dataStoryRecommendationForIntent(
  input: DataStoryIntent,
  family: FamilyKey | string | undefined,
): DataStoryModuleRecommendation[] {
  if (!supportsDataStoryFamily(family)) return [];
  const intent = normalizedIntent(input);
  if (!DATA_STORY_SIGNALS.some((signal) => intent.includes(signal))) return [];
  return [{
    block: "visual_inserts",
    profile: "source_attributed_data_story",
    contract: SOURCE_ATTRIBUTED_DATA_STORY,
    automationAdmission: DATA_STORY_AUTOMATION_ADMISSION,
    requirements: DATA_STORY_REQUIREMENTS,
    qualityFocus: DATA_STORY_QUALITY_FOCUS,
  }];
}

const ATTRIBUTION_PREFIX = /\b(?:according to|data (?:from|by)|figures? (?:from|by)|reported by|reports? (?:from|by)|statistics (?:from|by)|analysis (?:from|by))\s+([^.!?;:]+)/i;
const SOURCE_FILLER_WORDS = new Set([
  "a", "an", "the", "study", "report", "survey", "research", "analysis",
  "source", "database", "paper", "article", "figures", "data", "statistics",
]);

/**
 * A lightweight, deterministic eligibility check. It does not try to verify a
 * source's truthfulness; it only makes a vague "a study says" ineligible for
 * rendering. Full factual verification remains the channel research/QA job.
 */
export function hasNamedSourceAttribution(sentence: string): boolean {
  const attribution = sentence.replace(/\s+/g, " ").match(ATTRIBUTION_PREFIX);
  if (!attribution?.[1]) return false;
  const sourceWords = attribution[1].match(/[A-Za-z][A-Za-z0-9&.'’\-]*/g) ?? [];
  return sourceWords.some((word) => {
    const normalized = word.replace(/[.'’\-]+$/g, "").toLocaleLowerCase();
    return /[A-Z]/.test(word) && !SOURCE_FILLER_WORDS.has(normalized);
  });
}
