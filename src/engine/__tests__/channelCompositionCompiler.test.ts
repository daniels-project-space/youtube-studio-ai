import assert from "node:assert/strict";

import {
  CHANNEL_COMPOSITION_COMPILER_VERSION,
  compileCertifiedChannelComposition,
} from "@/engine/channelCompositionCompiler";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import {
  creativeCapabilitySelection,
} from "@/engine/creative/creativeCapabilityCatalog";
import { designPipeline } from "@/engine/designer";
import { createChannelShowProfile } from "@/engine/channelShowProfile";
import type { PipelineEntry } from "@/engine/types";

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
assert.equal(compiled.receipt.key, "source_attributed_data_story");
assert.equal(
  compiled.receipt.definitionVersion,
  "v3",
  "new admissions must resolve the sealed declarative definition rather than rewrite historical v1/v2 receipts",
);
assert.equal(compiled.materialization?.version, "source-attributed-data-story-materialization/v2");
assert.equal(compiled.operations.length, 4);
assert.deepEqual(compiled, replay, "certified composition compilation must be deterministic");
assert.deepEqual(
  narratedFixture,
  [
    { block: "script_gen", params: { maxSeconds: 600, style: "business_explainer" } },
    { block: "qa_script" },
    { block: "narration_tts" },
    { block: "intro_card" },
    { block: "quote_overlays" },
    { block: "timeline_assemble" },
  ],
  "the pure materializer must not mutate the caller's baseline pipeline",
);

const visualInserts = compiled.pipeline.find((entry) => entry.block === "visual_inserts");
const script = compiled.pipeline.find((entry) => entry.block === "script_gen");
const scriptQa = compiled.pipeline.find((entry) => entry.block === "qa_script");
assert.ok(visualInserts);
assert.ok(script);
assert.ok(scriptQa);
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
assert.equal(generic.receipt.key, "narrated_visual_essay");
assert.equal(generic.materialization, undefined);
assert.deepEqual(generic.operations, []);
assert.deepEqual(generic.pipeline, narratedFixture, "identity-only compositions must not invent a pipeline mutation");

const genericWithoutIntent = compileCertifiedChannelComposition({
  family: "narrated_stock",
  capabilitySelections: [],
  pipeline: narratedFixture,
});
assert.equal(
  genericWithoutIntent.receipt.key,
  "narrated_visual_essay",
  "a default certified composition remains materializable for legacy designer callers without a Program Brief",
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
assert.equal(dataStoryProfile.composition?.definitionVersion, "v3");
assert.notEqual(
  dataStoryProfile.fingerprint,
  genericProfile.fingerprint,
  "the existing Show Profile fingerprint must bind both the v3 composition receipt and its materialized pipeline",
);

console.log("certified channel composition compiler tests passed");
