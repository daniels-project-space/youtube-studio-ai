import assert from "node:assert/strict";

import {
  CAPABILITY_COMPOSITION_FRAGMENT_HISTORY,
  CERTIFIED_CHANNEL_COMPOSITIONS,
  CHANNEL_COMPOSITION_DEFINITION_HISTORY,
  SOURCE_ATTRIBUTED_DATA_STORY_V3_MATERIALIZATION,
  SOURCE_ATTRIBUTED_DATA_STORY_V4_MATERIALIZATION,
  assertCapabilityCompositionFragmentCatalog,
  assertCapabilityCompositionFragmentSelectionCompatibility,
  assertCurrentChannelCapabilityCompositionPlanBinding,
  assertChannelCompositionReceiptBinding,
  assertCertifiedChannelCompositionCatalog,
  assertCertifiedChannelCompositionPipelineCompatibility,
  capabilityCompositionPlanMaterialization,
  type CapabilityCompositionFragmentDefinition,
  type ChannelCompositionDefinition,
  certifiedChannelCompositionMaterialization,
  certifiedChannelCompositionDefinition,
  findCertifiedChannelComposition,
  parseChannelCapabilityCompositionPlan,
  parseChannelCompositionReceipt,
  resolveChannelCapabilityCompositionPlan,
  resolveCertifiedChannelComposition,
} from "@/engine/channelCompositionCatalog";
import { SOURCE_ATTRIBUTED_DATA_STORY, dataStoryInsertParams } from "@/engine/dataStory";
import { familyChannelInceptionCapability } from "@/engine/channelInceptionCapability";
import { FAMILY_KEYS } from "@/engine/families";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

const autonomousFamilies = FAMILY_KEYS
  .filter((family) => familyChannelInceptionCapability(family).mode === "registered_non_gemini")
  .sort();
const composedFamilies = [...new Set(CERTIFIED_CHANNEL_COMPOSITIONS.map((composition) => composition.family))]
  .sort();

assert.deepEqual(
  composedFamilies,
  autonomousFamilies,
  "the durable composition catalog must cover every and only currently autonomous channel-creation family",
);

for (const family of autonomousFamilies) {
  const receipt = resolveCertifiedChannelComposition({ family });
  const definition = certifiedChannelCompositionDefinition(receipt);
  assert.equal(receipt.family, family);
  assert.equal(definition.key, receipt.key);
  assert.deepEqual(
    assertChannelCompositionReceiptBinding({
      receipt,
      family,
      selectedCapabilityKeys: [],
    }),
    receipt,
    `${family} must have a deterministic default composition receipt`,
  );
}

