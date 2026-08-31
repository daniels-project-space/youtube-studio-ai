import assert from "node:assert/strict";

import {
  CHANNEL_COMPOSITION_COMPILER_VERSION,
  compileCertifiedChannelComposition,
} from "@/engine/channelCompositionCompiler";
import {
  CAPABILITY_COMPOSITION_FRAGMENT_HISTORY,
  assertCapabilityCompositionOperationCompatibility,
  capabilityCompositionPlanMaterialization,
  certifiedChannelCompositionMaterialization,
  resolveCertifiedChannelComposition,
} from "@/engine/channelCompositionCatalog";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import {
  CREATIVE_CAPABILITY_CATALOG,
  CREATIVE_CAPABILITY_CATALOG_FINGERPRINT,
  creativeCapabilitySelection,
} from "@/engine/creative/creativeCapabilityCatalog";
import { designPipeline } from "@/engine/designer";
import { createChannelShowProfile } from "@/engine/channelShowProfile";
import { MODULE_CONTRACTS } from "@/engine/moduleContracts";
import type { PipelineEntry } from "@/engine/types";
import { canonicalJson } from "@/lib/canonicalJson";

const brief = createChannelProgramBrief({
  family: "narrated_stock",
  nicheKey: "business",
  locale: "en",
  concept: "Source-attributed data storytelling with animated charts and ranked comparisons.",
});
const sourceDataStorySelection = [creativeCapabilitySelection("source_attributed_data_story")];

const narratedFixture: readonly PipelineEntry[] = [
  { block: "script_gen", params: { maxSeconds: 600, style: "business_explainer" } },
  { block: "qa_script" },
  { block: "narration_tts" },
  { block: "story_spine" },
  { block: "stock_footage" },
  { block: "entity_imagery" },
  { block: "music" },
  { block: "intro_card" },
  { block: "quote_overlays" },
  { block: "timeline_assemble" },
];

const input = {
  family: brief.family,
  intent: {
    concept: brief.concept,
    nicheKey: brief.nicheKey,
  },
  capabilitySelections: sourceDataStorySelection,
  parameterOverrides: {
    visual_inserts: {
      maxInserts: 5,
      minGapSec: 25,
      // It is intentionally not declared by the composition operation.
      renderer: "not-an-override-path",
    },
  },
  pipeline: narratedFixture,
} as const;

const compiled = compileCertifiedChannelComposition(input);
const replay = compileCertifiedChannelComposition(input);

assert.equal(compiled.version, CHANNEL_COMPOSITION_COMPILER_VERSION);
assert.equal(compiled.compositionBinding.kind, "capability_plan_v1");
assert.equal(compiled.compositionBinding.plan.base.key, "narrated_visual_essay");
assert.equal(compiled.compositionBinding.plan.fragments.length, 1);
assert.equal(compiled.compositionBinding.plan.fragments[0]?.capability, "source_attributed_data_story");
assert.equal(
  compiled.compositionBinding.plan.fragments[0]?.definitionVersion,
  "v2",
  "new admissions must seal the capability-owned fragment rather than rewrite historical exact receipts",
);
assert.equal(compiled.materialization?.version, "channel-composition-plan/v1/materialization");
assert.equal(compiled.operations.length, 5);
assert.deepEqual(compiled, replay, "certified composition compilation must be deterministic");
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
    () => compileCertifiedChannelComposition(input),
    /resolves v2 but the declared fragment version is v999/,
    "the compiler must bind the creator catalog's declared fragment version before materializing a plan",
  );
} finally {
  mutableSourceDataStoryCapabilityDefinition.compositionFragmentVersion =
    originalSourceDataStoryFragmentVersion;
}
const currentSourceReceipt = resolveCertifiedChannelComposition({
  family: "narrated_stock",
  selectedCapabilityKeys: ["source_attributed_data_story"],
});
assert.equal(
  canonicalJson(capabilityCompositionPlanMaterialization(compiled.compositionBinding.plan).operations),
  canonicalJson(certifiedChannelCompositionMaterialization(currentSourceReceipt)?.operations),
  "new capability plans must be byte-equivalent to the current v4 exact source-data materialization",
);

