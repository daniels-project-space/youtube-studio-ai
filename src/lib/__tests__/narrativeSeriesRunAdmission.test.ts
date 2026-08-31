import assert from "node:assert/strict";

import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import {
  channelProgramRouteRunSeed,
  channelProgramRouteRunSeedFingerprint,
  resolveChannelProgramRoute,
} from "@/engine/channelProgramRoute";
import { createNarrativeSeriesPlan } from "@/engine/narrativeSeriesIntelligence";
import {
  assertNarrativeSeriesNoGenericSchedule,
  assertNarrativeSeriesNoGenericTopicFastPath,
  assertNarrativeSeriesRunAdmission,
  assertNarrativeSeriesVisualControlComposition,
  createNarrativeSeriesRunSelector,
  narrativeSeriesRunAdmissionSeed,
  NARRATIVE_SERIES_VISUAL_CONTROL_BLOCK,
} from "@/lib/narrativeSeriesRunAdmission";
import { serializedProgramEpisodeIdentity } from "@/lib/serializedProgramEpisode";

const ownerId = "owner-narrative-series";
const channelId = "channel-narrative-series";

const brief = createChannelProgramBrief({
  family: "narrated_stock",
  nicheKey: "history",
  locale: "en",
  concept: "A recurring historical programme with a clear episode-to-episode promise.",
  serializedProgram: {
    version: "serialized_program/v1",
    seriesTitle: "The Workshop Chronicles",
    seriesCount: 3,
  },
});
const route = resolveChannelProgramRoute(brief);
const routeSeed = channelProgramRouteRunSeed({ route, programBrief: brief });
const seriesIdentity = serializedProgramEpisodeIdentity(routeSeed);
if (!seriesIdentity) throw new Error("serialized test route must produce a durable identity");

const plan = createNarrativeSeriesPlan({
  accountId: ownerId,
  channelId,
  seriesIdentity: seriesIdentity.value,
  channelProgramBrief: brief,
  visualStyle: "drawn",
  planningHorizonEpisodes: 2,
  topicCandidates: [
    {
      topic: "The Workshop Chronicles — Part 1 of 3: The first tool changes the town",
      premise: "A curious maker learns why one shared tool changes how neighbours work together.",
      recurringCharacterIds: ["mira"],
      discovery: {
        status: "editorial_hypothesis",
        nicheKey: "history",
        audienceNeed: "Understand a practical historical change through an ongoing character-led story.",
        queryHypotheses: ["how workshop tools changed daily life"],
        evidenceRefs: ["research:workshop-tools/v1"],
      },
    },
    {
      topic: "The Workshop Chronicles — Part 2 of 3: The bridge carries the idea further",
      premise: "The same maker sees how a new bridge spreads the workshop's change beyond one street.",
      recurringCharacterIds: ["mira"],
      discovery: {
        status: "editorial_hypothesis",
        nicheKey: "history",
        audienceNeed: "See how an episode can continue an audience question without repeating the first premise.",
        queryHypotheses: ["how bridges changed workshop trade"],
        evidenceRefs: ["research:workshop-bridge/v1"],
      },
    },
  ],
});

const selector = createNarrativeSeriesRunSelector({
  version: "narrative-series-run-selector/v1",
  seriesPlanFingerprint: plan.fingerprint,
  seriesIdentity: plan.seriesIdentity,
  routeFingerprint: routeSeed.routeFingerprint,
  routeRunSeedFingerprint: channelProgramRouteRunSeedFingerprint(routeSeed),
  programBriefFingerprint: plan.programBriefFingerprint,
  acceptedCharacterAdapters: [],
});

const admission = assertNarrativeSeriesRunAdmission({
  selector,
  plan,
  ownerId,
  channelId,
  routeSeed,
});
assert.equal(admission.plan.fingerprint, plan.fingerprint);
assert.deepEqual(narrativeSeriesRunAdmissionSeed(admission), {
  narrativeSeriesRunSelector: selector,
});

const mismatchedSelector = createNarrativeSeriesRunSelector({
  version: "narrative-series-run-selector/v1",
  seriesPlanFingerprint: "a".repeat(64),
  seriesIdentity: plan.seriesIdentity,
  routeFingerprint: routeSeed.routeFingerprint,
  routeRunSeedFingerprint: channelProgramRouteRunSeedFingerprint(routeSeed),
  programBriefFingerprint: plan.programBriefFingerprint,
  acceptedCharacterAdapters: [],
});
assert.throws(
  () => assertNarrativeSeriesRunAdmission({
    selector: mismatchedSelector,
    plan,
    ownerId,
    channelId,
    routeSeed,
  }),
  /does not match the immutable plan and frozen Program Route/,
  "a selector mismatch must fail before a runtime can reach bootstrap or a provider",
);

assert.throws(
  () => assertNarrativeSeriesNoGenericTopicFastPath({
    selector,
    plannedTopic: "A generic calendar topic",
    reuseTopic: undefined,
  }),
  /generic plannedTopic cannot bypass/,
  "a selected narrative plan must never enter the generic plannedTopic shortcut",
);
assert.throws(
  () => assertNarrativeSeriesNoGenericSchedule({
    selector,
    scheduledPlan: { planItemId: "generic-content-plan" },
    reuse: undefined,
  }),
  /generic content-plan schedule/,
  "the run admission boundary rejects contentPlan before it can become seed data",
);
assert.throws(
  () => assertNarrativeSeriesVisualControlComposition({
    selector,
    routeSeed,
    contentLaneKey: routeSeed.contentLaneKey,
    orderedBlocks: [
      "serialized_program_episode_context",
      "story_spine",
      "episode_graph",
      NARRATIVE_SERIES_VISUAL_CONTROL_BLOCK,
    ],
  }),
  /only compatible with the cinematic_ai lane/,
  "a non-cinematic serialized route cannot silently materialize cinematic shot controls",
);

console.log("narrative series run admission tests passed");