const dataStory = resolveCertifiedChannelComposition({
  family: "narrated_stock",
  selectedCapabilityKeys: ["source_attributed_data_story"],
});
assert.equal(dataStory.key, "source_attributed_data_story");
assert.equal(dataStory.definitionVersion, "v4");
const historicalV3Definition = CHANNEL_COMPOSITION_DEFINITION_HISTORY.find((definition) => (
  definition.key === "source_attributed_data_story" && definition.definitionVersion === "v3"
));
const currentV4Definition = CHANNEL_COMPOSITION_DEFINITION_HISTORY.find((definition) => (
  definition.key === "source_attributed_data_story" && definition.definitionVersion === "v4"
));
assert.equal(historicalV3Definition?.status, "historical");
assert.equal(currentV4Definition?.status, "current");
assert.deepEqual(
  historicalV3Definition?.materialization,
  SOURCE_ATTRIBUTED_DATA_STORY_V3_MATERIALIZATION,
  "v3 must retain its sealed pre-checkpoint materialization byte-for-byte",
);
assert.equal(
  SOURCE_ATTRIBUTED_DATA_STORY_V3_MATERIALIZATION.operations
    .map((operation) => String(operation.block))
    .includes("episode_graph"),
  false,
  "historical v3 must not be silently upgraded with a newly introduced checkpoint artifact",
);
assert.deepEqual(
  SOURCE_ATTRIBUTED_DATA_STORY_V4_MATERIALIZATION.operations[0],
  {
    kind: "ensure_block_between",
    block: "episode_graph",
    afterBlocks: ["story_spine"],
    beforeBlock: "stock_footage",
  },
  "the new materialization must freeze Episode Graph after Story Spine and before the first visual stage",
);
const historicalV1Fragment = CAPABILITY_COMPOSITION_FRAGMENT_HISTORY.find((fragment) => (
  fragment.capability === "source_attributed_data_story" && fragment.definitionVersion === "v1"
));
const currentV2Fragment = CAPABILITY_COMPOSITION_FRAGMENT_HISTORY.find((fragment) => (
  fragment.capability === "source_attributed_data_story" && fragment.definitionVersion === "v2"
));
assert.equal(historicalV1Fragment?.status, "historical");
assert.equal(currentV2Fragment?.status, "current");
const dataStoryCapabilityPlan = resolveChannelCapabilityCompositionPlan({
  family: "narrated_stock",
  selectedCapabilityKeys: ["source_attributed_data_story"],
  expectedFragmentVersions: { source_attributed_data_story: "v2" },
});
assert.equal(dataStoryCapabilityPlan.fragments[0]?.definitionVersion, "v2");
assert.deepEqual(
  capabilityCompositionPlanMaterialization(dataStoryCapabilityPlan).operations[0],
  SOURCE_ATTRIBUTED_DATA_STORY_V4_MATERIALIZATION.operations[0],
  "new capability plans must seal the provider-free Episode Graph placement rather than reuse v3",
);
assert.throws(
  () => resolveChannelCapabilityCompositionPlan({
    family: "narrated_stock",
    selectedCapabilityKeys: ["source_attributed_data_story"],
    expectedFragmentVersions: { source_attributed_data_story: "v999" },
  }),
  /resolves v2 but the declared fragment version is v999/,
  "current composition resolution must reject a creator catalog fragment-version drift",
);
assert.throws(
  () => assertCurrentChannelCapabilityCompositionPlanBinding({
    plan: dataStoryCapabilityPlan,
    family: "narrated_stock",
    selectedCapabilityKeys: ["source_attributed_data_story"],
    expectedFragmentVersions: { source_attributed_data_story: "v999" },
  }),
  /resolves v2 but the declared fragment version is v999/,
  "current admission must re-check the creator catalog fragment-version declaration",
);
assert.deepEqual(
  parseChannelCompositionReceipt(dataStory),
  dataStory,
  "a current receipt must round-trip through its sealed definition identity",
);
assert.equal(
  resolveCertifiedChannelComposition({ family: "narrated_stock" }).key,
  "narrated_visual_essay",
  "the source-attributed route must be qualified by its existing explicit capability, not inferred from prose",
);
assert.deepEqual(
  findCertifiedChannelComposition({
    family: "narrated_stock",
    selectedCapabilityKeys: ["source_attributed_data_story", "source_attributed_data_story"],
  }),
  dataStory,
  "low-level receipt lookup must normalize a capability set before resolving its exact route",
);
assert.equal(
  findCertifiedChannelComposition({
    family: "narrated_stock",
    selectedCapabilityKeys: ["source_attributed_data_story", "uncomposed_future_capability"],
  }),
  undefined,
  "an incompatible capability combination must not silently select its source-attributed subset route",
);
assert.throws(
  () => resolveCertifiedChannelComposition({
    family: "narrated_stock",
    selectedCapabilityKeys: ["source_attributed_data_story", "uncomposed_future_capability"],
  }),
  /no certified autonomous channel composition is registered for narrated_stock/,
  "a requested incompatible capability combination must fail before a profile can seal a subset receipt",
);
const conflictingCurrentDataStoryRoute = {
  key: "conflicting_source_attributed_data_story",
  definitionVersion: "v1",
  status: "current",
  family: "narrated_stock",
  title: "Conflicting source-attributed data story",
  qualityFocus: ["named sources"],
  requiredCapabilityKeys: ["source_attributed_data_story"],
} as const satisfies ChannelCompositionDefinition;
assert.throws(
  () => assertCertifiedChannelCompositionCatalog([
    ...CHANNEL_COMPOSITION_DEFINITION_HISTORY,
    conflictingCurrentDataStoryRoute,
  ]),
  /ambiguous current certified composition route for narrated_stock capability set \["source_attributed_data_story"\]/,
  "the catalog must reject two current routes that claim the same normalized capability set",
);