// Capability selections and their sealed operation receipt retain lexical
// identity for historical replay. The compiler must nevertheless schedule a
// dependent fragment after its selected prerequisite when that prerequisite
// supplies a block the dependent consumes.
const mutableFragmentHistory = CAPABILITY_COMPOSITION_FRAGMENT_HISTORY as unknown as Array<Record<string, unknown>>;
const mutableCreativeCatalog = CREATIVE_CAPABILITY_CATALOG as unknown as Array<Record<string, unknown>>;
const mutableEditorialCapability = mutableCreativeCatalog.find(
  (definition) => definition.capability === "editorial_evidence_packet",
);
assert.ok(mutableEditorialCapability);
const originalEditorialCapability = {
  supportedFamilies: mutableEditorialCapability.supportedFamilies,
  selectionMode: mutableEditorialCapability.selectionMode,
  compositionFragmentVersion: mutableEditorialCapability.compositionFragmentVersion,
  matches: mutableEditorialCapability.matches,
  materialize: mutableEditorialCapability.materialize,
};
const dependencyOrderTestFragment = {
  capability: "editorial_evidence_packet",
  definitionVersion: "dependency-order-test-v1",
  status: "current",
  family: "narrated_stock",
  requiredCapabilityKeys: ["source_attributed_data_story"],
  materialization: {
    version: "dependency-order-test/editorial/v1",
    operations: [
      {
        kind: "ensure_block_between",
        block: "editorial_layer",
        afterBlocks: ["visual_inserts"],
        beforeBlock: "timeline_assemble",
      },
    ],
  },
} as const;
try {
  const sourceOffer = sourceDataStoryCapabilityDefinition.materialize(
    { concept: brief.concept, nicheKey: brief.nicheKey },
    brief.family,
  );
  mutableEditorialCapability.supportedFamilies = ["narrated_stock"];
  mutableEditorialCapability.selectionMode = "explicit_opt_in";
  mutableEditorialCapability.compositionFragmentVersion = "dependency-order-test-v1";
  mutableEditorialCapability.matches = () => true;
  mutableEditorialCapability.materialize = () => ({
    ...sourceOffer,
    capability: "editorial_evidence_packet",
    selectionMode: "explicit_opt_in",
  });
  mutableFragmentHistory.push(dependencyOrderTestFragment as unknown as Record<string, unknown>);
  const dependencyOrderedCompilation = compileCertifiedChannelComposition({
    family: "narrated_stock",
    intent: { concept: brief.concept, nicheKey: brief.nicheKey },
    capabilitySelections: [
      { capability: "editorial_evidence_packet", catalogFingerprint: CREATIVE_CAPABILITY_CATALOG_FINGERPRINT },
      { capability: "source_attributed_data_story", catalogFingerprint: CREATIVE_CAPABILITY_CATALOG_FINGERPRINT },
    ],
    pipeline: [
      { block: "script_gen" },
      { block: "qa_script" },
      { block: "story_spine" },
      { block: "stock_footage" },
      { block: "intro_card" },
      { block: "timeline_assemble" },
    ],
  });
  assert.equal(dependencyOrderedCompilation.compositionBinding.kind, "capability_plan_v1");
  if (dependencyOrderedCompilation.compositionBinding.kind !== "capability_plan_v1") {
    throw new Error("dependency-order fixture did not resolve a capability composition plan");
  }
  const dependencyOrderedPlan = dependencyOrderedCompilation.compositionBinding.plan;
  assert.doesNotThrow(
    () => capabilityCompositionPlanMaterialization(dependencyOrderedPlan),
    "the lexically sealed historical operation fingerprint must remain parseable as a durable plan",
  );
  assert.deepEqual(
    dependencyOrderedPlan.fragments.map((fragment) => fragment.capability),
    ["editorial_evidence_packet", "source_attributed_data_story"],
    "the durable selected-capability receipt remains lexically canonical",
  );
  const visualInsertOperationIndex = dependencyOrderedCompilation.operations.findIndex(
    (operation) => operation.kind === "ensure_block_between" && operation.block === "visual_inserts",
  );
  const editorialOperationIndex = dependencyOrderedCompilation.operations.findIndex(
    (operation) => operation.kind === "ensure_block_between" && operation.block === "editorial_layer",
  );
  assert.ok(
    editorialOperationIndex >= 0 && editorialOperationIndex < visualInsertOperationIndex,
    "the fixture keeps its lexical sealed-operation order so execution scheduling—not receipt rewriting—is exercised",
  );
  assert.ok(
    dependencyOrderedCompilation.pipeline.findIndex((entry) => entry.block === "visual_inserts") <
      dependencyOrderedCompilation.pipeline.findIndex((entry) => entry.block === "editorial_layer"),
    "the compiled pipeline must receive the prerequisite block before its dependent layer",
  );

  // A block-level producer/consumer relationship may be safe without being a
  // creator-facing capability dependency. The scheduler must still wait for
  // the inserted producer block instead of failing because the consumer key
  // is lexically earlier in the sealed receipt.
  const mutableDependencyOrderTestFragment = dependencyOrderTestFragment as unknown as {
    requiredCapabilityKeys?: readonly string[];
  };
  delete mutableDependencyOrderTestFragment.requiredCapabilityKeys;
  const mutableOptionalDependencyOperation = dependencyOrderTestFragment.materialization.operations[0] as unknown as {
    afterBlocks: readonly string[];
    optionalAfterBlocks?: readonly string[];
  };
  mutableOptionalDependencyOperation.afterBlocks = ["intro_card"];
  mutableOptionalDependencyOperation.optionalAfterBlocks = ["visual_inserts"];
  const blockDependencyCompilation = compileCertifiedChannelComposition({
    family: "narrated_stock",
    intent: { concept: brief.concept, nicheKey: brief.nicheKey },
    capabilitySelections: [
      { capability: "editorial_evidence_packet", catalogFingerprint: CREATIVE_CAPABILITY_CATALOG_FINGERPRINT },
      { capability: "source_attributed_data_story", catalogFingerprint: CREATIVE_CAPABILITY_CATALOG_FINGERPRINT },
    ],
    pipeline: [
      { block: "script_gen" },
      { block: "qa_script" },
      { block: "story_spine" },
      { block: "stock_footage" },
      { block: "intro_card" },
      { block: "timeline_assemble" },
    ],
  });
  const lexicalEditorialOperationIndex = blockDependencyCompilation.operations.findIndex(
    (operation) => operation.kind === "ensure_block_between" && operation.block === "editorial_layer",
  );
  const lexicalVisualOperationIndex = blockDependencyCompilation.operations.findIndex(
    (operation) => operation.kind === "ensure_block_between" && operation.block === "visual_inserts",
  );
  assert.ok(
    lexicalEditorialOperationIndex >= 0 && lexicalEditorialOperationIndex < lexicalVisualOperationIndex,
    "the fixture retains lexical sealed-operation order so the scheduler path is exercised",
  );
  assert.ok(
    blockDependencyCompilation.pipeline.findIndex((entry) => entry.block === "visual_inserts") <
      blockDependencyCompilation.pipeline.findIndex((entry) => entry.block === "editorial_layer"),
    "the compiler must defer an optional-edge consumer until its separately sealed producer block exists",
  );
} finally {
  const testFragmentIndex = mutableFragmentHistory.indexOf(
    dependencyOrderTestFragment as unknown as Record<string, unknown>,
  );
  if (testFragmentIndex >= 0) mutableFragmentHistory.splice(testFragmentIndex, 1);
  mutableEditorialCapability.supportedFamilies = originalEditorialCapability.supportedFamilies;
  mutableEditorialCapability.selectionMode = originalEditorialCapability.selectionMode;
  mutableEditorialCapability.matches = originalEditorialCapability.matches;
  mutableEditorialCapability.materialize = originalEditorialCapability.materialize;
  if (originalEditorialCapability.compositionFragmentVersion === undefined) {
    delete mutableEditorialCapability.compositionFragmentVersion;
  } else {
    mutableEditorialCapability.compositionFragmentVersion = originalEditorialCapability.compositionFragmentVersion;
  }
}
assert.deepEqual(
  narratedFixture,
  [
    { block: "script_gen", params: { maxSeconds: 600, style: "business_explainer" } },
    { block: "qa_script" },
    { block: "narration_tts" },
    { block: "story_spine" },
    { block: "stock_footage" },
    { block: "entity_imagery" },
    { block: "music" },
    { block: "intro_card" },
    { block: "quote_overlays" },
    { block: "timeline_assemble" },
  ],
  "the pure materializer must not mutate the caller's baseline pipeline",
);

