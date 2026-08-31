import assert from "node:assert/strict";

import {
  assertChannelShowProfileReceiptExactComposition,
  assertChannelShowProfileReceiptPipelineCompatibility,
  assertChannelShowProfileReceiptProgramBinding,
} from "@/engine/channelShowProfileCodec";
import {
  assertChannelShowProfile,
  assertChannelShowProfilePipelineCompatibility,
  assertChannelShowProfileProgramBinding,
  channelShowProfileCapabilityKeys,
  channelShowProfileFingerprint,
  createChannelShowProfile,
  parseChannelShowProfile,
  resolveChannelShowProfileComposition,
} from "@/engine/channelShowProfile";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import {
  CREATIVE_CAPABILITY_CATALOG,
  creativeCapabilitySelection,
} from "@/engine/creative/creativeCapabilityCatalog";
import { CREATIVE_CAPABILITY_RECEIPT_CATALOG } from "@/engine/creative/creativeCapabilityReceiptCatalog";
import {
  CHANNEL_COMPOSITION_RECEIPT_VERSION,
  SOURCE_ATTRIBUTED_DATA_STORY_V3_MATERIALIZATION,
  resolveChannelCapabilityCompositionPlan,
  resolveCertifiedChannelComposition,
} from "@/engine/channelCompositionCatalog";
import { SOURCE_ATTRIBUTED_DATA_STORY, dataStoryInsertParams } from "@/engine/dataStory";
import { designPipeline } from "@/engine/designer";
import { certifiedFamilyAdmission } from "@/engine/certifiedFamilyAdmission";
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

const profile = createChannelShowProfile({
  programBrief: brief,
  capabilitySelections,
  pipeline: design.pipeline,
});

assert.throws(
  () => createChannelShowProfile({
    programBrief: brief,
    capabilitySelections,
    pipeline: design.pipeline.filter((entry) => entry.block !== "episode_graph"),
  }),
  /requires exactly one episode_graph block/,
  "a new v4 source-data capability plan must retain Episode Graph even though legacy v3 receipts do not",
);

assert.deepEqual(
  assertChannelShowProfile({
    profile,
    programBrief: brief,
    capabilitySelections,
    pipeline: design.pipeline,
  }),
  profile,
  "a profile must replay only its exact admitted composition",
);
assert.equal(channelShowProfileFingerprint(profile), profile.fingerprint);
assert.equal(profile.composition, undefined);
assert.equal(profile.compositionBinding?.kind, "capability_plan_v1");
assert.equal(
  profile.compositionBinding?.kind === "capability_plan_v1"
    ? profile.compositionBinding.plan.fragments[0]?.capability
    : undefined,
  "source_attributed_data_story",
  "the explicit existing data-story capability must become a durable capability-owned plan rather than collapse into generic narrated stock",
);
assert.deepEqual(
  profile.compositionBinding?.kind === "capability_plan_v1"
    ? profile.compositionBinding.plan
    : undefined,
  resolveChannelCapabilityCompositionPlan({
    family: brief.family,
    selectedCapabilityKeys: ["source_attributed_data_story"],
    expectedFragmentVersions: { source_attributed_data_story: "v2" },
  }),
  "the Show Profile must resolve its current sealed plan from the exact selected capability set",
);
assert.throws(
  () => resolveChannelShowProfileComposition({
    family: brief.family,
    selectedCapabilityKeys: [
      "source_attributed_data_story",
      "uncomposed_future_capability" as never,
    ],
  }),
  /no certified autonomous channel composition is registered for narrated_stock/,
  "a Show Profile must reject a new uncomposed capability combination before it can inherit a subset receipt",
);
assert.deepEqual(
  assertChannelShowProfileReceiptProgramBinding({ profile, programBrief: brief }),
  profile,
  "the Convex-safe receipt codec must retain the program/family/lane binding",
);
assert.deepEqual(
  assertChannelShowProfileReceiptPipelineCompatibility({
    profile,
    programBrief: brief,
    pipeline: design.pipeline,
  }),
  profile,
  "the Convex-safe receipt codec must retain selected capability obligations",
);
assert.deepEqual(
  assertChannelShowProfileReceiptExactComposition({
    profile,
    programBrief: brief,
    pipeline: design.pipeline,
  }),
  profile,
  "a new Convex channel write must bind the profile to its exact compiler baseline",
);
const sourceDataStoryCapabilityDefinition = CREATIVE_CAPABILITY_CATALOG.find(
  (definition) => definition.capability === "source_attributed_data_story",
);
assert.ok(sourceDataStoryCapabilityDefinition);
const mutableSourceDataStoryCapabilityDefinition =
  sourceDataStoryCapabilityDefinition as { compositionFragmentVersion?: string };
