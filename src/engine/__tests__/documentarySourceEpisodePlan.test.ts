import assert from "node:assert/strict";

import {
  assertDocumentarySourceEpisodePlan,
  buildDocumentarySourceEpisodePlan,
  documentarySourceSeasonCandidates,
} from "@/engine/documentarySourceEpisodePlan";
import {
  channelProgramRouteRunSeed,
  resolveChannelProgramRoute,
} from "@/engine/channelProgramRoute";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { buildDocumentaryCollageShortStrategy } from "@/engine/documentaryCollageShort";

const programBrief = createChannelProgramBrief({
  family: "documentary_collage_short",
  nicheKey: "history",
  locale: "en",
  concept: "Official-source archival history Shorts with a complete narrative payoff.",
});
const programRoute = resolveChannelProgramRoute(programBrief);
const routeSeed = channelProgramRouteRunSeed({ route: programRoute, programBrief });
const candidates = documentarySourceSeasonCandidates({ count: 7 });

assert.equal(candidates.length, 7, "the reviewed starter season must expose seven distinct episodes");
assert.equal(new Set(candidates.map((candidate) => candidate.topic)).size, 7);

for (const candidate of candidates) {
  for (const targetDurationSec of [35, 52, 60]) {
    const plan = buildDocumentarySourceEpisodePlan({
      topic: candidate.topic,
      targetDurationSec,
      route: routeSeed,
    });
    assert.equal(plan.narrationSegments.length, 7);
    assert.equal(plan.claimEvidence.length, 7);
    assert.equal(plan.sourceReferences.length, 1);
    assert.equal(plan.targetDurationSec, targetDurationSec);
    assert.equal(plan.route.routeFingerprint, routeSeed.routeFingerprint);
    assert.deepEqual(assertDocumentarySourceEpisodePlan(plan, routeSeed), plan);
    assert.doesNotThrow(() => buildDocumentaryCollageShortStrategy({
      runId: `run:${plan.episodeKey}:${targetDurationSec}`,
      channelId: "channel:documentary-source-season",
      topic: plan.topic,
      narrationText: plan.narrationText,
      targetDurationSec,
      sources: plan.sourceReferences,
      claimEvidence: plan.claimEvidence,
    }));
  }
}

const first = buildDocumentarySourceEpisodePlan({ topic: candidates[0].topic, route: routeSeed });
assert.throws(
  () => assertDocumentarySourceEpisodePlan({ ...first, title: "Rewritten without review" }, routeSeed),
  /fingerprint is invalid/,
  "a caller cannot alter a reviewed episode after its receipt is sealed",
);
assert.throws(
  () => buildDocumentarySourceEpisodePlan({ topic: "An improvised unsupported story", route: routeSeed }),
  /without a reviewed source episode plan/,
);
assert.throws(
  () => buildDocumentarySourceEpisodePlan({
    route: routeSeed,
    usedMemoryKeys: candidates.map((candidate) =>
      buildDocumentarySourceEpisodePlan({ topic: candidate.topic, route: routeSeed }).memoryKey),
  }),
  /source season is complete/,
  "the planner must stop after the reviewed season instead of repeating or inventing an episode",
);
assert.throws(
  () => documentarySourceSeasonCandidates({
    count: 1,
    avoidTopics: candidates.map((candidate) => candidate.topic),
  }),
  /fewer than the requested/,
);

const wrongBrief = createChannelProgramBrief({
  family: "narrated_stock",
  nicheKey: "history",
  locale: "en",
  concept: "Long-form narrated history essays.",
});
const wrongRoute = resolveChannelProgramRoute(wrongBrief);
assert.throws(
  () => buildDocumentarySourceEpisodePlan({
    topic: candidates[0].topic,
    route: channelProgramRouteRunSeed({ route: wrongRoute, programBrief: wrongBrief }),
  }),
  /requires its exact frozen program route/,
);

console.log("Documentary source episode plan tests passed");