const visualInserts = compiled.pipeline.find((entry) => entry.block === "visual_inserts");
const script = compiled.pipeline.find((entry) => entry.block === "script_gen");
const scriptQa = compiled.pipeline.find((entry) => entry.block === "qa_script");
const episodeGraph = compiled.pipeline.find((entry) => entry.block === "episode_graph");
assert.ok(visualInserts);
assert.ok(script);
assert.ok(scriptQa);
assert.ok(episodeGraph);
assert.deepEqual(
  MODULE_CONTRACTS.episode_graph?.providerProfiles?.map((profile) => profile.provider),
  ["local"],
  "the Phase I checkpoint artifact must remain provider-free",
);
assert.ok(
  compiled.pipeline.findIndex((entry) => entry.block === "story_spine") <
    compiled.pipeline.findIndex((entry) => entry.block === "episode_graph"),
  "Episode Graph must consume the actual Story Spine rather than a pre-script placeholder",
);
for (const downstreamSpendStage of ["stock_footage", "entity_imagery", "music", "visual_inserts"] as const) {
  assert.ok(
    compiled.pipeline.findIndex((entry) => entry.block === "episode_graph") <
      compiled.pipeline.findIndex((entry) => entry.block === downstreamSpendStage),
    `Episode Graph must precede ${downstreamSpendStage} so a review checkpoint can stop before visual or provider spend`,
  );
}
assert.ok(
  compiled.pipeline.findIndex((entry) => entry.block === "intro_card") <
    compiled.pipeline.findIndex((entry) => entry.block === "visual_inserts"),
  "the declared data insert layer must materialize after its required intro timing producer",
);
assert.ok(
  compiled.pipeline.findIndex((entry) => entry.block === "quote_overlays") <
    compiled.pipeline.findIndex((entry) => entry.block === "visual_inserts"),
  "the declared data insert layer must materialize after quote overlays whenever they are enabled",
);
assert.ok(
  compiled.pipeline.findIndex((entry) => entry.block === "visual_inserts") <
    compiled.pipeline.findIndex((entry) => entry.block === "timeline_assemble"),
  "the declared data insert layer must materialize before the existing timeline assembler",
);
assert.deepEqual(visualInserts.params, {
  insertTypes: ["big_stat", "line_chart", "bar_compare", "annotated_line", "lower_third"],
  dataStoryContract: "source-attributed-data-story/v1",
  requireNamedSource: true,
  requireSpokenNumericAnchor: true,
  maxInserts: 5,
  minGapSec: 25,
});
assert.equal(
  (visualInserts.params as Record<string, unknown>).renderer,
  undefined,
  "undeclared editor params cannot reach a certified operation",
);
assert.equal(script.params?.dataRich, true);
assert.equal(script.params?.sourceAttributionRequired, true);
assert.equal(scriptQa.params?.dataStoryContract, "source-attributed-data-story/v1");
assert.equal(scriptQa.params?.requireNamedSource, true);
assert.equal(scriptQa.params?.requireSpokenNumericAnchor, true);