const originalSourceDataStoryFragmentVersion =
  mutableSourceDataStoryCapabilityDefinition.compositionFragmentVersion;
try {
  mutableSourceDataStoryCapabilityDefinition.compositionFragmentVersion = "v999";
  assert.throws(
    () => createChannelShowProfile({
      programBrief: brief,
      capabilitySelections,
      pipeline: design.pipeline,
    }),
    /resolves v2 but the declared fragment version is v999/,
    "the rich Show Profile admission must bind its selected capability to the declared fragment version",
  );
} finally {
  mutableSourceDataStoryCapabilityDefinition.compositionFragmentVersion =
    originalSourceDataStoryFragmentVersion;
}
const sourceDataStoryReceiptDefinition = CREATIVE_CAPABILITY_RECEIPT_CATALOG.find(
  (definition) => definition.capability === "source_attributed_data_story",
);
assert.ok(sourceDataStoryReceiptDefinition);
const mutableSourceDataStoryReceiptDefinition =
  sourceDataStoryReceiptDefinition as { compositionFragmentVersion?: string };
const originalSourceDataStoryReceiptFragmentVersion =
  mutableSourceDataStoryReceiptDefinition.compositionFragmentVersion;
try {
  mutableSourceDataStoryReceiptDefinition.compositionFragmentVersion = "v999";
  assert.throws(
    () => assertChannelShowProfileReceiptExactComposition({
      profile,
      programBrief: brief,
      pipeline: design.pipeline,
    }),
    /resolves v2 but the declared fragment version is v999/,
    "the Convex-safe Show Profile admission must enforce its matching receipt-catalog fragment version",
  );
} finally {
  mutableSourceDataStoryReceiptDefinition.compositionFragmentVersion =
    originalSourceDataStoryReceiptFragmentVersion;
}
assert.deepEqual(
  assertChannelShowProfileProgramBinding({ profile, programBrief: brief }),
  profile,
  "planning can bind a profile to the durable program before a compiler output is rehydrated",
);
assert.deepEqual(
  assertChannelShowProfilePipelineCompatibility({ profile, programBrief: brief, pipeline: design.pipeline }),
  profile,
  "later pipeline validation preserves selected capability obligations without freezing every safe refinement",
);

const reorderedCompositionPipeline = [...design.pipeline];
const visualInsertIndex = reorderedCompositionPipeline.findIndex((entry) => entry.block === "visual_inserts");
assert.ok(visualInsertIndex >= 0);
const [visualInsertEntry] = reorderedCompositionPipeline.splice(visualInsertIndex, 1);
const timelineIndex = reorderedCompositionPipeline.findIndex((entry) => entry.block === "timeline_assemble");
assert.ok(timelineIndex >= 0);
reorderedCompositionPipeline.splice(timelineIndex + 1, 0, visualInsertEntry!);
assert.throws(
  () => assertChannelShowProfilePipelineCompatibility({
    profile,
    programBrief: brief,
    pipeline: reorderedCompositionPipeline,
  }),
  /requires visual_inserts before timeline_assemble/,
  "a later refiner cannot move a sealed data-story stage after the master assembler",
);
assert.throws(
  () => assertChannelShowProfileReceiptPipelineCompatibility({
    profile,
    programBrief: brief,
    pipeline: reorderedCompositionPipeline,
  }),
  /requires visual_inserts before timeline_assemble/,
  "Convex must reject the same composition-order drift before it becomes durable",
);

