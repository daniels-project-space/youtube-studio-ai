import assert from "node:assert/strict";

import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import {
  createNarrativeSeriesPlanFromInception,
  narrativeVisualStyleForFamily,
} from "@/engine/narrativeSeriesIntelligence";

const brief = createChannelProgramBrief({
  family: "comic",
  nicheKey: "history",
  locale: "en",
  concept: "A recurring-character comic series that explains pivotal historical choices with a clear audience promise.",
  serializedProgram: {
    version: "serialized_program/v1",
    seriesTitle: "Workshop of Tomorrow",
    seriesCount: 8,
  },
});

const researchFingerprint = "a".repeat(64);
const plan = createNarrativeSeriesPlanFromInception({
  accountId: "owner_demo",
  channelId: "channel_demo",
  seriesIdentity: "serialized_program_episode/v1/route-demo/workshop/8",
  channelProgramBrief: brief,
  researchEvidenceFingerprint: researchFingerprint,
  planningHorizonEpisodes: 3,
  topicBets: [
    {
      topic: "The workshop machine that changed a city",
      title: "The Machine That Changed a City",
      hookPromise: "A tiny design decision turns a local workshop into a city-wide problem.",
      rationale: "A durable human-scale history question drawn from current niche research.",
      betType: "narrative-explainer",
    },
    {
      topic: "The apprentice who questioned the blueprint",
      hookPromise: "A familiar apprentice discovers that the obvious blueprint hides the real trade-off.",
    },
    {
      topic: "The repair that became a public promise",
      hookPromise: "The team must repair more than a machine when their original promise reaches the public.",
    },
  ],
});

assert.equal(plan.visualStyle, "comic");
assert.equal(plan.planningHorizonEpisodes, 3);
assert.deepEqual(plan.episodes.map((episode) => episode.narrativeFunction), ["premise", "development", "payoff"]);
assert.ok(
  plan.episodes.every((episode) =>
    episode.discovery.evidenceRefs.includes(`channel-research-evidence/v1/${researchFingerprint}`),
  ),
  "every planned episode must carry the accepted research identity",
);
assert.ok(
  plan.episodes.every((episode) =>
    episode.discovery.status === "editorial_hypothesis" &&
    !episode.discovery.evidenceRefs.some((ref) => /viral|guarantee|ranking/i.test(ref)),
  ),
  "series planning must retain hypotheses, not claim discovery certainty",
);
assert.equal(narrativeVisualStyleForFamily("whiteboard"), "drawn");
assert.equal(narrativeVisualStyleForFamily("music_loop"), "other");

console.log("NARRATIVE SERIES INCEPTION PASS");
