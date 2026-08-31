import assert from "node:assert/strict";

import {
  buildChannelInceptionPlan,
  type ChannelInceptionRequest,
} from "@/engine/channelInceptionPlan";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import {
  channelProgramRouteFingerprint,
  resolveChannelProgramRoute,
} from "@/engine/channelProgramRoute";
import { deriveCreatorIntentDiagnosis } from "@/engine/creatorIntentDiagnosis";
import { createChannelShowProfile } from "@/engine/channelShowProfile";
import { designPipeline } from "@/engine/designer";
import {
  channelInceptionSnapshotCanResume,
  routeLessLegacyInceptionCanResume,
} from "@/trigger/designChannelInception";

const programBrief = createChannelProgramBrief({
  family: "narrated_stock",
  nicheKey: "psychology",
  locale: "en",
  concept: "A practical, recurring psychology explainer for curious adults.",
});
const programRoute = resolveChannelProgramRoute(programBrief);
const creatorIntentDiagnosis = deriveCreatorIntentDiagnosis({ programBrief, programRoute });
const design = designPipeline({
  family: programBrief.family,
  nicheKey: programBrief.nicheKey,
  locale: programBrief.locale,
  programBrief,
  quizProfile: programRoute.quizProfile,
});
const showProfile = createChannelShowProfile({
  programBrief,
  programRoute,
  pipeline: design.pipeline,
});

const request: ChannelInceptionRequest = {
  ownerId: "owner_route_persistence",
  channelRef: "channel:history-quiz",
  name: "Psychology Explained",
  slug: "psychology-explained",
  family: programBrief.family,
  nicheKey: programBrief.nicheKey,
  locale: programBrief.locale,
  sourceRevision: "route-persistence/v1",
  pipelineSourceFingerprint: "route-persistence-pipeline/v1",
  programBrief,
  programRoute,
  creatorIntentDiagnosis,
  showProfile,
  includeProbe: false,
};

const plan = buildChannelInceptionPlan(request);
const snapshotRoute = plan.requestSnapshot.programRoute;
const sealedProfileRoute = showProfile.programRoute;
assert.ok(snapshotRoute, "new plan snapshot must retain a program route");
assert.ok(sealedProfileRoute, "new show profile must retain a program route");
assert.equal(
  channelProgramRouteFingerprint(snapshotRoute),
  channelProgramRouteFingerprint(programRoute),
  "new plan snapshots carry the same sealed route as channel identity/profile",
);
assert.equal(
  channelProgramRouteFingerprint(sealedProfileRoute),
  channelProgramRouteFingerprint(programRoute),
  "show profile carries the exact canonical route receipt",
);
assert.deepEqual(
  plan.requestSnapshot.creatorIntentDiagnosis,
  creatorIntentDiagnosis,
  "new plan snapshots bind the exact sealed creator-intent diagnosis",
);

assert.equal(
  channelInceptionSnapshotCanResume({
    previousSnapshot: plan.requestSnapshot,
    ownerId: request.ownerId,
    channelRef: request.channelRef,
    slug: request.slug,
    family: request.family,
    sourceRevision: request.sourceRevision,
    moduleConfigFingerprint: plan.requestSnapshot.moduleConfigFingerprint ?? "",
    pipelineSourceFingerprint: request.pipelineSourceFingerprint,
    programBrief,
    programRoute,
    creatorIntentDiagnosis,
    showProfile,
    currentPreviewFingerprintSet: new Set(),
  }),
  true,
  "a retry resumes only when its route receipt is unchanged",
);

assert.equal(
  channelInceptionSnapshotCanResume({
    previousSnapshot: plan.requestSnapshot,
    ownerId: request.ownerId,
    channelRef: request.channelRef,
    slug: request.slug,
    family: request.family,
    sourceRevision: request.sourceRevision,
    moduleConfigFingerprint: plan.requestSnapshot.moduleConfigFingerprint ?? "",
    pipelineSourceFingerprint: request.pipelineSourceFingerprint,
    programBrief,
    programRoute,
    creatorIntentDiagnosis: {
      ...creatorIntentDiagnosis,
      fingerprint: "0".repeat(64),
    },
    showProfile,
    currentPreviewFingerprintSet: new Set(),
  }),
  false,
  "a retry cannot reuse the prior plan under a tampered creator-intent diagnosis",
);

