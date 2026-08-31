import assert from "node:assert/strict";

import {
  assertChannelProgramRouteBinding,
  assertChannelProgramRoutePipelineCompatibility,
  assertChannelProgramRouteRunSeed,
  channelProgramRouteRunSeedFingerprint,
  channelProgramRouteRunSeed,
  parseChannelProgramRoute,
  resolveChannelProgramRoute,
} from "@/engine/channelProgramRoute";
import {
  createChannelProgramBrief,
  SERIALIZED_PROGRAM_VERSION,
} from "@/engine/channelProgramBrief";
import { SOURCE_ATTRIBUTED_DATA_STORY } from "@/engine/dataStory";
import { designPipeline } from "@/engine/designer";
import { syntheticScenarioContract } from "@/engine/syntheticScenario";

const brief = (input: Readonly<Record<string, unknown>>) =>
  createChannelProgramBrief({
    nicheKey: "educational",
    locale: "en",
    concept: "A clear, original channel program with a repeatable viewer promise.",
    ...input,
  });

const narrated = brief({ family: "narrated_stock" });
const narratedRoute = resolveChannelProgramRoute(narrated);
assert.equal(narratedRoute.routeKey, "narrated-stock/foundation/v1");
assertChannelProgramRouteBinding({ route: narratedRoute, programBrief: narrated });
assertChannelProgramRoutePipelineCompatibility({
  route: narratedRoute,
  programBrief: narrated,
  pipeline: [{ block: "topic_select" }, { block: "script_gen" }, { block: "qa_script" }],
});