const dependencyAwareFragments = [
  {
    capability: "casefile_cinematic",
    definitionVersion: "test-v1",
    status: "current",
    family: "narrated_stock",
    materialization: {
      version: "test/casefile/v1",
      operations: [
        { kind: "ensure_block_before", block: "casefile_layer", beforeBlock: "timeline_assemble" },
      ],
    },
  },
  {
    capability: "editorial_evidence_packet",
    definitionVersion: "test-v1",
    status: "current",
    family: "narrated_stock",
    materialization: {
      version: "test/editorial/v1",
      operations: [
        { kind: "ensure_block_before", block: "editorial_layer", beforeBlock: "timeline_assemble" },
      ],
    },
  },
  {
    capability: "source_attributed_data_story",
    definitionVersion: "test-v1",
    status: "current",
    family: "narrated_stock",
    requiredCapabilityKeys: ["editorial_evidence_packet"],
    incompatibleCapabilityKeys: ["casefile_cinematic"],
    materialization: {
      version: "test/source/v1",
      operations: [
        { kind: "ensure_block_before", block: "source_layer", beforeBlock: "timeline_assemble" },
      ],
    },
  },
] as const satisfies readonly CapabilityCompositionFragmentDefinition[];

assert.doesNotThrow(
  () => assertCapabilityCompositionFragmentCatalog(dependencyAwareFragments),
  "fragment-owned constraints may model a safe multi-capability composition without a cross-product route row",
);
assert.throws(
  () => assertCapabilityCompositionFragmentSelectionCompatibility({
    selectedCapabilityKeys: ["source_attributed_data_story"],
    fragments: [dependencyAwareFragments[2]],
  }),
  /source_attributed_data_story requires selected capability editorial_evidence_packet/,
  "a fragment dependency must remain an explicit creator selection rather than being silently auto-added",
);
assert.doesNotThrow(
  () => assertCapabilityCompositionFragmentSelectionCompatibility({
    selectedCapabilityKeys: ["editorial_evidence_packet", "source_attributed_data_story"],
    fragments: [dependencyAwareFragments[1], dependencyAwareFragments[2]],
  }),
  "a complete dependency set is deterministic and compatible",
);
assert.throws(
  () => assertCapabilityCompositionFragmentSelectionCompatibility({
    selectedCapabilityKeys: [
      "casefile_cinematic",
      "editorial_evidence_packet",
      "source_attributed_data_story",
    ],
    fragments: dependencyAwareFragments,
  }),
  /source_attributed_data_story is incompatible with selected capability casefile_cinematic/,
  "a fragment-owned incompatibility must reject the full selected set before plan sealing",
);
assert.throws(
  () => assertCapabilityCompositionFragmentCatalog([
    dependencyAwareFragments[0],
    {
      ...dependencyAwareFragments[1],
      requiredCapabilityKeys: ["source_attributed_data_story"],
    },
    dependencyAwareFragments[2],
  ]),
  /cyclic current capability composition dependency for narrated_stock: editorial_evidence_packet -> source_attributed_data_story -> editorial_evidence_packet/,
  "current fragment dependency cycles must fail during catalog admission rather than relying on operation ordering",
);
assert.throws(
  () => assertCapabilityCompositionFragmentCatalog([
    dependencyAwareFragments[0],
    dependencyAwareFragments[1],
    {
      ...dependencyAwareFragments[2],
      requiredCapabilityKeys: ["children_show_bible"],
    },
  ]),
  /requires an unavailable current narrated_stock\/children_show_bible fragment/,
  "a current dependency cannot point at an unregistered cross-family or review-only fragment",
);

