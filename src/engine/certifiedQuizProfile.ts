import type { QuizCategoryKey } from "@/lib/quizFacts";
import type { QuizYearTopicKey } from "@/lib/quizYearFacts";

/**
 * The certified QuizYear route may only use these deterministic, Wikidata-backed
 * question shapes. `general_knowledge` intentionally is not a profile option:
 * its historical verifier path is not part of the certified no-Gemini runtime.
 */
export const CERTIFIED_QUIZ_CATEGORY_KEYS = [
  "guess_year",
  "capital_city",
  "country_currency",
  "element_symbol",
  "element_atomic_number",
] as const satisfies readonly ("guess_year" | QuizCategoryKey)[];

export type CertifiedQuizCategory = (typeof CERTIFIED_QUIZ_CATEGORY_KEYS)[number];

export const CERTIFIED_QUIZ_PROFILE_KEYS = [
  "world_geography",
  "chemistry_challenge",
  "discovery_timeline",
  "screen_game_timeline",
  "sports_championship_timeline",
] as const;

export type CertifiedQuizProfileKey = (typeof CERTIFIED_QUIZ_PROFILE_KEYS)[number];
export const CERTIFIED_QUIZ_PROFILE_VERSION = "certified-quiz-profile/v1" as const;

export interface CertifiedQuizPresentation {
  readonly titleStem: string;
  readonly keywords: readonly string[];
  readonly audiencePromise: string;
}

interface QuizProfileDefinition<Key extends string> {
  readonly version: typeof CERTIFIED_QUIZ_PROFILE_VERSION;
  readonly key: Key;
  readonly label: string;
  readonly description: string;
  readonly categories: readonly CertifiedQuizCategory[];
  /** Existing curated QuizYear source keys; never browser-provided topic text. */
  readonly topicKeys: readonly QuizYearTopicKey[];
  readonly presentation: CertifiedQuizPresentation;
}

export type CertifiedQuizProfile = QuizProfileDefinition<CertifiedQuizProfileKey>;
type LegacyCertifiedQuizProfile = QuizProfileDefinition<"legacy_mixed">;
export type ResolvedCertifiedQuizProfile = CertifiedQuizProfile | LegacyCertifiedQuizProfile;

/**
 * Four creator-visible, server-owned QuizYear identities. They only compose
 * existing fact lanes and source-topic keys, so selecting one cannot widen the
 * factual, child-safety, financial, cadence, or release contracts.
 */
export const CERTIFIED_QUIZ_PROFILES: Readonly<Record<CertifiedQuizProfileKey, CertifiedQuizProfile>> = {
  world_geography: {
    version: CERTIFIED_QUIZ_PROFILE_VERSION,
    key: "world_geography",
    label: "World Geography",
    description: "Capital-city and currency questions, grounded in the certified landmarks source route.",
    categories: ["capital_city", "country_currency"],
    topicKeys: ["landmark_architecture"],
    presentation: {
      titleStem: "World Geography Challenge",
      keywords: ["geography trivia", "capital city quiz", "currency quiz", "world geography"],
      audiencePromise: "capital cities, currencies, and well-known places verified from CC0 Wikidata statements",
    },
  },
  chemistry_challenge: {
    version: CERTIFIED_QUIZ_PROFILE_VERSION,
    key: "chemistry_challenge",
    label: "Chemistry Challenge",
    description: "Chemical-symbol and atomic-number rounds sourced from the certified science-discovery route.",
    categories: ["element_symbol", "element_atomic_number"],
    topicKeys: ["science_discovery"],
    presentation: {
      titleStem: "Chemistry Challenge",
      keywords: ["chemistry quiz", "periodic table quiz", "chemical symbols", "atomic number quiz"],
      audiencePromise: "element names, symbols, and atomic numbers verified from CC0 Wikidata statements",
    },
  },
  discovery_timeline: {
    version: CERTIFIED_QUIZ_PROFILE_VERSION,
    key: "discovery_timeline",
    label: "Discovery Timeline",
    description: "Guess-the-year rounds across the existing space, science, invention, and landmark source keys.",
    categories: ["guess_year"],
    topicKeys: ["space_exploration", "science_discovery", "invention_technology", "landmark_architecture"],
    presentation: {
      titleStem: "Discovery Timeline Trivia",
      keywords: ["history timeline quiz", "discovery trivia", "invention history", "science history quiz"],
      audiencePromise: "discoveries, inventions, landmarks, and space milestones verified from CC0 Wikidata statements",
    },
  },
  screen_game_timeline: {
    version: CERTIFIED_QUIZ_PROFILE_VERSION,
    key: "screen_game_timeline",
    label: "Screen & Game Timeline",
    description: "Guess-the-year rounds using only the existing film-release and video-game source keys.",
    categories: ["guess_year"],
    topicKeys: ["film_release", "video_games"],
    presentation: {
      titleStem: "Screen & Game Timeline Trivia",
      keywords: ["movie history quiz", "video game history", "film release trivia", "gaming timeline"],
      audiencePromise: "film releases and video-game milestones verified from CC0 Wikidata statements",
    },
  },
  sports_championship_timeline: {
    version: CERTIFIED_QUIZ_PROFILE_VERSION,
    key: "sports_championship_timeline",
    label: "Sports Championship Timeline",
    description: "Guess-the-year rounds using only the existing certified sports-championship source route.",
    categories: ["guess_year"],
    topicKeys: ["sports_championship"],
    presentation: {
      titleStem: "Sports Championship Timeline Trivia",
      keywords: ["sports history quiz", "championship trivia", "sports timeline", "title history"],
      audiencePromise: "sports championship milestones verified from CC0 Wikidata statements",
    },
  },
};

