import assert from "node:assert/strict";

import {
  channelInceptionSnapshotCanResume,
  existingChannelInceptionRetryShowProfile,
} from "@/trigger/designChannelInception";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { createChannelShowProfile } from "@/engine/channelShowProfile";
import { CHANNEL_COMPOSITION_RECEIPT_VERSION } from "@/engine/channelCompositionCatalog";
import {
  CREATIVE_CAPABILITY_CATALOG,
  CREATIVE_CAPABILITY_CATALOG_FINGERPRINT,
  creativeCapabilitySelection,
} from "@/engine/creative/creativeCapabilityCatalog";
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
  version: CHANNEL_COMPOSITION_RECEIPT_VERSION,
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

// Model a future autonomous capability that has passed catalog validation but
// has not yet received an exact certified composition. The retry coordinator
// must reject that changed selection at route resolution, rather than preserve
// the historical data-story subset receipt until a later persistence check.
const uncomposedRetryCapability = {
  capability: "retry_uncomposed_capability",
  supportedFamilies: ["narrated_stock"],
  selectionMode: "explicit_opt_in",
  matches: () => true,
  materialize: () => ({
    capability: "retry_uncomposed_capability",
    title: "Retry-only uncomposed capability",
    description: "A test-only autonomous capability without a certified composition route.",
    selectionMode: "explicit_opt_in",
    modules: [],
    automationAdmission: {
      autonomous: true,
      blockers: [],
      remediation: "Register an exact certified composition before admitting this capability.",
    },
    requirements: [],
    qualityFocus: ["exact route selection"],
    pipelineObligations: [],
  }),
};
const mutableCapabilityCatalog = CREATIVE_CAPABILITY_CATALOG as unknown as Array<unknown>;
mutableCapabilityCatalog.push(uncomposedRetryCapability);
try {
  assert.throws(
    () => existingChannelInceptionRetryShowProfile({
      profile: legacyV1Profile,
      programBrief: brief,
      capabilitySelections: [
        ...capabilitySelections,
        {
          capability: "retry_uncomposed_capability",
          catalogFingerprint: CREATIVE_CAPABILITY_CATALOG_FINGERPRINT,
        },
      ],
      pipeline: design.pipeline,
    }),
    /(?:has no declared composition fragment version|no certified (?:capability composition fragment|autonomous channel composition) is registered for narrated_stock)/,
    "a retry cannot add a known uncomposed capability and inherit its historical subset route",
  );
} finally {
  mutableCapabilityCatalog.pop();
}

console.log("channel inception historical retry regression tests passed");