const quoteAfterVisualPipeline = [...design.pipeline];
const quoteAfterVisualInsertIndex = quoteAfterVisualPipeline.findIndex((entry) => entry.block === "visual_inserts");
assert.ok(quoteAfterVisualInsertIndex >= 0);
const [quoteAfterVisualInsert] = quoteAfterVisualPipeline.splice(quoteAfterVisualInsertIndex, 1);
const quoteAfterVisualQuoteIndex = quoteAfterVisualPipeline.findIndex((entry) => entry.block === "quote_overlays");
assert.ok(quoteAfterVisualQuoteIndex >= 0);
quoteAfterVisualPipeline.splice(quoteAfterVisualQuoteIndex, 0, quoteAfterVisualInsert!);
assert.throws(
  () => assertChannelShowProfilePipelineCompatibility({
    profile,
    programBrief: brief,
    pipeline: quoteAfterVisualPipeline,
  }),
  /optional quote_overlays before visual_inserts when present/,
  "a later refiner cannot move data inserts ahead of enabled quote overlays",
);
assert.throws(
  () => assertChannelShowProfileReceiptPipelineCompatibility({
    profile,
    programBrief: brief,
    pipeline: quoteAfterVisualPipeline,
  }),
  /optional quote_overlays before visual_inserts when present/,
  "Convex must retain the enabled quote-overlay predecessor before durable storage",
);

const introAfterVisualPipeline = [...design.pipeline];
const introAfterVisualInsertIndex = introAfterVisualPipeline.findIndex((entry) => entry.block === "visual_inserts");
assert.ok(introAfterVisualInsertIndex >= 0);
const [introAfterVisualInsert] = introAfterVisualPipeline.splice(introAfterVisualInsertIndex, 1);
const introAfterVisualIntroIndex = introAfterVisualPipeline.findIndex((entry) => entry.block === "intro_card");
assert.ok(introAfterVisualIntroIndex >= 0);
introAfterVisualPipeline.splice(introAfterVisualIntroIndex, 0, introAfterVisualInsert!);
assert.throws(
  () => assertChannelShowProfilePipelineCompatibility({
    profile,
    programBrief: brief,
    pipeline: introAfterVisualPipeline,
  }),
  /intro_card before visual_inserts/,
  "a later refiner cannot move data inserts ahead of their required intro timing producer",
);
assert.throws(
  () => assertChannelShowProfileReceiptPipelineCompatibility({
    profile,
    programBrief: brief,
    pipeline: introAfterVisualPipeline,
  }),
  /intro_card before visual_inserts/,
  "Convex must retain the intro timing predecessor before durable storage",
);
assert.deepEqual(channelShowProfileCapabilityKeys(profile), ["source_attributed_data_story"]);
assert.notEqual(
  channelShowProfileCapabilityKeys(profile),
  profile.selectedCapabilityKeys,
  "capability keys must not leak a mutable persisted array",
);

const rekeyed = {
  fingerprint: profile.fingerprint,
  designedPipelineFingerprint: profile.designedPipelineFingerprint,
  selectedCapabilityKeys: profile.selectedCapabilityKeys,
  creativeCapabilityCatalogFingerprint: profile.creativeCapabilityCatalogFingerprint,
  contentLaneFingerprint: profile.contentLaneFingerprint,
  familyManifestFingerprint: profile.familyManifestFingerprint,
  programBriefFingerprint: profile.programBriefFingerprint,
  compositionBinding: profile.compositionBinding,
  version: profile.version,
};
assert.deepEqual(parseChannelShowProfile(rekeyed), profile, "object key order must not alter a show profile");
assert.throws(
  () => parseChannelShowProfile({
    ...profile,
    composition: resolveCertifiedChannelComposition({
      family: brief.family,
      selectedCapabilityKeys: profile.selectedCapabilityKeys,
    }),
  }),
  /cannot carry both legacy and modular composition authority/,
  "a profile may have exactly one sealed composition authority",
);

