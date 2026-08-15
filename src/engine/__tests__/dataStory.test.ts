import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DATA_STORY_CONTRACT_VERSION,
  SOURCE_ATTRIBUTED_DATA_STORY,
  dataStoryProductionReadiness,
  hasNamedSourceAttribution,
} from "@/engine/dataStory";
import { designPipeline } from "@/engine/designer";

function params(
  pipeline: ReturnType<typeof designPipeline>["pipeline"],
  block: string,
): Record<string, unknown> {
  const entry = pipeline.find((candidate) => candidate.block === block);
  assert(entry, `expected ${block} in designed pipeline`);
  return (entry.params ?? {}) as Record<string, unknown>;
}

// The evidence detector intentionally refuses vague attribution language; it
// does not claim to fact-check a source, only guards rendering eligibility.
assert.equal(hasNamedSourceAttribution("According to the World Bank, GDP grew 3.2% in 2024."), true);
assert.equal(hasNamedSourceAttribution("Data from NASA shows 42 launches in 2025."), true);
assert.equal(hasNamedSourceAttribution("According to a study, the rate rose 42%."), false);
assert.equal(hasNamedSourceAttribution("The rate rose 42% in 2024."), false);
const moduleAdmission = dataStoryProductionReadiness();
assert.equal(moduleAdmission.autonomous, false, "the source-first Narrated + Stock foundation is not yet admitted as autonomous automation");
assert.match(moduleAdmission.remediation, /fingerprint-bound reviewed data-story source ledger/);

const designed = designPipeline({
  family: "narrated_stock",
  dataStory: SOURCE_ATTRIBUTED_DATA_STORY,
});
const blocks = designed.pipeline.map((entry) => entry.block);
const insertIndex = blocks.indexOf("visual_inserts");
const quoteIndex = blocks.indexOf("quote_overlays");
assert.ok(insertIndex >= 0, "the explicit data-story contract must activate the existing visual_inserts module");
assert.equal(blocks.filter((block) => block === "visual_inserts").length, 1, "data-story design must not duplicate the renderer");
assert.equal(insertIndex, quoteIndex + 1, "data inserts must retain the same compositing anchor as the creator preview");

const inserts = params(designed.pipeline, "visual_inserts");
assert.equal(inserts.dataStoryContract, DATA_STORY_CONTRACT_VERSION);
assert.equal(inserts.requireNamedSource, true);
assert.equal(inserts.requireSpokenNumericAnchor, true);
assert.deepEqual(inserts.insertTypes, ["big_stat", "line_chart", "bar_compare", "annotated_line", "lower_third"]);
assert.equal(params(designed.pipeline, "script_gen").sourceAttributionRequired, true);
assert.equal(params(designed.pipeline, "script_gen").dataRich, true);
assert.equal(params(designed.pipeline, "qa_script").dataStoryContract, DATA_STORY_CONTRACT_VERSION);
assert.equal(designed.productionReady, false, "the strict profile must carry its own source-first admission blocker");
assert(
  designed.runtimeBlockers.some((blocker) => blocker.includes("editor-reviewed source ledger")),
  "the designer must surface the source-ledger admission gap distinctly from family readiness",
);

assert.throws(
  () => designPipeline({ family: "whiteboard", dataStory: SOURCE_ATTRIBUTED_DATA_STORY }),
  /supported only by Narrated \+ Stock Footage/,
  "a strict source-attributed profile must never pretend to work in a self-contained renderer",
);

const creatorSource = readFileSync(join(process.cwd(), "src/app/(app)/channels/new/page.tsx"), "utf8");
assert.match(creatorSource, /previewBlocks\(family, toggles, nicheKey, dataStory\)/);
assert.match(creatorSource, /const needsDataInserts = \(dataStory && supportsDataStoryFamily\(familyKey\)\)/);
assert.match(creatorSource, /\{ dataStory: SOURCE_ATTRIBUTED_DATA_STORY \}/);
assert.match(creatorSource, /At least 3 named-source numeric sentences are required/);
assert.match(creatorSource, /Automatic production remains blocked until a source-first Narrated \+ Stock foundation is registered/);

const routeSource = readFileSync(join(process.cwd(), "src/app/api/build-channel/route.ts"), "utf8");
assert.match(routeSource, /dataStoryProductionReadiness\(\)/);
assert.match(routeSource, /dataStoryReadiness\.remediation/);

const catalogSource = readFileSync(join(process.cwd(), "src/engine/moduleCatalog.ts"), "utf8");
const surfacesSource = readFileSync(join(process.cwd(), "src/engine/moduleSurfaces.ts"), "utf8");
assert.match(catalogSource, /Source-attributed Data Story profile/);
assert.match(surfacesSource, /source_attributed_data_story/);

console.log("data-story contract, designer, creator preview, and module-surface tests passed");
