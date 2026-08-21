import assert from "node:assert/strict";

import {
  CERTIFIED_CHANNEL_COMPOSITIONS,
  CHANNEL_COMPOSITION_DEFINITION_HISTORY,
  assertChannelCompositionReceiptBinding,
  assertCertifiedChannelCompositionCatalog,
  assertCertifiedChannelCompositionPipelineCompatibility,
  type ChannelCompositionDefinition,
  certifiedChannelCompositionMaterialization,
  certifiedChannelCompositionDefinition,
  findCertifiedChannelComposition,
  parseChannelCompositionReceipt,
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
assert.equal(dataStory.definitionVersion, "v3");
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

const currentDataStoryDefinition = CHANNEL_COMPOSITION_DEFINITION_HISTORY.find((definition) => (
  definition.key === "source_attributed_data_story" && definition.definitionVersion === "v3"
));
assert.ok(currentDataStoryDefinition?.materialization);
const currentOrderingOperation = currentDataStoryDefinition.materialization.operations[0]! as {
  optionalAfterBlocks?: readonly string[];
};
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
assert.throws(
  () => resolveCertifiedChannelComposition({ family: "cinematic" }),
  /no certified autonomous channel composition/,
  "a renderer-present but unregistered family must not gain creator authority from a composition label",
);
assert.equal(
  findCertifiedChannelComposition({ family: "cinematic" }),
  undefined,
  "a supervised or unregistered family can retain its generic Show Profile without being mislabeled as certified autonomous",
);

const { fingerprint: _dataStoryFingerprint, ...dataStoryBody } = dataStory;
void _dataStoryFingerprint;
const futureCatalogV2 = [
  ...CHANNEL_COMPOSITION_DEFINITION_HISTORY,
  {
    key: "future_certified_timeline",
    definitionVersion: "v1",
    status: "current" as const,
    family: "cinematic" as const,
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