const reanchored = compileCertifiedChannelComposition({
  ...input,
  pipeline: [...narratedFixture, { block: "visual_inserts" }],
});
assert.ok(
  reanchored.pipeline.findIndex((entry) => entry.block === "visual_inserts") <
    reanchored.pipeline.findIndex((entry) => entry.block === "timeline_assemble"),
  "an existing insert stage after assembly must be deterministically moved to the declared safe anchor",
);

const quoteAfterVisual = compileCertifiedChannelComposition({
  ...input,
  pipeline: [
    { block: "script_gen" },
    { block: "qa_script" },
    { block: "narration_tts" },
    { block: "story_spine" },
    { block: "stock_footage" },
    { block: "entity_imagery" },
    { block: "music" },
    { block: "intro_card" },
    { block: "visual_inserts" },
    { block: "quote_overlays" },
    { block: "timeline_assemble" },
  ],
});
assert.ok(
  quoteAfterVisual.pipeline.findIndex((entry) => entry.block === "quote_overlays") <
    quoteAfterVisual.pipeline.findIndex((entry) => entry.block === "visual_inserts"),
  "an existing insert stage before quotes must be deterministically moved after its enabled quote producer",
);

const quotesOff = compileCertifiedChannelComposition({
  ...input,
  pipeline: narratedFixture.filter((entry) => entry.block !== "quote_overlays"),
});
assert.ok(
  quotesOff.pipeline.findIndex((entry) => entry.block === "intro_card") <
    quotesOff.pipeline.findIndex((entry) => entry.block === "visual_inserts") &&
    quotesOff.pipeline.findIndex((entry) => entry.block === "visual_inserts") <
      quotesOff.pipeline.findIndex((entry) => entry.block === "timeline_assemble"),
  "quotes-off data stories remain materializable while retaining their required intro and master boundaries",
);