const serializedNarrated = brief({
  family: "narrated_stock",
  serializedProgram: {
    version: SERIALIZED_PROGRAM_VERSION,
    seriesTitle: "Seven Days of Better Questions",
    seriesCount: 7,
  },
});
const serializedNarratedRoute = resolveChannelProgramRoute(serializedNarrated);
assert.deepEqual(serializedNarratedRoute.serializedProgram, serializedNarrated.serializedProgram);
assert.notEqual(
  serializedNarratedRoute.fingerprint,
  narratedRoute.fingerprint,
  "serialized_program/v1 must change the sealed route fingerprint",
);
const serializedNarratedDesign = designPipeline({
  family: serializedNarrated.family,
  nicheKey: serializedNarrated.nicheKey,
  programBrief: serializedNarrated,
  programRoute: serializedNarratedRoute,
});
const serializedTopicSelect = serializedNarratedDesign.pipeline.find((entry) => entry.block === "topic_select");
assert.equal(
  serializedTopicSelect?.params?.seriesTitle,
  "Seven Days of Better Questions",
  "the designer must derive Topic Select series title from the sealed route",
);
assert.equal(
  serializedTopicSelect?.params?.seriesCount,
  7,
  "the designer must derive Topic Select series count from the sealed route",
);
assertChannelProgramRoutePipelineCompatibility({
  route: serializedNarratedRoute,
  programBrief: serializedNarrated,
  pipeline: serializedNarratedDesign.pipeline,
});
const serializedContextIndex = serializedNarratedDesign.pipeline.findIndex(
  (entry) => entry.block === "serialized_program_episode_context",
);
const serializedTopicIndex = serializedNarratedDesign.pipeline.findIndex(
  (entry) => entry.block === "topic_select",
);
assert.equal(
  serializedContextIndex,
  serializedTopicIndex + 1,
  "a serialized route must materialize its route-owned receipt immediately after Topic Select",
);
for (const consumer of ["director_brief", "script_gen", "qa_script", "story_spine", "metadata", "thumbnail_gen", "qa_visual"]) {
  const consumerIndex = serializedNarratedDesign.pipeline.findIndex((entry) => entry.block === consumer);
  if (consumerIndex >= 0) {
    assert.ok(
      serializedContextIndex < consumerIndex,
      `the immutable serial receipt must precede ${consumer}`,
    );
  }
}
assert.throws(
  () => assertChannelProgramRoutePipelineCompatibility({
    route: serializedNarratedRoute,
    programBrief: serializedNarrated,
    pipeline: serializedNarratedDesign.pipeline.filter(
      (entry) => entry.block !== "serialized_program_episode_context",
    ),
  }),
  /requires exactly one serialized_program_episode_context bridge/,
  "a serialized route must not silently fall back to mutable continuity when its receipt bridge is absent",
);
assert.throws(
  () => assertChannelProgramRoutePipelineCompatibility({
    route: serializedNarratedRoute,
    programBrief: serializedNarrated,
    pipeline: [
      ...serializedNarratedDesign.pipeline,
      { block: "serialized_program_episode_context" },
    ],
  }),
  /requires exactly one serialized_program_episode_context bridge/,
  "the route must reject an ambiguous second continuity receipt",
);
const serialContextEntry = serializedNarratedDesign.pipeline.find(
  (entry) => entry.block === "serialized_program_episode_context",
);
if (!serialContextEntry) throw new Error("serialized design must include its context bridge");
assert.throws(
  () => assertChannelProgramRoutePipelineCompatibility({
    route: serializedNarratedRoute,
    programBrief: serializedNarrated,
    pipeline: [
      serialContextEntry,
      ...serializedNarratedDesign.pipeline.filter(
        (entry) => entry.block !== "serialized_program_episode_context",
      ),
    ],
  }),
  /requires topic_select before serialized_program_episode_context/,
  "a receipt cannot be read before the atomic Topic Select completion that creates it",
);
assert.throws(
  () => assertChannelProgramRoutePipelineCompatibility({
    route: narratedRoute,
    programBrief: narrated,
    pipeline: [
      { block: "topic_select" },
      { block: "serialized_program_episode_context" },
      { block: "script_gen" },
      { block: "qa_script" },
    ],
  }),
  /cannot include a serialized_program_episode_context bridge/,
  "non-serialized routes must retain their legacy pipeline without admitting the bridge",
);
assert.throws(
  () => assertChannelProgramRoutePipelineCompatibility({
    route: serializedNarratedRoute,
    programBrief: serializedNarrated,
    pipeline: serializedNarratedDesign.pipeline.map((entry) => entry.block === "topic_select"
      ? { ...entry, params: { ...entry.params, seriesTitle: "Unsealed replacement" } }
      : entry),
  }),
  /seriesTitle to match serialized_program\/v1/,
  "a pipeline cannot retitle a sealed series through mutable Topic Select params",
);
assert.throws(
  () => designPipeline({
    family: serializedNarrated.family,
    nicheKey: serializedNarrated.nicheKey,
    programBrief: serializedNarrated,
    programRoute: serializedNarratedRoute,
    seriesTitle: "Unsealed replacement",
  }),
  /must be derived from the sealed channel program route/,
  "route-bearing calls must reject top-level series values before the pipeline is built",
);
assert.throws(
  () => designPipeline({
    family: serializedNarrated.family,
    nicheKey: serializedNarrated.nicheKey,
    programBrief: serializedNarrated,
    programRoute: serializedNarratedRoute,
    dataStory: SOURCE_ATTRIBUTED_DATA_STORY,
  }),
  /cannot combine with source-attributed data story admission/,
  "serialized programs must not open the source-attributed data-story path",
);
assert.throws(
  () => resolveChannelProgramRoute(brief({
    family: "quizyear",
    programIntent: { kind: "certified_quiz", profile: "world_geography" },
    serializedProgram: {
      version: SERIALIZED_PROGRAM_VERSION,
      seriesTitle: "A Quiz Series",
    },
  })),
  /requires a route whose admitted planner is topic_select/,
  "QuizYear remains on its certified planner rather than the generic serialized route modifier",
);

const sameNarratedRoute = resolveChannelProgramRoute(brief({
  family: "narrated_stock",
  audience: "busy curious adults",
  sampleTopics: ["A first bounded sample episode"],
}));
assert.equal(sameNarratedRoute.routeKey, narratedRoute.routeKey, "bounded creator context must not choose a different route");

const sports = brief({ family: "quizyear", programIntent: { kind: "sports_championship_timeline" } });
const sportsRoute = resolveChannelProgramRoute(sports);
assert.equal(sportsRoute.routeKey, "quizyear/sports-championship-timeline/v1");
assert.equal(sportsRoute.quizProfile, "sports_championship_timeline");
assert.equal(sportsRoute.admission, undefined, "the certified long-form QuizYear route remains automatic");
assert.throws(
  () => resolveChannelProgramRoute(brief({
    family: "quizyear",
    programIntent: { kind: "certified_quiz", profile: "sports_championship_timeline" },
  })),
  /requires the dedicated sports_championship_timeline program intent/,
  "the sports route must not be selectable through the generic certified-quiz alias",
);
assertChannelProgramRoutePipelineCompatibility({
  route: sportsRoute,
  programBrief: sports,
  pipeline: [
    { block: "quiz_topic_plan" },
    { block: "quiz_topic_safety" },
    { block: "quiz_year" },
    { block: "quiz_critic_spec" },
  ],
});

