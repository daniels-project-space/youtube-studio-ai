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

// The science-explainer proof above intentionally uses the deterministic
// scene compiler. Exercise a materially different route as well: whiteboard
// production has a native, narration-synchronised hand-draw renderer and must
// not accidentally inherit a generic image/video route while a new channel is
// being assembled.
const whiteboardBrief = createChannelProgramBrief({
  family: "whiteboard",
  nicheKey: "educational",
  subcategory: "science-explainers",
  locale: "en",
  concept:
    "Doodle Orbit explains the mechanics hidden in ordinary science through one hand-drawn visual story at a time.",
  audience: "Curious adults who want clear science explanations without jargon.",
  sampleTopics: [
    "Why a bicycle stays upright",
    "How a paper airplane turns",
    "Why the moon has phases",
  ],
});
const whiteboardRoute = resolveChannelProgramRoute(whiteboardBrief);
const whiteboardDiagnosis = deriveCreatorIntentDiagnosis({
  programBrief: whiteboardBrief,
  programRoute: whiteboardRoute,
});
const whiteboardDesign = designPipeline({
  family: whiteboardBrief.family,
  nicheKey: whiteboardBrief.nicheKey,
  subcategory: whiteboardBrief.subcategory,
  programBrief: whiteboardBrief,
  programRoute: whiteboardRoute,
  creatorIntentDiagnosis: whiteboardDiagnosis,
});
const whiteboardCompiled = completePipelineForPolicy(whiteboardDesign.pipeline);
const whiteboardProfile = createChannelShowProfile({
  programBrief: whiteboardBrief,
  programRoute: whiteboardRoute,
  pipeline: whiteboardDesign.pipeline,
});
const whiteboardRequest = {
  ownerId: "owner-proof",
  channelRef: "channel:doodle-orbit",
  name: "Doodle Orbit",
  slug: "doodle-orbit",
  family: whiteboardBrief.family,
  nicheKey: whiteboardBrief.nicheKey,
  locale: whiteboardBrief.locale,
  sourceRevision: "doodle-orbit@proof-v1",
  pipelineSourceFingerprint: "whiteboard-proof".padEnd(64, "0"),
  programBrief: whiteboardBrief,
  programRoute: whiteboardRoute,
  creatorIntentDiagnosis: whiteboardDiagnosis,
  showProfile: whiteboardProfile,
  includeProbe: false,
} as const;
const whiteboardPlan = buildChannelInceptionPlan(whiteboardRequest);

assert.equal(whiteboardRoute.routeKey, "whiteboard/foundation/v1");
assert.equal(whiteboardDesign.contentLane.key, "whiteboard_explainer");
assert.equal(
  whiteboardDesign.episodeLengthSeconds,
  480,
  "the educational niche's explicit four-minute preset is legal inside the whiteboard 60–600 second envelope",
);
assert.equal(whiteboardCompiled.entries.length, whiteboardDesign.pipeline.length);
assert.equal(whiteboardPlan.mode, "plan-only");
assert.equal(whiteboardPlan.providerCallsAuthorized, false);
for (const requiredBlock of [
  "self_contained_story_plan",
  "self_contained_story",
  "whiteboard_scribe",
  "originality_gate",
] as const) {
  assert(
    whiteboardDesign.pipeline.some((entry) => entry.block === requiredBlock),
    `the whiteboard route must retain ${requiredBlock}`,
  );
}
assert(
  !whiteboardDesign.pipeline.some((entry) => entry.block === "scene_compiler"),
  "the whiteboard route must not silently become a generic illustrated explainer",
);
assert(
  !whiteboardDesign.pipeline.some((entry) => entry.block.toLowerCase().includes("ltx")),
  "the whiteboard route must not inherit a retired LTX motion block",
);
for (const stage of whiteboardPlan.stages) {
  assert.equal(stage.providerCallsAuthorized, false);
  assert.match(stage.inputFingerprint, /^[a-f0-9]{64}$/);
  assert(stage.idempotencyKey.endsWith(stage.inputFingerprint));
}

console.log(
  `novel channel inception proof passed: illustrated ${plan.stages.length} sealed stages / ${compiled.entries.length} compiled blocks; ` +
  `whiteboard ${whiteboardPlan.stages.length} sealed stages / ${whiteboardCompiled.entries.length} compiled blocks; no provider calls`,
);