assert.equal(
  channelInceptionSnapshotCanResume({
    previousSnapshot: plan.requestSnapshot,
    ownerId: request.ownerId,
    channelRef: request.channelRef,
    slug: request.slug,
    family: request.family,
    sourceRevision: request.sourceRevision,
    moduleConfigFingerprint: plan.requestSnapshot.moduleConfigFingerprint ?? "",
    pipelineSourceFingerprint: request.pipelineSourceFingerprint,
    programBrief,
    showProfile,
    currentPreviewFingerprintSet: new Set(),
  }),
  false,
  "a route-bearing snapshot cannot resume into a route-less retry",
);

const legacyProfile = createChannelShowProfile({
  programBrief,
  pipeline: design.pipeline,
});
const legacyPlan = buildChannelInceptionPlan({
  ...request,
  channelRef: "channel:psychology-explained-legacy",
  slug: "psychology-explained-legacy",
  programRoute: undefined,
  creatorIntentDiagnosis: undefined,
  showProfile: legacyProfile,
});
assert.equal(legacyProfile.programRoute, undefined, "legacy profile receipts remain readable");
assert.equal(legacyPlan.requestSnapshot.programRoute, undefined, "legacy plans retain their original route-less snapshot");
assert.equal(
  legacyPlan.requestSnapshot.creatorIntentDiagnosis,
  undefined,
  "legacy snapshots remain readable without inventing a creator-intent diagnosis",
);
assert.equal(
  routeLessLegacyInceptionCanResume({
    identity: {
      programBrief,
      showProfile: legacyProfile,
    },
    previousSnapshot: legacyPlan.requestSnapshot,
    ownerId: request.ownerId,
    channelRef: "channel:psychology-explained-legacy",
    slug: "psychology-explained-legacy",
    family: request.family,
    sourceRevision: request.sourceRevision,
    moduleConfigFingerprint: legacyPlan.requestSnapshot.moduleConfigFingerprint ?? "",
    pipelineSourceFingerprint: request.pipelineSourceFingerprint,
    programBrief,
    showProfile: legacyProfile,
    currentPreviewFingerprintSet: new Set(),
  }),
  true,
  "a route-less historical record can resume only into its exact route-less snapshot",
);

assert.equal(
  routeLessLegacyInceptionCanResume({
    identity: {
      programBrief,
      showProfile: legacyProfile,
    },
    previousSnapshot: {
      ...legacyPlan.requestSnapshot,
      programRoute,
    },
    ownerId: request.ownerId,
    channelRef: "channel:psychology-explained-legacy",
    slug: "psychology-explained-legacy",
    family: request.family,
    sourceRevision: request.sourceRevision,
    moduleConfigFingerprint: legacyPlan.requestSnapshot.moduleConfigFingerprint ?? "",
    pipelineSourceFingerprint: request.pipelineSourceFingerprint,
    programBrief,
    showProfile: legacyProfile,
    currentPreviewFingerprintSet: new Set(),
  }),
  false,
  "a route-less historical snapshot cannot be upgraded or resumed under a synthesized current route",
);

assert.equal(
  routeLessLegacyInceptionCanResume({
    identity: {
      programBrief,
      showProfile: legacyProfile,
    },
    previousSnapshot: legacyPlan.requestSnapshot,
    ownerId: request.ownerId,
    channelRef: "channel:psychology-explained-legacy",
    slug: "psychology-explained-legacy",
    family: request.family,
    sourceRevision: "route-persistence/v2",
    moduleConfigFingerprint: legacyPlan.requestSnapshot.moduleConfigFingerprint ?? "",
    pipelineSourceFingerprint: request.pipelineSourceFingerprint,
    programBrief,
    showProfile: legacyProfile,
    currentPreviewFingerprintSet: new Set(),
  }),
  false,
  "a changed route-less admission cannot spend work under an older durable snapshot",
);

