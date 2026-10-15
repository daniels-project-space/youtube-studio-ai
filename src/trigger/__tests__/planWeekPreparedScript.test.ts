import assert from "node:assert/strict";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { channelProgramRouteRunSeed, resolveChannelProgramRoute } from "@/engine/channelProgramRoute";
import { buildDocumentarySourceEpisodePlan, documentarySourceSeasonCandidates } from "@/engine/documentarySourceEpisodePlan";
import { assertPlanWeekPreparedScriptArgs, preparedScriptFromDocumentaryEpisodePlan } from "@/trigger/planWeekPreparedScript";
import { planWeekPreparationKey } from "@/lib/planWeekPreparation";

const scope = { ownerId: "owner1", channelSlug: "history", batchId: "week-1", itemId: "item-1" };
const base = {
  ...scope,
  channelId: "channel1",
  manifestKey: planWeekPreparationKey(scope),
  manifestSha256: "a".repeat(64),
  maxSeconds: 240,
  maxCostUsd: 2,
};
const parsed = assertPlanWeekPreparedScriptArgs(base);
assert.equal(parsed.maxSeconds, 240);
assert.equal(parsed.maxCostUsd, 2);
assert.throws(() => assertPlanWeekPreparedScriptArgs({ ...base, maxSeconds: 29 }), /between 30 and 1800/);
assert.throws(() => assertPlanWeekPreparedScriptArgs({ ...base, maxCostUsd: 0 }), /greater than zero/);
assert.throws(() => assertPlanWeekPreparedScriptArgs({ ...base, manifestKey: "owner/other/inputs.json" }), /not canonical/);

const documentaryBrief = createChannelProgramBrief({
  family: "documentary_collage_short",
  nicheKey: "history",
  locale: "en",
  concept: "Official-source archival history Shorts with a complete narrative payoff.",
});
const documentaryRoute = channelProgramRouteRunSeed({
  route: resolveChannelProgramRoute(documentaryBrief),
  programBrief: documentaryBrief,
});
const documentaryCandidate = documentarySourceSeasonCandidates({ count: 1 })[0]!;
const documentaryPlan = buildDocumentarySourceEpisodePlan({
  topic: documentaryCandidate.topic,
  route: documentaryRoute,
});
const documentaryManifest = {
  version: "plan-week-preparation/inputs-v1" as const,
  ...scope,
  channelId: "channel1",
  itemKey: "week-1:0",
  requestKey: "week-1",
  frozenAt: 1,
  plan: {
    topic: documentaryPlan.topic,
    title: documentaryCandidate.title,
    description: documentaryCandidate.description,
    sceneSeed: documentaryCandidate.sceneSeed,
    thumbnailKey: "owner/owner1/channel/history/plan/item-1.jpg",
    thumbnailSource: "planner_artwork" as const,
  },
  execution: {
    pipeline: [{ block: "script_gen" }],
    moduleConfig: {},
    seedStore: { channelProgramRoute: documentaryRoute, documentaryEpisodePlan: documentaryPlan },
  },
  prompts: { script: "", narration: "", shotlist: "", visual: "" },
};
const preparedDocumentaryScript = preparedScriptFromDocumentaryEpisodePlan(documentaryManifest)!;
assert.equal(preparedDocumentaryScript.narrationText, documentaryPlan.narrationText,
  "weekly preparation must retain the exact source-reviewed documentary narration");
assert.equal(preparedDocumentaryScript.hook, documentaryPlan.narrationSegments[0]);
assert.equal(preparedDocumentaryScript.programRouteFingerprint, documentaryRoute.routeFingerprint);
assert.throws(() => preparedScriptFromDocumentaryEpisodePlan({ ...documentaryManifest,
  plan: { ...documentaryManifest.plan, topic: "a different topic" } }), /topic differs/,
"weekly preparation must fail closed when the frozen topic diverges from the reviewed episode");
console.log("weekly prepared script producer contract passed");