// A sealed plan is not trusted merely because its public fingerprints are
// internally consistent: the fragment-owned dependency remains part of the
// historical definition contract during retry/rehydration as well.
const mutableFragmentHistory = CAPABILITY_COMPOSITION_FRAGMENT_HISTORY as unknown as Array<Record<string, unknown>>;
const mutableSourceFragment = mutableFragmentHistory.find(
  (definition) => definition.capability === "source_attributed_data_story" && definition.definitionVersion === "v2",
);
assert.ok(mutableSourceFragment);
const originalSourceRequiredCapabilities = mutableSourceFragment.requiredCapabilityKeys;
const testEditorialFragment = {
  capability: "editorial_evidence_packet",
  definitionVersion: "persisted-plan-test-v1",
  status: "current",
  family: "narrated_stock",
  materialization: {
    version: "persisted-plan-test/editorial/v1",
    operations: [
      { kind: "ensure_block_before", block: "editorial_layer", beforeBlock: "timeline_assemble" },
    ],
  },
} as const;
try {
  mutableSourceFragment.requiredCapabilityKeys = ["editorial_evidence_packet"];
  mutableFragmentHistory.push(testEditorialFragment as unknown as Record<string, unknown>);
  const completePlan = resolveChannelCapabilityCompositionPlan({
    family: "narrated_stock",
    selectedCapabilityKeys: ["editorial_evidence_packet", "source_attributed_data_story"],
    expectedFragmentVersions: {
      editorial_evidence_packet: "persisted-plan-test-v1",
      source_attributed_data_story: "v2",
    },
  });
  const incompleteOperations = capabilityCompositionPlanMaterialization(completePlan).operations.filter(
    (operation) => !(operation.kind === "ensure_block_before" && operation.block === "editorial_layer"),
  );
  const malformedPlanBody = {
    version: completePlan.version,
    family: completePlan.family,
    base: completePlan.base,
    fragments: completePlan.fragments.filter(
      (fragment) => fragment.capability === "source_attributed_data_story",
    ),
    selectedCapabilityKeys: ["source_attributed_data_story"],
    operationsFingerprint: sha256Hex(canonicalJson(incompleteOperations)),
  } as const;
  const malformedPlan = {
    ...malformedPlanBody,
    fingerprint: sha256Hex(canonicalJson(malformedPlanBody)),
  } as const;
  assert.throws(
    () => parseChannelCapabilityCompositionPlan(malformedPlan),
    /source_attributed_data_story requires selected capability editorial_evidence_packet/,
    "a re-fingerprinted persisted plan cannot omit a fragment dependency after current admission",
  );
  const emptyPlanBody = {
    version: completePlan.version,
    family: completePlan.family,
    base: completePlan.base,
    fragments: [],
    selectedCapabilityKeys: [],
    operationsFingerprint: sha256Hex(canonicalJson([])),
  } as const;
  assert.throws(
    () => parseChannelCapabilityCompositionPlan({
      ...emptyPlanBody,
      fingerprint: sha256Hex(canonicalJson(emptyPlanBody)),
    }),
    /must select at least one capability/,
    "the plan-only authority cannot be used to relabel an empty legacy base receipt",
  );
} finally {
  const testFragmentIndex = mutableFragmentHistory.indexOf(testEditorialFragment as unknown as Record<string, unknown>);
  if (testFragmentIndex >= 0) mutableFragmentHistory.splice(testFragmentIndex, 1);
  mutableSourceFragment.requiredCapabilityKeys = originalSourceRequiredCapabilities;
}

const legacyDataStoryDefinitionIdentity = {
  key: "source_attributed_data_story",
  definitionVersion: "v1",
  family: "narrated_stock",
  title: "Source-attributed data story",
  qualityFocus: ["named sources", "spoken numeric anchors", "readable chart progression", "causal comparison"],
  requiredCapabilityKeys: ["source_attributed_data_story"],
} as const;
const legacyDataStoryBody = {
  version: dataStory.version,
  key: "source_attributed_data_story",
  definitionVersion: "v1",
  definitionFingerprint: sha256Hex(canonicalJson(legacyDataStoryDefinitionIdentity)),
  family: "narrated_stock",
  title: "Source-attributed data story",
  qualityFocus: ["named sources", "spoken numeric anchors", "readable chart progression", "causal comparison"],
} as const;
const legacyDataStory = {
  ...legacyDataStoryBody,
  fingerprint: sha256Hex(canonicalJson(legacyDataStoryBody)),
} as const;
assert.deepEqual(
  parseChannelCompositionReceipt(legacyDataStory),
  legacyDataStory,
  "the pre-materialization historical receipt must remain readable after newer declarative definitions become current",
);
assert.equal(
  certifiedChannelCompositionMaterialization(legacyDataStory),
  undefined,
  "a historical receipt must never silently execute newer declarative operations",
);

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
const legacyV2DataStoryBody = {
  version: dataStory.version,
  key: "source_attributed_data_story",
  definitionVersion: "v2",
  definitionFingerprint: sha256Hex(canonicalJson(legacyV2DataStoryDefinitionIdentity)),
  family: "narrated_stock",
  title: "Source-attributed data story",
  qualityFocus: ["named sources", "spoken numeric anchors", "readable chart progression", "causal comparison"],
} as const;
const legacyV2DataStory = {
  ...legacyV2DataStoryBody,
  fingerprint: sha256Hex(canonicalJson(legacyV2DataStoryBody)),
} as const;
const legacyV2Pipeline = [
  { block: "script_gen", params: { dataRich: true, sourceAttributionRequired: true } },
  {
    block: "qa_script",
    params: {
      dataStoryContract: SOURCE_ATTRIBUTED_DATA_STORY.version,
      requireNamedSource: true,
      requireSpokenNumericAnchor: true,
    },
  },
  { block: "narration_tts" },
  { block: "intro_card" },
  { block: "quote_overlays" },
  { block: "visual_inserts", params: dataStoryInsertParams(SOURCE_ATTRIBUTED_DATA_STORY) },
  { block: "timeline_assemble" },
] as const;
assert.deepEqual(
  assertCertifiedChannelCompositionPipelineCompatibility({
    receipt: legacyV2DataStory,
    pipeline: legacyV2Pipeline,
  }),
  legacyV2DataStory,
  "a persisted v2 profile keeps its intended producer ordering while remaining readable",
);
const legacyV2QuoteAfterVisual = legacyV2Pipeline.map((entry) => ({ ...entry }));
const legacyV2QuoteIndex = legacyV2QuoteAfterVisual.findIndex((entry) => entry.block === "quote_overlays");
const [legacyV2Quote] = legacyV2QuoteAfterVisual.splice(legacyV2QuoteIndex, 1);
const legacyV2VisualIndex = legacyV2QuoteAfterVisual.findIndex((entry) => entry.block === "visual_inserts");
legacyV2QuoteAfterVisual.splice(legacyV2VisualIndex + 1, 0, legacyV2Quote!);
assert.throws(
  () => assertCertifiedChannelCompositionPipelineCompatibility({
    receipt: legacyV2DataStory,
    pipeline: legacyV2QuoteAfterVisual,
  }),
  /optional quote_overlays before visual_inserts when present/,
  "a persisted v2 profile must reject quote-overlay timing drift rather than resume an invalid assembly",
);