assert.equal(
  routeLessLegacyInceptionCanResume({
    identity: {
      programBrief,
      programRoute,
      showProfile: legacyProfile,
    },
    previousSnapshot: legacyPlan.requestSnapshot,
    ownerId: request.ownerId,
    channelRef: "channel:psychology-explained-legacy",
    slug: "psychology-explained-legacy",
    family: request.family,
    sourceRevision: request.sourceRevision,
    moduleConfigFingerprint: legacyPlan.requestSnapshot.moduleConfigFingerprint ?? "",
    pipelineSourceFingerprint: request.pipelineSourceFingerprint,
    programBrief,
    showProfile: legacyProfile,
    currentPreviewFingerprintSet: new Set(),
  }),
  false,
  "a route-bearing identity cannot enter the route-less historical retry branch",
);

// A narrated baseline that existed before program routes can now be resolved
// by the current catalog. Its old series inputs remain admissible only when
// the durable route-less identity and its exact compiler output still match.
const legacySeriesTitle = "Psychology Practice, One Lesson at a Time";
const legacySeriesCount = 6;
const legacySeriesDesign = designPipeline({
  family: programBrief.family,
  nicheKey: programBrief.nicheKey,
  locale: programBrief.locale,
  programBrief,
  seriesTitle: legacySeriesTitle,
  seriesCount: legacySeriesCount,
});
const legacySeriesProfile = createChannelShowProfile({
  programBrief,
  pipeline: legacySeriesDesign.pipeline,
});
const legacySeriesPlan = buildChannelInceptionPlan({
  ...request,
  channelRef: "channel:psychology-explained-legacy-series",
  slug: "psychology-explained-legacy-series",
  sourceRevision: "route-persistence-legacy-series/v1",
  pipelineSourceFingerprint: "route-persistence-legacy-series-pipeline/v1",
  programRoute: undefined,
  creatorIntentDiagnosis: undefined,
  showProfile: legacySeriesProfile,
});
const legacySeriesRetryDesign = designPipeline({
  family: programBrief.family,
  nicheKey: programBrief.nicheKey,
  locale: programBrief.locale,
  programBrief,
  seriesTitle: legacySeriesTitle,
  seriesCount: legacySeriesCount,
});
const legacySeriesRetryProfile = createChannelShowProfile({
  programBrief,
  pipeline: legacySeriesRetryDesign.pipeline,
});
assert.equal(
  routeLessLegacyInceptionCanResume({
    identity: {
      programBrief,
      showProfile: legacySeriesProfile,
    },
    previousSnapshot: legacySeriesPlan.requestSnapshot,
    ownerId: request.ownerId,
    channelRef: "channel:psychology-explained-legacy-series",
    slug: "psychology-explained-legacy-series",
    family: request.family,
    sourceRevision: "route-persistence-legacy-series/v1",
    moduleConfigFingerprint: legacySeriesPlan.requestSnapshot.moduleConfigFingerprint ?? "",
    pipelineSourceFingerprint: "route-persistence-legacy-series-pipeline/v1",
    programBrief,
    showProfile: legacySeriesRetryProfile,
    currentPreviewFingerprintSet: new Set(),
  }),
  true,
  "a resolvable baseline route-less row can replay its exact historical series snapshot",
);
const changedLegacySeriesProfile = createChannelShowProfile({
  programBrief,
  pipeline: designPipeline({
    family: programBrief.family,
    nicheKey: programBrief.nicheKey,
    locale: programBrief.locale,
    programBrief,
    seriesTitle: legacySeriesTitle,
    seriesCount: legacySeriesCount + 1,
  }).pipeline,
});
assert.equal(
  routeLessLegacyInceptionCanResume({
    identity: {
      programBrief,
      showProfile: legacySeriesProfile,
    },
    previousSnapshot: legacySeriesPlan.requestSnapshot,
    ownerId: request.ownerId,
    channelRef: "channel:psychology-explained-legacy-series",
    slug: "psychology-explained-legacy-series",
    family: request.family,
    sourceRevision: "route-persistence-legacy-series/v1",
    moduleConfigFingerprint: legacySeriesPlan.requestSnapshot.moduleConfigFingerprint ?? "",
    pipelineSourceFingerprint: "route-persistence-legacy-series-pipeline/v1",
    programBrief,
    showProfile: changedLegacySeriesProfile,
    currentPreviewFingerprintSet: new Set(),
  }),
  false,
  "a changed legacy series input cannot reuse the prior durable snapshot",
);

console.log("channel program route persistence tests passed");