export const CERTIFIED_QUIZ_PROFILE_OPTIONS: readonly CertifiedQuizProfile[] =
  CERTIFIED_QUIZ_PROFILE_KEYS.map((key) => CERTIFIED_QUIZ_PROFILES[key]);

/**
 * Existing stored QuizYear plans did not have a profile field. Keep their
 * deterministic category/topic behavior resumable while never exposing this
 * compatibility shape in the creator selector.
 */
const LEGACY_MIXED_QUIZ_PROFILE: LegacyCertifiedQuizProfile = {
  version: CERTIFIED_QUIZ_PROFILE_VERSION,
  key: "legacy_mixed",
  label: "Mixed Trivia",
  description: "Compatibility profile for already-created certified QuizYear plans.",
  categories: CERTIFIED_QUIZ_CATEGORY_KEYS,
  topicKeys: [
    "space_exploration",
    "science_discovery",
    "invention_technology",
    "video_games",
    "film_release",
    "sports_championship",
    "landmark_architecture",
  ],
  presentation: {
    titleStem: "Mixed Trivia Challenge",
    keywords: ["trivia quiz"],
    audiencePromise: "curated quiz facts verified from CC0 Wikidata statements",
  },
};

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && !value.trim());
}

/** Resolve only a declared creator profile; omitted is the safe legacy fallback. */
export function resolveCertifiedQuizProfile(value: unknown): ResolvedCertifiedQuizProfile {
  if (isBlank(value)) return LEGACY_MIXED_QUIZ_PROFILE;
  if (typeof value !== "string") {
    throw new Error("quiz: quizProfile must be one of the certified QuizYear profile keys");
  }
  const key = value.trim() as CertifiedQuizProfileKey;
  const profile = CERTIFIED_QUIZ_PROFILES[key];
  if (!profile) {
    throw new Error(`quiz: unknown certified QuizYear profile ${JSON.stringify(value.trim())}`);
  }
  return profile;
}

export function certifiedQuizProfileCategories(profile: ResolvedCertifiedQuizProfile): string {
  return profile.categories.join(",");
}

function categoryParts(raw: unknown): string[] | undefined {
  if (isBlank(raw) || (Array.isArray(raw) && raw.length === 0)) return undefined;
  if (Array.isArray(raw)) return raw.map((value) => String(value).trim());
  if (typeof raw === "string") return raw.split(",").map((value) => value.trim());
  throw new Error("quiz: certified category configuration must be a comma-separated list");
}

/**
 * Renderer-time defense in depth. Profiles own the exact category set, rather
 * than merely banning one unsafe member from a caller-controlled list.
 */
export function resolveCertifiedQuizProfileCategories(
  profile: ResolvedCertifiedQuizProfile,
  raw: unknown,
): CertifiedQuizCategory[] {
  const parts = categoryParts(raw);
  if (!parts) return [...profile.categories];
  if (parts.includes("general_knowledge")) {
    throw new Error(
      "quiz: a certified profile does not allow general_knowledge; choose a declared deterministic QuizYear profile",
    );
  }
  const requested = new Set(parts);
  const expected = new Set(profile.categories);
  const exact = requested.size === expected.size &&
    parts.length === requested.size &&
    [...requested].every((category) => expected.has(category as CertifiedQuizCategory));
  if (!exact) {
    throw new Error(
      `quiz: categories are owned by the ${profile.key} certified profile (${profile.categories.join(", ")})`,
    );
  }
  return [...profile.categories];
}

export function profileAllowsQuizTopic(
  profile: ResolvedCertifiedQuizProfile,
  topicKey: QuizYearTopicKey,
): boolean {
  return profile.topicKeys.includes(topicKey);
}