const historicalV3DataStoryDefinitionIdentity = {
  key: "source_attributed_data_story",
  definitionVersion: "v3",
  family: "narrated_stock",
  title: "Source-attributed data story",
  qualityFocus: ["named sources", "spoken numeric anchors", "readable chart progression", "causal comparison"],
  requiredCapabilityKeys: ["source_attributed_data_story"],
  materialization: SOURCE_ATTRIBUTED_DATA_STORY_V3_MATERIALIZATION,
} as const;
const historicalV3DataStoryBody = {
  version: dataStory.version,
  key: "source_attributed_data_story",
  definitionVersion: "v3",
  definitionFingerprint: sha256Hex(canonicalJson(historicalV3DataStoryDefinitionIdentity)),
  family: "narrated_stock",
  title: "Source-attributed data story",
  qualityFocus: ["named sources", "spoken numeric anchors", "readable chart progression", "causal comparison"],
} as const;
const historicalV3DataStory = {
  ...historicalV3DataStoryBody,
  fingerprint: sha256Hex(canonicalJson(historicalV3DataStoryBody)),
} as const;
assert.deepEqual(
  parseChannelCompositionReceipt(historicalV3DataStory),
  historicalV3DataStory,
  "the former v3 current receipt must stay parseable as an exact historical materialization",
);
assert.deepEqual(
  certifiedChannelCompositionMaterialization(historicalV3DataStory),
  SOURCE_ATTRIBUTED_DATA_STORY_V3_MATERIALIZATION,
  "a historical v3 retry must retain its original operation set instead of acquiring Episode Graph",
);

