import assert from "node:assert/strict";

import {
  CERTIFIED_QUIZ_CATEGORY_KEYS,
  CERTIFIED_QUIZ_PROFILE_KEYS,
  CERTIFIED_QUIZ_PROFILE_OPTIONS,
  resolveCertifiedQuizProfile,
} from "@/engine/certifiedQuizProfile";
import { designPipeline } from "@/engine/designer";
import { MODULE_CATALOG } from "@/engine/moduleCatalog";
import { QUIZ_YEAR_TOPIC_KEYS } from "@/lib/quizYearFacts";
import { resolveCertifiedNoGeminiCategories } from "@/trigger/blocks/quizYearBlocks";
import { assertCertifiedQuizTopicPlan } from "@/trigger/blocks/quizPlanningBlocks";

function params(family: ReturnType<typeof designPipeline>, block: string): Record<string, unknown> {
  const entry = family.pipeline.find((candidate) => candidate.block === block);
  assert(entry, `expected ${block} in the QuizYear pipeline`);
  return (entry.params ?? {}) as Record<string, unknown>;
}

assert.deepEqual(
  CERTIFIED_QUIZ_PROFILE_KEYS,
  ["world_geography", "chemistry_challenge", "discovery_timeline", "screen_game_timeline", "sports_championship_timeline"],
  "the creator exposes exactly the five independently certified QuizYear identities",
);
assert.equal(CERTIFIED_QUIZ_PROFILE_OPTIONS.length, 5);

for (const profile of CERTIFIED_QUIZ_PROFILE_OPTIONS) {
  assert.ok(profile.categories.length > 0, `${profile.key} must own at least one deterministic category`);
  assert.ok(profile.topicKeys.length > 0, `${profile.key} must own existing source-topic keys`);
  assert.ok(
    profile.categories.every((category) => CERTIFIED_QUIZ_CATEGORY_KEYS.includes(category)),
    `${profile.key} may only use deterministic QuizYear categories`,
  );
  assert.ok(
    profile.topicKeys.every((topic) => QUIZ_YEAR_TOPIC_KEYS.includes(topic)),
    `${profile.key} may only use existing certified QuizYear source keys`,
  );
  assert.ok(
    !new Set<string>(profile.categories).has("general_knowledge"),
    `${profile.key} must never expose general_knowledge`,
  );

  const design = designPipeline({ family: "quizyear", quizProfile: profile.key });
  assert.equal(design.productionReady, true, `${profile.key} must compile as production-ready`);
  assert.equal(params(design, "quiz_topic_plan").quizProfile, profile.key);
  assert.equal(params(design, "quiz_year").quizProfile, profile.key);
  assert.equal(params(design, "quiz_year").categories, profile.categories.join(","));
  assert.deepEqual(
    resolveCertifiedNoGeminiCategories(undefined, profile.key),
    [...profile.categories],
    `${profile.key} must resolve its exact safe default at the renderer boundary`,
  );
  assert.deepEqual(
    resolveCertifiedNoGeminiCategories(profile.categories.join(","), profile.key),
    [...profile.categories],
  );
  assert.throws(
    () => resolveCertifiedNoGeminiCategories("general_knowledge", profile.key),
    /does not allow general_knowledge/,
    `${profile.key} rejects the former model-backed category at runtime`,
  );
}

assert.throws(
  () => designPipeline({
    family: "quizyear",
    quizProfile: "world_geography",
    paramOverrides: { quiz_year: { categories: "general_knowledge" } },
  }),
  /categories and topics are owned/,
  "the compiler fails before reporting a raw general_knowledge override as ready",
);

assert.throws(
  () => resolveCertifiedQuizProfile("invented_trivia"),
  /unknown certified QuizYear profile/,
);

const quizModule = MODULE_CATALOG.find((module) => module.block === "quiz_year");
assert(quizModule, "QuizYear remains exposed in the creator's real module catalog");
assert.ok(
  !quizModule.params.some((field) => field.key === "categories" || field.key === "topic"),
  "the creator cannot emit stale free-form category or topic overrides",
);
assert.doesNotMatch(quizModule.description, /general knowledge/i);

const geographyProfile = resolveCertifiedQuizProfile("world_geography");
const geographyPlan = assertCertifiedQuizTopicPlan({
  version: "quiz-curated-wikidata-planner/v1",
  profileKey: "world_geography",
  topicKey: "landmark_architecture",
  topic: "World Geography Trivia Challenge #1",
  episodeOrdinal: 1,
  memoryKey: "quiz-topic/v1/profile-test/landmark_architecture/1",
  provenance: {
    registry: "quiz-year-topics/v1",
    sourceLicense: "Wikidata CC0-1.0",
    selection: "least-used curated topic with deterministic tie-break",
    previousEpisodesForTopic: 0,
  },
}, geographyProfile);
assert.equal(geographyPlan.profileKey, "world_geography");
assert.throws(
  () => assertCertifiedQuizTopicPlan(geographyPlan, resolveCertifiedQuizProfile("chemistry_challenge")),
  /malformed or is not from the certified curated planner/,
  "the renderer cannot pair a certified plan with another profile's pipeline",
);

console.log("certified QuizYear profile compiler/UI/runtime test passed");