assert.throws(
  () => parseChannelShowProfile({ ...profile, selectedCapabilityKeys: ["source_attributed_data_story", "source_attributed_data_story"] }),
  /sorted and unique|fingerprint/,
  "duplicate selections cannot be hidden in a persisted profile",
);
const duplicateCapabilityProfileBody = {
  version: profile.version,
  programBriefFingerprint: profile.programBriefFingerprint,
  familyManifestFingerprint: profile.familyManifestFingerprint,
  contentLaneFingerprint: profile.contentLaneFingerprint,
  creativeCapabilityCatalogFingerprint: profile.creativeCapabilityCatalogFingerprint,
  selectedCapabilityKeys: ["source_attributed_data_story", "source_attributed_data_story"],
  designedPipelineFingerprint: profile.designedPipelineFingerprint,
};
assert.throws(
  () =>
    assertChannelShowProfileReceiptProgramBinding({
      profile: {
        ...duplicateCapabilityProfileBody,
        fingerprint: sha256Hex(canonicalJson(duplicateCapabilityProfileBody)),
      },
      programBrief: brief,
    }),
  /sorted and unique/,
  "Convex must reject a re-fingerprinted receipt with duplicate capability keys",
);
assert.throws(
  () => parseChannelShowProfile({ ...profile, fingerprint: "0".repeat(64) }),
  /fingerprint/,
  "a forged profile fingerprint must fail closed",
);
assert.throws(
  () => parseChannelShowProfile({
    ...profile,
    selectedCapabilityKeys: ["not-a-capability"],
  }),
  /unknown creative capability|fingerprint/,
  "a persisted profile cannot invent a catalog capability key",
);
const staleCatalogProfileBody = {
  version: profile.version,
  programBriefFingerprint: profile.programBriefFingerprint,
  familyManifestFingerprint: profile.familyManifestFingerprint,
  contentLaneFingerprint: profile.contentLaneFingerprint,
  creativeCapabilityCatalogFingerprint: "creative-capability-catalog/v0:stale",
  selectedCapabilityKeys: profile.selectedCapabilityKeys,
  designedPipelineFingerprint: profile.designedPipelineFingerprint,
};
assert.throws(
  () => parseChannelShowProfile({
    ...staleCatalogProfileBody,
    fingerprint: sha256Hex(canonicalJson(staleCatalogProfileBody)),
  }),
  /stale creative-capability catalog fingerprint/,
  "a retry cannot reuse a show profile against a changed capability catalog",
);
assert.throws(
  () =>
    assertChannelShowProfileReceiptProgramBinding({
      profile: {
        ...staleCatalogProfileBody,
        fingerprint: sha256Hex(canonicalJson(staleCatalogProfileBody)),
      },
      programBrief: brief,
    }),
  /stale creative-capability catalog fingerprint/,
  "Convex must reject a stale catalog receipt before it reaches durable storage",
);
assert.throws(
  () => assertChannelShowProfile({
    profile,
    programBrief: brief,
    capabilitySelections,
    pipeline: design.pipeline.filter((entry) => entry.block !== "visual_inserts"),
  }),
  /requires effective pipeline block visual_inserts|does not match/,
  "selected-capability obligations must survive in the sealed pipeline",
);
assert.throws(
  () => assertChannelShowProfileReceiptPipelineCompatibility({
    profile,
    programBrief: brief,
    pipeline: design.pipeline.filter((entry) => entry.block !== "visual_inserts"),
  }),
  /requires effective pipeline block visual_inserts/,
  "Convex must reject a persisted graph that drops a receipt-selected capability",
);
assert.throws(
  () => assertChannelShowProfile({
    profile,
    programBrief: brief,
    capabilitySelections: [],
    pipeline: design.pipeline,
  }),
  /does not match/,
  "a retry cannot silently drop an opted-in capability",
);

const alteredPipeline = design.pipeline.map((entry, index) => index === 0
  ? { ...entry, params: { ...entry.params, profileBaselineVariant: "changed" } }
  : entry);
