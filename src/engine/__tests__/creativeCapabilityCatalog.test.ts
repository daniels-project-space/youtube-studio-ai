import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CREATIVE_CAPABILITY_CATALOG,
  CREATIVE_CAPABILITY_CATALOG_FINGERPRINT,
  assessCreativeCapabilityAutomaticBuildAdmission,
  assertCreativeCapabilityCatalog,
  assertCreativeCapabilityPipelineObligations,
  assertResolvedCreativeCapabilityPipelineObligations,
  creativeCapabilitySelection,
  privateReviewCapabilityOffers,
  resolveCreativeCapabilities,
  validateCreativeCapabilitySelections,
  type CreativeCapabilityOffer,
} from "@/engine/creative/creativeCapabilityCatalog";
import { formatPreflight } from "@/engine/creative/selectFormat";
import { designPipeline } from "@/engine/designer";

const dataIntent = {
  concept: "A source-attributed data storytelling channel with animated charts and ranked comparisons",
  niche: "Business history",
  nicheKey: "business-history",
};
const dataSelection = creativeCapabilitySelection("source_attributed_data_story");

const dataOffer = resolveCreativeCapabilities(dataIntent, "narrated_stock").find(
  (offer) => offer.capability === "source_attributed_data_story",
);
assert(dataOffer, "the resolver must expose the existing source-attributed data-story module");
assert.equal(dataOffer.selectionMode, "explicit_opt_in");
assert.equal(dataOffer.modules[0]?.block, "visual_inserts");
assert.equal(dataOffer.pipelineObligations.some((obligation) => obligation.block === "qa_script"), true);

const resolvedDataSelection = validateCreativeCapabilitySelections({
  family: "narrated_stock",
  intent: dataIntent,
  selections: [dataSelection],
});
const blockedDataStoryBuild = assessCreativeCapabilityAutomaticBuildAdmission(resolvedDataSelection);
assert.equal(
  blockedDataStoryBuild.autonomous,
  false,
  "a selected explicit opt-in must still be barred from automatic build when its materialized admission is non-autonomous",
);
assert.match(
  blockedDataStoryBuild.blockers[0]?.admission.remediation ?? "",
  /fingerprint-bound reviewed data-story source ledger/,
  "the generic admission result must preserve the data-story source-ledger remediation",
);

// Future automatic opt-ins use the same materialized admission and exact
// pipeline-evidence path; this synthetic materialization deliberately flips
// only the admission rather than creating a separate one-off test capability.
const hypotheticalAutomaticDataStoryOffer: CreativeCapabilityOffer = {
  ...dataOffer,
  automationAdmission: {
    autonomous: true,
    blockers: [],
    remediation: "",
  },
};
const hypotheticalAutomaticSelection = [{
  selection: dataSelection,
  offer: hypotheticalAutomaticDataStoryOffer,
}];
assert.equal(
  assessCreativeCapabilityAutomaticBuildAdmission(hypotheticalAutomaticSelection).autonomous,
  true,
  "an autonomous explicit opt-in must remain eligible for an automatic build boundary",
);
assertResolvedCreativeCapabilityPipelineObligations(hypotheticalAutomaticSelection, [
  { block: "timeline_assemble" },
  {
    block: "visual_inserts",
    params: {
      dataStoryContract: "source-attributed-data-story/v1",
      requireNamedSource: true,
      requireSpokenNumericAnchor: true,
      insertTypes: ["big_stat", "line_chart", "bar_compare", "annotated_line", "lower_third"],
    },
  },
  { block: "script_gen", params: { dataRich: true, sourceAttributionRequired: true } },
  {
    block: "qa_script",
    params: {
      dataStoryContract: "source-attributed-data-story/v1",
      requireNamedSource: true,
      requireSpokenNumericAnchor: true,
    },
  },
]);

const preflight = formatPreflight("narrated_stock", dataIntent);
assert.equal(preflight.capabilityCatalogFingerprint, CREATIVE_CAPABILITY_CATALOG_FINGERPRINT);
assert.equal(
  preflight.creativeCapabilities.some((offer) => offer.capability === "source_attributed_data_story"),
  true,
  "preflight must expose catalog capability offers instead of a bespoke one-off branch",
);

assert.throws(
  () => validateCreativeCapabilitySelections({
    family: "narrated_stock",
    intent: dataIntent,
    selections: [{ capability: "not-a-capability", catalogFingerprint: CREATIVE_CAPABILITY_CATALOG_FINGERPRINT }],
  }),
  /unknown creative capability/,
  "unknown client selections must fail closed",
);

assert.throws(
  () => validateCreativeCapabilitySelections({
    family: "narrated_stock",
    intent: dataIntent,
    selections: [{ capability: "source_attributed_data_story", catalogFingerprint: "stale-catalog" }],
  }),
  /stale creative-capability catalog fingerprint/,
  "stale browser offers must be rejected before compilation",
);

assert.throws(
  () => validateCreativeCapabilitySelections({
    family: "illustrated_explainer",
    intent: dataIntent,
    selections: [dataSelection],
  }),
  /not eligible for illustrated_explainer/,
  "a capability cannot claim a family it did not declare",
);

assert.throws(
  () => validateCreativeCapabilitySelections({
    family: "narrated_stock",
    intent: { concept: "A calm finance explainer" },
    selections: [dataSelection],
  }),
  /not eligible for the stated channel concept/,
  "explicit opt-in cannot bypass the catalog's deterministic intent admission",
);