const mutableInsertOperation = compiled.operations.find((operation) => (
  operation.kind === "merge_block_params" && operation.block === "visual_inserts"
));
assert.ok(mutableInsertOperation && mutableInsertOperation.kind === "merge_block_params");
const mutableInsertTypes = (mutableInsertOperation.params.insertTypes as string[] | undefined);
assert.ok(mutableInsertTypes);
mutableInsertTypes.push("forged_runtime_mutation");
const isolatedReplay = compileCertifiedChannelComposition(input);
const isolatedVisualInserts = isolatedReplay.pipeline.find((entry) => entry.block === "visual_inserts");
assert.deepEqual(
  isolatedVisualInserts?.params?.insertTypes,
  ["big_stat", "line_chart", "bar_compare", "annotated_line", "lower_third"],
  "callers cannot mutate the catalog-owned operation list through a prior compilation result",
);

const generic = compileCertifiedChannelComposition({
  ...input,
  capabilitySelections: [],
});
assert.equal(generic.compositionBinding.kind, "exact_catalog_v1");
assert.equal(generic.compositionBinding.receipt.key, "narrated_visual_essay");
assert.equal(generic.materialization, undefined);
assert.deepEqual(generic.operations, []);
assert.deepEqual(generic.pipeline, narratedFixture, "identity-only compositions must not invent a pipeline mutation");

const genericWithoutIntent = compileCertifiedChannelComposition({
  family: "narrated_stock",
  capabilitySelections: [],
  pipeline: narratedFixture,
});
assert.equal(
  genericWithoutIntent.compositionBinding.kind === "exact_catalog_v1"
    ? genericWithoutIntent.compositionBinding.receipt.key
    : undefined,
  "narrated_visual_essay",
  "a default certified composition remains materializable for legacy designer callers without a Program Brief",
);

assert.doesNotThrow(
  () => assertCapabilityCompositionOperationCompatibility([
    {
      source: "fragment-a",
      operation: { kind: "ensure_block_before", block: "shared_insert", beforeBlock: "timeline_assemble" },
    },
    {
      source: "fragment-b",
      operation: { kind: "ensure_block_before", block: "shared_insert", beforeBlock: "timeline_assemble" },
    },
  ]),
  "identical independently sealed anchors are deterministic",
);
assert.throws(
  () => assertCapabilityCompositionOperationCompatibility([
    {
      source: "fragment-a",
      operation: { kind: "ensure_block_before", block: "shared_insert", beforeBlock: "timeline_assemble" },
    },
    {
      source: "fragment-b",
      operation: {
        kind: "ensure_block_between",
        block: "shared_insert",
        afterBlocks: ["narration_tts"],
        beforeBlock: "timeline_assemble",
      },
    },
  ]),
  /conflicting sealed composition anchors/,
  "independent fragments cannot select incompatible anchors for the same inserted block",
);
assert.throws(
  () => assertCapabilityCompositionOperationCompatibility([
    {
      source: "fragment-a",
      operation: { kind: "merge_block_params", block: "shared_insert", params: { maxInserts: 4 } },
    },
    {
      source: "fragment-b",
      operation: { kind: "merge_block_params", block: "shared_insert", params: { maxInserts: 5 } },
    },
  ]),
  /conflicting sealed composition parameter shared_insert\.maxInserts/,
  "independent fragments cannot silently choose a parameter winner",
);
assert.throws(
  () => assertCapabilityCompositionOperationCompatibility([
    {
      source: "fragment-a",
      operation: { kind: "ensure_block_before", block: "visual_inserts", beforeBlock: "timeline_assemble" },
    },
    {
      source: "fragment-b",
      operation: { kind: "ensure_block_before", block: "timeline_assemble", beforeBlock: "visual_inserts" },
    },
  ]),
  /cyclic sealed composition ordering: timeline_assemble -> visual_inserts -> timeline_assemble/,
  "independent fragments cannot create a cycle through different operation targets",
);