const alteredProfile = createChannelShowProfile({
  programBrief: brief,
  capabilitySelections,
  pipeline: alteredPipeline,
});
assert.notEqual(
  alteredProfile.fingerprint,
  profile.fingerprint,
  "a different baseline pipeline must become a different repeatable channel composition",
);
assert.throws(
  () => assertChannelShowProfileReceiptExactComposition({
    profile,
    programBrief: brief,
    pipeline: alteredPipeline,
  }),
  /does not match the admitted channel composition/,
  "new-channel Convex admission must reject a profile replayed against a different compiler baseline",
);

const wrongComposition = resolveCertifiedChannelComposition({ family: "narrated_stock" });
const wrongCompositionBody = {
  version: profile.version,
  programBriefFingerprint: profile.programBriefFingerprint,
  familyManifestFingerprint: profile.familyManifestFingerprint,
  contentLaneFingerprint: profile.contentLaneFingerprint,
  creativeCapabilityCatalogFingerprint: profile.creativeCapabilityCatalogFingerprint,
  selectedCapabilityKeys: profile.selectedCapabilityKeys,
  composition: wrongComposition,
  designedPipelineFingerprint: profile.designedPipelineFingerprint,
};
const wrongCompositionProfile = {
  ...wrongCompositionBody,
  fingerprint: sha256Hex(canonicalJson(wrongCompositionBody)),
};
assert.throws(
  () => assertChannelShowProfile({
    profile: wrongCompositionProfile,
    programBrief: brief,
    capabilitySelections,
    pipeline: design.pipeline,
  }),
  /does not match the persisted selected capabilities|does not match the admitted channel route/,
  "a re-fingerprinted receipt cannot relabel a data story as a generic visual essay",
);
assert.throws(
  () => assertChannelShowProfileReceiptProgramBinding({
    profile: wrongCompositionProfile,
    programBrief: brief,
  }),
  /does not match the persisted selected capabilities|does not match the admitted channel route/,
  "the Convex-safe receipt codec must enforce the same selected-route binding",
);

const legacyV3DefinitionIdentity = {
  key: "source_attributed_data_story",
  definitionVersion: "v3",
  family: "narrated_stock",
  title: "Source-attributed data story",
  qualityFocus: ["named sources", "spoken numeric anchors", "readable chart progression", "causal comparison"],
  requiredCapabilityKeys: ["source_attributed_data_story"],
  materialization: SOURCE_ATTRIBUTED_DATA_STORY_V3_MATERIALIZATION,
} as const;
const legacyV3ExactCompositionBody = {
  version: CHANNEL_COMPOSITION_RECEIPT_VERSION,
  key: "source_attributed_data_story",
  definitionVersion: "v3",
  definitionFingerprint: sha256Hex(canonicalJson(legacyV3DefinitionIdentity)),
  family: "narrated_stock",
  title: "Source-attributed data story",
  qualityFocus: ["named sources", "spoken numeric anchors", "readable chart progression", "causal comparison"],
} as const;
const legacyV3ExactComposition = {
  ...legacyV3ExactCompositionBody,
  fingerprint: sha256Hex(canonicalJson(legacyV3ExactCompositionBody)),
} as const;
const legacyV3Pipeline = design.pipeline.filter((entry) => entry.block !== "episode_graph");
const legacyV3ExactProfileBody = {
  version: profile.version,
  programBriefFingerprint: profile.programBriefFingerprint,
  familyManifestFingerprint: profile.familyManifestFingerprint,
  contentLaneFingerprint: profile.contentLaneFingerprint,
  creativeCapabilityCatalogFingerprint: profile.creativeCapabilityCatalogFingerprint,
  selectedCapabilityKeys: profile.selectedCapabilityKeys,
  composition: legacyV3ExactComposition,
  designedPipelineFingerprint: profile.designedPipelineFingerprint,
};
const legacyV3ExactProfile = {
  ...legacyV3ExactProfileBody,
  fingerprint: sha256Hex(canonicalJson(legacyV3ExactProfileBody)),
};
const legacyV3NoEpisodeGraphProfileBody = {
  ...legacyV3ExactProfileBody,
  designedPipelineFingerprint: sha256Hex(canonicalJson(legacyV3Pipeline)),
};
const legacyV3NoEpisodeGraphProfile = {
  ...legacyV3NoEpisodeGraphProfileBody,
  fingerprint: sha256Hex(canonicalJson(legacyV3NoEpisodeGraphProfileBody)),
};
assert.deepEqual(
  assertChannelShowProfilePipelineCompatibility({
    profile: legacyV3NoEpisodeGraphProfile,
    programBrief: brief,
    pipeline: legacyV3Pipeline,
  }),
  legacyV3NoEpisodeGraphProfile,
  "the rich compatibility gate must preserve a v3 retry without the later Episode Graph",
);
assert.deepEqual(
  assertChannelShowProfileReceiptPipelineCompatibility({
    profile: legacyV3NoEpisodeGraphProfile,
    programBrief: brief,
    pipeline: legacyV3Pipeline,
  }),
  legacyV3NoEpisodeGraphProfile,
  "the pre-plan exact v3 receipt remains valid for historical retry compatibility",
);
assert.throws(
  () => assertChannelShowProfileReceiptExactComposition({
    profile: legacyV3ExactProfile,
    programBrief: brief,
    pipeline: design.pipeline,
  }),
  /does not match the admitted channel route|requires a capability plan binding/,
  "a new selected-capability admission cannot silently retain the retired exact-catalog authority",
);
assert.deepEqual(
  assertChannelShowProfile({
    profile: legacyV3ExactProfile,
    programBrief: brief,
    capabilitySelections,
    pipeline: design.pipeline,
  }),
  profile,
  "a historically sealed v3 exact receipt upgrades to the current plan only on a fresh admission",
);

