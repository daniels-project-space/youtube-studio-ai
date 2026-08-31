import assert from "node:assert/strict";

import {
  assertCreatorIntentDiagnosisBinding,
  creatorIntentDiagnosisFingerprint,
  deriveCreatorIntentDiagnosis,
  parseCreatorIntentDiagnosis,
} from "@/engine/creatorIntentDiagnosis";
import {
  createChannelProgramBrief,
  SERIALIZED_PROGRAM_VERSION,
} from "@/engine/channelProgramBrief";
import { resolveChannelProgramRoute } from "@/engine/channelProgramRoute";

const sameLiteralConcept =
  "A repeatable series about how groups make difficult decisions under pressure.";

const sportsBrief = createChannelProgramBrief({
  family: "quizyear",
  nicheKey: "educational",
  locale: "en",
  concept: sameLiteralConcept,
  programIntent: { kind: "sports_championship_timeline" },
});
const fictionalBrief = createChannelProgramBrief({
  family: "illustrated_explainer",
  nicheKey: "educational",
  locale: "en",
  concept: sameLiteralConcept,
  programIntent: { kind: "fictional_scenario", profile: "ai_decision" },
});
const serializedBrief = createChannelProgramBrief({
  family: "shorts",
  nicheKey: "educational",
  locale: "en",
  concept: "A concise original lesson series with one practical viewer payoff in every episode.",
  serializedProgram: {
    version: SERIALIZED_PROGRAM_VERSION,
    seriesTitle: "Five Minute Curiosity",
    seriesCount: 5,
  },
});
const cinematicBrief = createChannelProgramBrief({
  family: "cinematic",
  nicheKey: "educational",
  locale: "en",
  concept: "An original visual narrative whose scenes causally advance one clear idea.",
});

const sportsRoute = resolveChannelProgramRoute(sportsBrief);
const fictionalRoute = resolveChannelProgramRoute(fictionalBrief);
const serializedRoute = resolveChannelProgramRoute(serializedBrief);
const cinematicRoute = resolveChannelProgramRoute(cinematicBrief);
const sportsDiagnosis = deriveCreatorIntentDiagnosis({
  programBrief: sportsBrief,
  programRoute: sportsRoute,
});
const fictionalDiagnosis = deriveCreatorIntentDiagnosis({
  programBrief: fictionalBrief,
  programRoute: fictionalRoute,
});
const serializedDiagnosis = deriveCreatorIntentDiagnosis({
  programBrief: serializedBrief,
  programRoute: serializedRoute,
});
const cinematicDiagnosis = deriveCreatorIntentDiagnosis({
  programBrief: cinematicBrief,
  programRoute: cinematicRoute,
});

assert.equal(sportsBrief.concept, fictionalBrief.concept, "the fixture intentionally shares literal creator prose");
assert.equal(sportsDiagnosis.claimMode, "factual_certified");
assert.equal(sportsDiagnosis.editorialGrammar.kind, "sourced_quiz_challenge");
assert.equal(sportsDiagnosis.evidenceBurden.requiresExternalSources, true);
assert.equal(sportsDiagnosis.evidenceBurden.requiresPerClaimProvenance, true);
assert.equal(sportsDiagnosis.outputShape.quizProfile, "sports_championship_timeline");
assert.equal(sportsDiagnosis.ambiguity.state, "none");
assert.equal(sportsDiagnosis.confidence, 1);

assert.equal(fictionalDiagnosis.claimMode, "fictional_disclosed");
assert.equal(fictionalDiagnosis.editorialGrammar.kind, "fictional_thought_experiment");
assert.equal(fictionalDiagnosis.evidenceBurden.requiresFictionDisclosure, true);
assert.equal(fictionalDiagnosis.evidenceBurden.requiresExternalSources, false);
assert.equal(fictionalDiagnosis.outputShape.syntheticScenarioProfile, "ai_decision");
assert.equal(fictionalDiagnosis.ambiguity.state, "none");
assert.equal(cinematicDiagnosis.claimMode, "factual_editorial");
assert.equal(cinematicDiagnosis.viewerJob.kind, "experience_a_causally_coherent_cinematic_episode");
assert.equal(cinematicDiagnosis.editorialGrammar.kind, "cinematic_narrative_episode");
assert.equal(cinematicDiagnosis.ambiguity.requiresEpisodeAdmission, true);
assert.deepEqual(
  serializedDiagnosis.outputShape.serializedProgram,
  serializedBrief.serializedProgram,
  "CreatorIntentDiagnosis must carry the exact sealed serialized_program/v1 contract",
);
assert.notEqual(
  serializedDiagnosis.fingerprint,
  deriveCreatorIntentDiagnosis({
    programBrief: createChannelProgramBrief({
      ...serializedBrief,
      serializedProgram: undefined,
    }),
    programRoute: resolveChannelProgramRoute(createChannelProgramBrief({
      ...serializedBrief,
      serializedProgram: undefined,
    })),
  }).fingerprint,
  "serialized recurrence semantics must survive diagnosis fingerprinting",
);
assert.notEqual(
  sportsDiagnosis.fingerprint,
  fictionalDiagnosis.fingerprint,
  "semantic route differences must survive identical creator prose",
);

assert.deepEqual(
  deriveCreatorIntentDiagnosis({ programBrief: sportsBrief, programRoute: sportsRoute }),
  sportsDiagnosis,
  "diagnosis must be deterministic and provider-free",
);
assert.deepEqual(
  assertCreatorIntentDiagnosisBinding({
    diagnosis: fictionalDiagnosis,
    programBrief: fictionalBrief,
    programRoute: fictionalRoute,
  }),
  fictionalDiagnosis,
  "a persisted receipt must bind exactly to its canonical brief and route",
);

const validLookingTamper = {
  ...structuredClone(fictionalDiagnosis),
  claimMode: "factual_certified" as const,
};
validLookingTamper.fingerprint = creatorIntentDiagnosisFingerprint(validLookingTamper);
assert.doesNotThrow(
  () => parseCreatorIntentDiagnosis(validLookingTamper),
  "the tamper is structurally valid and self-hashed, so binding—not shape alone—must catch it",
);
assert.throws(
  () => assertCreatorIntentDiagnosisBinding({
    diagnosis: validLookingTamper,
    programBrief: fictionalBrief,
    programRoute: fictionalRoute,
  }),
  /does not match the canonical program brief and route/,
  "a self-hashed semantic rewrite must not enter an admitted route",
);
assert.throws(
  () => assertCreatorIntentDiagnosisBinding({
    diagnosis: sportsDiagnosis,
    programBrief: fictionalBrief,
    programRoute: fictionalRoute,
  }),
  /does not match the canonical program brief and route/,
  "a diagnosis from another route cannot be replayed merely because its receipt is valid",
);

console.log("creator intent diagnosis contracts passed");