const casefile = resolveCreativeCapabilities({
  concept: "A Fern-style true crime investigation with source-bound faceless mannequin reconstructions",
}, "cinematic").find((offer) => offer.capability === "casefile_cinematic");
assert(casefile, "factual cinematic intent must resolve to the Casefile capability");
assert.equal(casefile.selectionMode, "private_review_only");
assert.equal(casefile.reviewHref, "/casefile");
for (const concept of [
  "A source-led engineering systems failure investigation",
  "A historical aviation disaster reconstruction with primary evidence",
  "A financial fraud case explained through source documents",
  "A company scandal timeline with cited records",
]) {
  assert.equal(
    resolveCreativeCapabilities({ concept }, "cinematic").some((offer) => offer.capability === "casefile_cinematic"),
    true,
    `${concept} must discover the existing supervised Casefile path rather than need a separate channel pipeline`,
  );
}
assert.deepEqual(
  privateReviewCapabilityOffers(formatPreflight("cinematic", {
    concept: "A Fern-style true crime investigation with source-bound faceless mannequin reconstructions",
  }).creativeCapabilities).map((offer) => offer.capability),
  ["casefile_cinematic"],
  "the format layer must carry review-only admission from the catalog, not re-parse Casefile module profiles",
);
assert.throws(
  () => validateCreativeCapabilitySelections({
    family: "cinematic",
    intent: { concept: "A Fern-style true crime investigation with source-bound faceless mannequin reconstructions" },
    selections: [creativeCapabilitySelection("casefile_cinematic")],
  }),
  /private review only; use \/casefile/,
  "a supervised capability must yield only its review route, never an automatic build selection",
);

const children = formatPreflight("children_learning", {
  concept: "An original animated preschool kids show with gentle participation",
}).creativeCapabilities.find((offer) => offer.capability === "children_show_bible");
assert(children, "children route must be catalogued as a reusable supervised capability");
assert.equal(children.selectionMode, "private_review_only");

assert.throws(
  () => assertCreativeCapabilityPipelineObligations("narrated_stock", [dataSelection], [
    { block: "timeline_assemble" },
    { block: "script_gen", params: { dataRich: true, sourceAttributionRequired: true } },
    { block: "qa_script", params: { dataStoryContract: "source-attributed-data-story/v1", requireNamedSource: true, requireSpokenNumericAnchor: true } },
  ]),
  /requires effective pipeline block visual_inserts/,
  "selected capabilities must reject an effective graph that omits a declared obligation",
);

const malformedCatalog = CREATIVE_CAPABILITY_CATALOG.map((definition, index) => index === 0
  ? {
      ...definition,
      materialize: (intent: Parameters<typeof definition.materialize>[0], family: Parameters<typeof definition.materialize>[1]) => ({
        ...definition.materialize(intent, family),
        pipelineObligations: [{ block: "undeclared_pipeline_block" }],
      }),
    }
  : definition,
);
assert.throws(
  () => assertCreativeCapabilityCatalog(malformedCatalog),
  /declares unknown pipeline block undeclared_pipeline_block/,
  "catalog integrity must reject a capability that names an undeclared module",
);

const designed = designPipeline({
  family: "narrated_stock",
  capabilitySelections: [dataSelection],
});
const blocks = designed.pipeline.map((entry) => entry.block);
assert.equal(blocks.includes("visual_inserts"), true);
const insert = designed.pipeline.find((entry) => entry.block === "visual_inserts");
assert.equal(insert?.params?.dataStoryContract, "source-attributed-data-story/v1");
assert.equal(insert?.params?.requireNamedSource, true);
assert.equal(insert?.params?.requireSpokenNumericAnchor, true);
assert.equal(designed.pipeline.find((entry) => entry.block === "script_gen")?.params?.sourceAttributionRequired, true);
assert.equal(designed.pipeline.find((entry) => entry.block === "qa_script")?.params?.dataStoryContract, "source-attributed-data-story/v1");
assert.equal(
  designed.productionReady,
  false,
  "exact compiled evidence does not weaken the current data-story source-first admission gate",
);

const buildRouteSource = readFileSync(
  new URL("../../app/api/build-channel/route.ts", import.meta.url),
  "utf8",
);
assert.match(buildRouteSource, /privateReviewCapabilityOffers\(creatorPreflight\.creativeCapabilities\)/);
assert.match(buildRouteSource, /assessCreativeCapabilityAutomaticBuildAdmission/);
const automaticAdmissionGate = buildRouteSource.indexOf("if (!automaticCapabilityAdmission.autonomous)");
const taskDispatch = buildRouteSource.indexOf("return tasks.trigger(");
assert(
  automaticAdmissionGate >= 0 && automaticAdmissionGate < taskDispatch,
  "a selected non-autonomous capability must return before the design task can dispatch",
);
const automaticAdmissionResponse = buildRouteSource.slice(automaticAdmissionGate, taskDispatch);
assert.match(automaticAdmissionResponse, /sourceRequirements:/);
assert.match(automaticAdmissionResponse, /remediation:/);
assert.match(automaticAdmissionResponse, /\{ status: 409 \}/);
assert.doesNotMatch(buildRouteSource, /source_first_casefile\/v1|faceless_source_bound_cinematic_sequence\/v1/);

console.log("creative capability catalog contract tests passed");