const legacyDataStoryDefinitionIdentity = {
  key: "source_attributed_data_story",
  definitionVersion: "v1",
  family: "narrated_stock",
  title: "Source-attributed data story",
  qualityFocus: ["named sources", "spoken numeric anchors", "readable chart progression", "causal comparison"],
  requiredCapabilityKeys: ["source_attributed_data_story"],
} as const;
const legacyDataStoryCompositionBody = {
  version: CHANNEL_COMPOSITION_RECEIPT_VERSION,
  key: "source_attributed_data_story",
  definitionVersion: "v1",
  definitionFingerprint: sha256Hex(canonicalJson(legacyDataStoryDefinitionIdentity)),
  family: "narrated_stock",
  title: "Source-attributed data story",
  qualityFocus: ["named sources", "spoken numeric anchors", "readable chart progression", "causal comparison"],
} as const;
const legacyDataStoryComposition = {
  ...legacyDataStoryCompositionBody,
  fingerprint: sha256Hex(canonicalJson(legacyDataStoryCompositionBody)),
} as const;
const legacyV1DataStoryProfileBody = {
  version: profile.version,
  programBriefFingerprint: profile.programBriefFingerprint,
  familyManifestFingerprint: profile.familyManifestFingerprint,
  contentLaneFingerprint: profile.contentLaneFingerprint,
  creativeCapabilityCatalogFingerprint: profile.creativeCapabilityCatalogFingerprint,
  selectedCapabilityKeys: profile.selectedCapabilityKeys,
  composition: legacyDataStoryComposition,
  designedPipelineFingerprint: profile.designedPipelineFingerprint,
};
const legacyV1DataStoryProfile = {
  ...legacyV1DataStoryProfileBody,
  fingerprint: sha256Hex(canonicalJson(legacyV1DataStoryProfileBody)),
};

