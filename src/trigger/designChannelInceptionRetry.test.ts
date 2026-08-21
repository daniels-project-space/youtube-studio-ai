import assert from "node:assert/strict";

import {
  channelInceptionSnapshotCanResume,
  existingChannelInceptionRetryShowProfile,
} from "@/trigger/designChannelInception";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { createChannelShowProfile } from "@/engine/channelShowProfile";
import { creativeCapabilitySelection } from "@/engine/creative/creativeCapabilityCatalog";
import { designPipeline } from "@/engine/designer";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

const brief = createChannelProgramBrief({
  family: "narrated_stock",
  nicheKey: "business",
  locale: "en",
  concept: "A source-attributed data storytelling channel with animated charts and ranked comparisons.",
});
const capabilitySelections = [creativeCapabilitySelection("source_attributed_data_story")];
const design = designPipeline({
  family: brief.family,
  nicheKey: brief.nicheKey,
  locale: brief.locale,
  programBrief: brief,
  capabilitySelections,
});
const currentProfile = createChannelShowProfile({
  programBrief: brief,
  capabilitySelections,
  pipeline: design.pipeline,
});

const legacyV1DefinitionIdentity = {
  key: "source_attributed_data_story",
  definitionVersion: "v1",
  family: "narrated_stock",
  title: "Source-attributed data story",
  qualityFocus: ["named sources", "spoken numeric anchors", "readable chart progression", "causal comparison"],
  requiredCapabilityKeys: ["source_attributed_data_story"],
} as const;
const legacyV1CompositionBody = {
  version: currentProfile.composition!.version,
  key: "source_attributed_data_story",
  definitionVersion: "v1",
  definitionFingerprint: sha256Hex(canonicalJson(legacyV1DefinitionIdentity)),
  family: "narrated_stock",
  title: "Source-attributed data story",
  qualityFocus: ["named sources", "spoken numeric anchors", "readable chart progression", "causal comparison"],
} as const;
const legacyV1Composition = {
  ...legacyV1CompositionBody,
  fingerprint: sha256Hex(canonicalJson(legacyV1CompositionBody)),
} as const;
const legacyV1ProfileBody = {
  version: currentProfile.version,
  programBriefFingerprint: currentProfile.programBriefFingerprint,
  familyManifestFingerprint: currentProfile.familyManifestFingerprint,
  contentLaneFingerprint: currentProfile.contentLaneFingerprint,
  creativeCapabilityCatalogFingerprint: currentProfile.creativeCapabilityCatalogFingerprint,
  selectedCapabilityKeys: currentProfile.selectedCapabilityKeys,
  composition: legacyV1Composition,
  designedPipelineFingerprint: currentProfile.designedPipelineFingerprint,
};
const legacyV1Profile = {
  ...legacyV1ProfileBody,
  fingerprint: sha256Hex(canonicalJson(legacyV1ProfileBody)),
};

const retryProfile = existingChannelInceptionRetryShowProfile({
  profile: legacyV1Profile,
  programBrief: brief,
  capabilitySelections,
  pipeline: design.pipeline,
});
assert.deepEqual(
  retryProfile,
  legacyV1Profile,
  "the real coordinator must preserve a valid v1 receipt for its immutable retry request",
);
assert.notEqual(
  retryProfile.fingerprint,
  currentProfile.fingerprint,
  "the regression must distinguish the historical retry receipt from the newly admitted v3 receipt",
);

const priorSnapshot = {
  ownerId: "owner-retry",
  channelRef: "channel:source-data-story",
  slug: "source-data-story",
  family: brief.family,
  sourceRevision: "source-data-story@v1",
  moduleConfigFingerprint: "module-config:v1",
  pipelineSourceFingerprint: "pipeline-source:v1",
  programBrief: brief,
  showProfile: legacyV1Profile,
  starter: { acceptedPreviewFingerprints: ["accepted-preview:v1"] },
};
const retryGuardInput = {
  previousSnapshot: priorSnapshot,
  ownerId: priorSnapshot.ownerId,
  channelRef: priorSnapshot.channelRef,
  slug: priorSnapshot.slug,
  family: brief.family,
  sourceRevision: priorSnapshot.sourceRevision,
  moduleConfigFingerprint: priorSnapshot.moduleConfigFingerprint,
  pipelineSourceFingerprint: priorSnapshot.pipelineSourceFingerprint,
  programBrief: brief,
  currentPreviewFingerprintSet: new Set(["accepted-preview:v1"]),
};
assert.equal(
  channelInceptionSnapshotCanResume({ ...retryGuardInput, showProfile: retryProfile }),
  true,
  "a real v1 retry restores its original request snapshot instead of rerunning completed expensive stages",
);
assert.equal(
  channelInceptionSnapshotCanResume({ ...retryGuardInput, showProfile: currentProfile }),
  false,
  "substituting the current v3 receipt reproduces the historical retry invalidation bug",
);
assert.throws(
  () => existingChannelInceptionRetryShowProfile({
    profile: legacyV1Profile,
    programBrief: brief,
    capabilitySelections: [],
    pipeline: design.pipeline,
  }),
  /does not match/,
  "historical retry preservation cannot be used to drop the originally selected capability",
);

console.log("channel inception historical retry regression tests passed");
