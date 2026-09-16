import assert from "node:assert/strict";

import { buildChannelInceptionPlan, channelInceptionStage } from "@/engine/channelInceptionPlan";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { createChannelShowProfile } from "@/engine/channelShowProfile";
import { deriveCreatorIntentDiagnosis } from "@/engine/creatorIntentDiagnosis";
import { designPipeline } from "@/engine/designer";
import { completePipelineForPolicy } from "@/engine/pipelineCompiler";
import { resolveChannelProgramRoute } from "@/engine/channelProgramRoute";

/**
 * Regression proof for a channel that is not part of the existing fixture
 * corpus. This deliberately stops at the deterministic inception plan: no
 * provider, Trigger, Convex, R2, or YouTube call is authorized by this test.
 * The important boundary is that every creator handoff is real and bound to
 * the same brief/route, rather than a mock success for a familiar channel.
 */
const brief = createChannelProgramBrief({
  family: "illustrated_explainer",
  nicheKey: "educational",
  subcategory: "science-explainers",
  locale: "en",
  concept:
    "Astrograph Atlas explains the hidden mechanisms behind ordinary skies with clear diagrams and memorable experiments.",
  audience: "Curious adults who want practical science stories without jargon.",
  sampleTopics: [
    "Why eclipses repeat",
    "How satellites stay in orbit",
    "The chemistry of a sunrise",
  ],
});
const route = resolveChannelProgramRoute(brief);
const diagnosis = deriveCreatorIntentDiagnosis({ programBrief: brief, programRoute: route });
const design = designPipeline({
  family: brief.family,
  nicheKey: brief.nicheKey,
  subcategory: brief.subcategory,
  programBrief: brief,
  programRoute: route,
  creatorIntentDiagnosis: diagnosis,
});
const compiled = completePipelineForPolicy(design.pipeline);
const profile = createChannelShowProfile({
  programBrief: brief,
  programRoute: route,
  pipeline: design.pipeline,
});
const request = {
  ownerId: "owner-proof",
  channelRef: "channel:astrograph-atlas",
  name: "Astrograph Atlas",
  slug: "astrograph-atlas",
  family: brief.family,
  nicheKey: brief.nicheKey,
  locale: brief.locale,
  sourceRevision: "astrograph-atlas@proof-v1",
  pipelineSourceFingerprint: "proof".padEnd(64, "0"),
  programBrief: brief,
  programRoute: route,
  creatorIntentDiagnosis: diagnosis,
  showProfile: profile,
  includeProbe: false,
} as const;

const plan = buildChannelInceptionPlan(request);
const replay = buildChannelInceptionPlan(request);

assert.equal(route.routeKey, "illustrated-explainer/foundation/v1");
assert.equal(design.contentLane.key, "illustrated_explainer");
assert.equal(design.episodeLengthSeconds, 480);
assert.equal(compiled.entries.length, design.pipeline.length);
assert.equal(profile.programBriefFingerprint, route.programBriefFingerprint);
assert.equal(plan.mode, "plan-only");
assert.equal(plan.providerCallsAuthorized, false);
assert.deepEqual(plan, replay, "novel-channel inception must be deterministic");
assert(channelInceptionStage(plan, "channel-inception-pipeline"));
assert(channelInceptionStage(plan, "channel-inception-readiness"));
assert(
  design.pipeline.some((entry) => entry.block === "episode_graph") &&
    design.pipeline.some((entry) => entry.block === "scene_compiler"),
  "the unfamiliar science channel must receive the illustrated episode-graph route",
);
assert(
  !design.pipeline.some((entry) => entry.block.toLowerCase().includes("ltx")),
  "the novel illustrated route must not inherit a retired LTX motion block",
);
for (const stage of plan.stages) {
  assert.equal(stage.providerCallsAuthorized, false);
  assert.match(stage.inputFingerprint, /^[a-f0-9]{64}$/);
  assert(stage.idempotencyKey.endsWith(stage.inputFingerprint));
}

console.log(
  `novel channel inception proof passed: ${plan.stages.length} sealed stages, ${compiled.entries.length} compiled blocks, no provider calls`,
);