const legacyV2DataStoryDefinitionIdentity = {
  key: "source_attributed_data_story",
  definitionVersion: "v2",
  family: "narrated_stock",
  title: "Source-attributed data story",
  qualityFocus: ["named sources", "spoken numeric anchors", "readable chart progression", "causal comparison"],
  requiredCapabilityKeys: ["source_attributed_data_story"],
  materialization: {
    version: "source-attributed-data-story-materialization/v1",
    operations: [
      { kind: "ensure_block_before", block: "visual_inserts", beforeBlock: "timeline_assemble" },
      {
        kind: "merge_block_params",
        block: "visual_inserts",
        params: dataStoryInsertParams(SOURCE_ATTRIBUTED_DATA_STORY),
        numericOverrides: [
          { key: "maxInserts", minimum: 1, maximum: 8, integer: true },
          { key: "minGapSec", minimum: 0, maximum: 120 },
        ],
      },
      {
        kind: "merge_block_params",
        block: "script_gen",
        params: { dataRich: true, sourceAttributionRequired: true },
      },
      {
        kind: "merge_block_params",
        block: "qa_script",
        params: {
          dataStoryContract: SOURCE_ATTRIBUTED_DATA_STORY.version,
          requireNamedSource: true,
          requireSpokenNumericAnchor: true,
        },
      },
    ],
  },
} as const;
const legacyV2DataStoryCompositionBody = {
  version: CHANNEL_COMPOSITION_RECEIPT_VERSION,
  key: "source_attributed_data_story",
  definitionVersion: "v2",
  definitionFingerprint: sha256Hex(canonicalJson(legacyV2DataStoryDefinitionIdentity)),
  family: "narrated_stock",
  title: "Source-attributed data story",
  qualityFocus: ["named sources", "spoken numeric anchors", "readable chart progression", "causal comparison"],
} as const;
const legacyV2DataStoryComposition = {
  ...legacyV2DataStoryCompositionBody,
  fingerprint: sha256Hex(canonicalJson(legacyV2DataStoryCompositionBody)),
} as const;
const legacyV2DataStoryProfileBody = {
  version: profile.version,
  programBriefFingerprint: profile.programBriefFingerprint,
  familyManifestFingerprint: profile.familyManifestFingerprint,
  contentLaneFingerprint: profile.contentLaneFingerprint,
  creativeCapabilityCatalogFingerprint: profile.creativeCapabilityCatalogFingerprint,
  selectedCapabilityKeys: profile.selectedCapabilityKeys,
  composition: legacyV2DataStoryComposition,
  designedPipelineFingerprint: profile.designedPipelineFingerprint,
};
const legacyV2DataStoryProfile = {
  ...legacyV2DataStoryProfileBody,
  fingerprint: sha256Hex(canonicalJson(legacyV2DataStoryProfileBody)),
};
assert.deepEqual(
  assertChannelShowProfilePipelineCompatibility({
    profile: legacyV2DataStoryProfile,
    programBrief: brief,
    pipeline: design.pipeline,
  }),
  legacyV2DataStoryProfile,
  "a persisted v2 profile remains readable when it retains its full source-attributed producer order",
);
assert.throws(
  () => assertChannelShowProfilePipelineCompatibility({
    profile: legacyV2DataStoryProfile,
    programBrief: brief,
    pipeline: quoteAfterVisualPipeline,
  }),
  /optional quote_overlays before visual_inserts when present/,
  "the rich compatibility gate must reject a v2 profile with quote-overlay timing drift",
);
assert.throws(
  () => assertChannelShowProfileReceiptPipelineCompatibility({
    profile: legacyV2DataStoryProfile,
    programBrief: brief,
    pipeline: quoteAfterVisualPipeline,
  }),
  /optional quote_overlays before visual_inserts when present/,
  "the Convex-safe compatibility gate must reject the same v2 timing drift",
);
assert.throws(
  () => assertChannelShowProfileReceiptExactComposition({
    profile: legacyV2DataStoryProfile,
    programBrief: brief,
    pipeline: design.pipeline,
  }),
  /does not match the admitted channel route/,
  "a first Convex admission cannot reuse a historical v2 receipt instead of the current v3 route",
);
assert.deepEqual(
  assertChannelShowProfileProgramBinding({ profile: legacyV1DataStoryProfile, programBrief: brief }),
  legacyV1DataStoryProfile,
  "a historically sealed v1 composition must remain readable after v2 becomes current",
);
assert.deepEqual(
  assertChannelShowProfileReceiptProgramBinding({ profile: legacyV1DataStoryProfile, programBrief: brief }),
  legacyV1DataStoryProfile,
  "the Convex-safe receipt codec must keep the same historical receipt readable",
);
assert.deepEqual(
  assertChannelShowProfileReceiptPipelineCompatibility({
    profile: legacyV1DataStoryProfile,
    programBrief: brief,
    pipeline: design.pipeline,
  }),
  legacyV1DataStoryProfile,
  "a historical v1 source-data profile must resume against its unchanged compiler baseline",
);
assert.throws(
  () => assertChannelShowProfilePipelineCompatibility({
    profile: legacyV1DataStoryProfile,
    programBrief: brief,
    pipeline: reorderedCompositionPipeline,
  }),
  /historical v1 source-attributed data-story profile must retain its exact admitted pipeline baseline/,
  "the rich compatibility gate must make a v1 retry exact-baseline-only",
);
assert.throws(
  () => assertChannelShowProfileReceiptPipelineCompatibility({
    profile: legacyV1DataStoryProfile,
    programBrief: brief,
    pipeline: reorderedCompositionPipeline,
  }),
  /historical v1 source-attributed data-story profile must retain its exact admitted pipeline baseline/,
  "the Convex-safe compatibility gate must make the same v1 retry exact-baseline-only",
);
assert.throws(
  () => assertChannelShowProfileReceiptExactComposition({
    profile: legacyV1DataStoryProfile,
    programBrief: brief,
    pipeline: design.pipeline,
  }),
  /does not match the admitted channel route/,
  "a first Convex admission cannot reuse a historical v1 receipt instead of the current v3 route",
);
assert.deepEqual(
  assertChannelShowProfile({
    profile: legacyV1DataStoryProfile,
    programBrief: brief,
    capabilitySelections,
    pipeline: design.pipeline,
  }),
  profile,
  "an exact new admission may upgrade only the receipt version while retaining the sealed baseline graph",
);