const sportsDesign = designPipeline({
  family: sports.family,
  nicheKey: sports.nicheKey,
  programBrief: sports,
  programRoute: sportsRoute,
});
assert.equal(
  sportsDesign.pipeline.find((entry) => entry.block === "quiz_year")?.params?.quizProfile,
  "sports_championship_timeline",
  "designer must materialize the route-owned QuizYear profile instead of trusting a raw selector",
);
assert.ok(
  !sportsDesign.pipeline.some((entry) => entry.block === "quiz_short_release"),
  "ordinary automatic QuizYear routes must never execute the supervised private-release adjunct",
);

const decision = brief({
  family: "illustrated_explainer",
  programIntent: { kind: "fictional_scenario", profile: "ai_decision" },
});
const decisionRoute = resolveChannelProgramRoute(decision);
assert.equal(decisionRoute.routeKey, "illustrated-explainer/fictional-decision-lab/v1");
assert.equal(decisionRoute.syntheticScenarioProfile, "ai_decision");
assertChannelProgramRoutePipelineCompatibility({
  route: decisionRoute,
  programBrief: decision,
  pipeline: [
    { block: "topic_select" },
    { block: "synthetic_scenario" },
    { block: "scenario_visual_treatment" },
    { block: "script_gen" },
    { block: "scenario_disclosure_gate" },
    { block: "qa_script" },
  ],
});

const decisionDesign = designPipeline({
  family: decision.family,
  nicheKey: decision.nicheKey,
  programBrief: decision,
  programRoute: decisionRoute,
});
assert.ok(decisionDesign.pipeline.some((entry) => entry.block === "synthetic_scenario"));
assert.ok(decisionDesign.pipeline.some((entry) => entry.block === "scenario_disclosure_gate"));
assert.throws(
  () => designPipeline({
    family: decision.family,
    nicheKey: decision.nicheKey,
    programBrief: decision,
    programRoute: decisionRoute,
    syntheticScenario: syntheticScenarioContract("ai_town"),
  }),
  /must match the sealed channel program route/,
);

const town = resolveChannelProgramRoute(brief({
  family: "illustrated_explainer",
  programIntent: { kind: "fictional_scenario", profile: "ai_town" },
}));
assert.equal(town.syntheticScenarioProfile, "ai_town", "existing fictional profiles must keep an exact sealed route");

const seed = channelProgramRouteRunSeed({ route: decisionRoute, programBrief: decision });
assert.equal(seed.routeFingerprint, decisionRoute.fingerprint);
assertChannelProgramRouteRunSeed({ seed, route: decisionRoute, programBrief: decision });
assert.equal(
  channelProgramRouteRunSeedFingerprint(seed),
  channelProgramRouteRunSeedFingerprint(structuredClone(seed)),
  "a replayed route seed retains its immutable full-seed fingerprint",
);
assert.notEqual(
  channelProgramRouteRunSeedFingerprint(seed),
  channelProgramRouteRunSeedFingerprint({
    ...seed,
    directives: { ...seed.directives, viewerJob: "A tampered route directive" },
  }),
  "full-seed identity changes when a directive is altered even if the route projection is unchanged",
);

assert.throws(
  () => resolveChannelProgramRoute(brief({ family: "children_learning" })),
  /private-review admission/,
);
assert.throws(
  () => resolveChannelProgramRoute(brief({ family: "quizyear" })),
  /require a canonical certified_quiz/,
);
assert.throws(
  () => assertChannelProgramRoutePipelineCompatibility({
    route: decisionRoute,
    programBrief: decision,
    pipeline: [
      { block: "topic_select" },
      { block: "script_gen" },
      { block: "synthetic_scenario" },
      { block: "scenario_visual_treatment" },
      { block: "scenario_disclosure_gate" },
      { block: "qa_script" },
    ],
  }),
  /scenario_visual_treatment before script_gen/,
);
assert.throws(
  () => parseChannelProgramRoute({ ...decisionRoute, directives: { ...decisionRoute.directives, viewerJob: "tampered" } }),
  /fingerprint is invalid/,
);

console.log("channel program route contracts passed");