assert.throws(
  () => compileCertifiedChannelComposition({ ...input, pipeline: narratedFixture.filter((entry) => entry.block !== "timeline_assemble") }),
  /requires exactly one timeline_assemble block; found 0/,
  "a source data story must fail closed when its existing assembly anchor is absent",
);
assert.throws(
  () => compileCertifiedChannelComposition({ ...input, pipeline: narratedFixture.filter((entry) => entry.block !== "intro_card") }),
  /requires exactly one intro_card block; found 0/,
  "a source data story must fail closed when its required intro timing producer is absent",
);
assert.throws(
  () => compileCertifiedChannelComposition({ ...input, pipeline: narratedFixture.filter((entry) => entry.block !== "story_spine") }),
  /requires exactly one story_spine block; found 0/,
  "the Phase I materialization must reject a placeholder-free checkpoint with no actual Story Spine",
);
assert.throws(
  () => compileCertifiedChannelComposition({ ...input, pipeline: narratedFixture.filter((entry) => entry.block !== "stock_footage") }),
  /requires exactly one stock_footage block; found 0/,
  "the Phase I materialization must retain its explicit first visual-work anchor",
);
assert.throws(
  () => compileCertifiedChannelComposition({ ...input, pipeline: narratedFixture.filter((entry) => entry.block !== "script_gen") }),
  /requires exactly one script_gen block; found 0/,
  "a composition cannot silently skip its sealed script requirement",
);
assert.throws(
  () => compileCertifiedChannelComposition({
    ...input,
    pipeline: [...narratedFixture, { block: "visual_inserts" }, { block: "visual_inserts" }],
  }),
  /requires at most one visual_inserts block; found 2/,
  "ambiguous duplicate operation targets must fail closed rather than choose one arbitrarily",
);
assert.throws(
  () => compileCertifiedChannelComposition({
    ...input,
    family: "cinematic",
    capabilitySelections: sourceDataStorySelection,
  }),
  /not eligible for cinematic/,
  "a source data story cannot cross the narrated-stock family restriction",
);
assert.throws(
  () => compileCertifiedChannelComposition({
    family: "cinematic",
    intent: { concept: "A true-crime factual reconstruction." },
    capabilitySelections: [creativeCapabilitySelection("casefile_cinematic")],
    pipeline: [],
  }),
  /private review only/,
  "private-review capabilities remain non-materializable and cannot gain an automatic path",
);

const designedDataStory = designPipeline({
  family: brief.family,
  nicheKey: brief.nicheKey,
  locale: brief.locale,
  programBrief: brief,
  capabilitySelections: sourceDataStorySelection,
});
const designedGeneric = designPipeline({
  family: brief.family,
  nicheKey: brief.nicheKey,
  locale: brief.locale,
  programBrief: brief,
});
const dataStoryProfile = createChannelShowProfile({
  programBrief: brief,
  capabilitySelections: sourceDataStorySelection,
  pipeline: designedDataStory.pipeline,
});
const genericProfile = createChannelShowProfile({
  programBrief: brief,
  pipeline: designedGeneric.pipeline,
});
assert.equal(dataStoryProfile.composition, undefined);
assert.equal(dataStoryProfile.compositionBinding?.kind, "capability_plan_v1");
assert.notEqual(
  dataStoryProfile.fingerprint,
  genericProfile.fingerprint,
  "the Show Profile fingerprint must bind both the sealed plan authority and its materialized pipeline",
);

console.log("certified channel composition compiler tests passed");