const currentDataStoryDefinition = CHANNEL_COMPOSITION_DEFINITION_HISTORY.find((definition) => (
  definition.key === "source_attributed_data_story" && definition.definitionVersion === "v4"
));
assert.ok(currentDataStoryDefinition?.materialization);
const currentOrderingOperation = currentDataStoryDefinition.materialization.operations.find((operation) => (
  operation.kind === "ensure_block_between" && operation.block === "visual_inserts"
)) as {
  optionalAfterBlocks?: readonly string[];
};
assert.ok(currentOrderingOperation);
const originalOptionalAfterBlocks = currentOrderingOperation.optionalAfterBlocks;
try {
  currentOrderingOperation.optionalAfterBlocks = [];
  assert.notEqual(
    resolveCertifiedChannelComposition({
      family: "narrated_stock",
      selectedCapabilityKeys: ["source_attributed_data_story"],
    }).definitionFingerprint,
    dataStory.definitionFingerprint,
    "a composition receipt fingerprint must change when its optional producer ordering changes",
  );
} finally {
  currentOrderingOperation.optionalAfterBlocks = originalOptionalAfterBlocks;
}
const originalCurrentOperations = currentDataStoryDefinition.materialization.operations;
try {
  (currentDataStoryDefinition.materialization as { operations: readonly unknown[] }).operations = [
    { kind: "unrecognized_runtime_operation" },
  ];
  assert.throws(
    () => resolveCertifiedChannelComposition({
      family: "narrated_stock",
      selectedCapabilityKeys: ["source_attributed_data_story"],
    }),
    /unsupported certified composition operation kind unrecognized_runtime_operation/,
    "unknown runtime operation kinds must fail closed before an unsealed merge can occur",
  );
} finally {
  (currentDataStoryDefinition.materialization as { operations: readonly unknown[] }).operations = originalCurrentOperations;
}
assert.equal(
  resolveCertifiedChannelComposition({ family: "cinematic" }).key,
  "cinematic_visual_control_story",
  "the cinematic composition is explicit and receipt-bound; its independently measured runtime gate remains outside this catalog",
);
assert.equal(
  findCertifiedChannelComposition({ family: "cinematic" })?.key,
  "cinematic_visual_control_story",
  "a cinematic Show Profile has one exact route-owned visual-control composition rather than a generic renderer label",
);

const { fingerprint: _dataStoryFingerprint, ...dataStoryBody } = dataStory;
void _dataStoryFingerprint;
const futureCatalogV2 = [
  ...CHANNEL_COMPOSITION_DEFINITION_HISTORY,
  {
    key: "future_certified_timeline",
    definitionVersion: "v1",
    status: "current" as const,
    family: "documentary_collage_short" as const,
    title: "Future certified timeline",
    qualityFocus: ["timeline clarity"],
    requiredCapabilityKeys: [],
  },
];
assert.notEqual(
  canonicalJson(CHANNEL_COMPOSITION_DEFINITION_HISTORY),
  canonicalJson(futureCatalogV2),
  "the regression must model an additive v2 catalog rather than a no-op reparse",
);
assert.doesNotThrow(
  () => assertCertifiedChannelCompositionCatalog(futureCatalogV2),
  "an unrelated exact route may be added without creating an ambiguous current capability set",
);
assert.equal(
  "catalogFingerprint" in dataStory,
  false,
  "a receipt must not pin a whole-catalog hash that would invalidate it after an unrelated addition",
);
assert.deepEqual(
  parseChannelCompositionReceipt(dataStory),
  dataStory,
  "a current definition receipt must remain valid after an unrelated future catalog addition",
);

const staleDefinitionBody = {
  ...dataStoryBody,
  definitionFingerprint: "0".repeat(64),
};
assert.throws(
  () => parseChannelCompositionReceipt({
    ...staleDefinitionBody,
    fingerprint: sha256Hex(canonicalJson(staleDefinitionBody)),
  }),
  /definition fingerprint/,
  "a receipt must bind the exact historical definition rather than a mutable catalog aggregate",
);
const titleTamperedBody = {
  ...dataStoryBody,
  title: "Counterfeit data-story title",
};
assert.throws(
  () => parseChannelCompositionReceipt({
    ...titleTamperedBody,
    fingerprint: sha256Hex(canonicalJson(titleTamperedBody)),
  }),
  /sealed historical definition/,
  "a re-fingerprinted receipt cannot change the title shown to the creator",
);
const focusTamperedBody = {
  ...dataStoryBody,
  qualityFocus: ["counterfeit quality promise"],
};
assert.throws(
  () => parseChannelCompositionReceipt({
    ...focusTamperedBody,
    fingerprint: sha256Hex(canonicalJson(focusTamperedBody)),
  }),
  /sealed historical definition/,
  "a re-fingerprinted receipt cannot change the quality focus shown to the creator",
);
assert.throws(
  () => assertChannelCompositionReceiptBinding({
    receipt: resolveCertifiedChannelComposition({ family: "narrated_stock" }),
    family: "narrated_stock",
    selectedCapabilityKeys: ["source_attributed_data_story"],
  }),
  /does not match the admitted channel route/,
  "a generic narrated receipt cannot replace a selected source-attributed data-story route",
);

console.log("certified channel composition catalog tests passed");