const legacyProfileBody = {
  version: profile.version,
  programBriefFingerprint: profile.programBriefFingerprint,
  familyManifestFingerprint: profile.familyManifestFingerprint,
  contentLaneFingerprint: profile.contentLaneFingerprint,
  creativeCapabilityCatalogFingerprint: profile.creativeCapabilityCatalogFingerprint,
  selectedCapabilityKeys: profile.selectedCapabilityKeys,
  designedPipelineFingerprint: profile.designedPipelineFingerprint,
};
const legacyProfile = {
  ...legacyProfileBody,
  fingerprint: sha256Hex(canonicalJson(legacyProfileBody)),
};
assert.equal(
  parseChannelShowProfile(legacyProfile).composition,
  undefined,
  "historical receipts remain readable but are never represented as composition-attested",
);
const upgradedLegacyProfile = assertChannelShowProfile({
  profile: legacyProfile,
  programBrief: brief,
  capabilitySelections,
  pipeline: design.pipeline,
});
assert.deepEqual(
  upgradedLegacyProfile,
  profile,
  "an exact current admission derives a fresh composition-attested snapshot instead of treating legacy proof as attested",
);

const genericCinematicBrief = createChannelProgramBrief({
  family: "cinematic",
  nicheKey: "business",
  locale: "en",
  concept: "A source-first reconstruction awaiting its separate private-review admission.",
});
const genericCinematicProfile = createChannelShowProfile({
  programBrief: genericCinematicBrief,
  pipeline: [],
});
assert.equal(
  genericCinematicProfile.composition?.key,
  "cinematic_visual_control_story",
  "a route-complete cinematic profile carries its real composition receipt even before runtime qualification",
);
assert.equal(
  certifiedFamilyAdmission("cinematic").automatic,
  false,
  "a composition receipt describes the channel plan; it never substitutes for independently measured runtime admission",
);

console.log("channel show profile contract tests passed");
