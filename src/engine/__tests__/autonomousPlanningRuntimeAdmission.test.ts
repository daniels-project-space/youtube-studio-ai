import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { assertPipelineMatchesContentLane, contentLaneForFamily } from "@/engine/contentLane";
import { designPipeline } from "@/engine/designer";
import { assertFamilyAutonomousPlanningPipeline } from "@/engine/families";
import { compilePipeline } from "@/engine/pipelineCompiler";
import { validatePipeline } from "@/engine/validate";

// A lane-level compilation checks media shape, but cannot by itself prove the
// registered no-Gemini planning/admission spine survived a later edit. Story
// Spine is intentionally a concrete regression case: it is production-critical
// for narrated causal pacing but not a visual-lane requirement.
const narrated = designPipeline({
  family: "narrated_stock",
  nicheKey: "history",
  lengthMinutes: 5,
  toggles: {},
}).pipeline;
const withoutStorySpine = narrated.filter((entry) => entry.block !== "story_spine");

assert.doesNotThrow(() => {
  assertPipelineMatchesContentLane(contentLaneForFamily("narrated_stock")!, withoutStorySpine);
  compilePipeline(validatePipeline(withoutStorySpine));
}, "the regression graph remains structurally valid at the visual-lane/compiler layer");
assert.throws(
  () => assertFamilyAutonomousPlanningPipeline("narrated_stock", withoutStorySpine),
  /missing required module story_spine/,
  "the family capability contract must retain its Story Spine requirement",
);

const inceptionSource = readFileSync(
  new URL("../../trigger/designChannelInception.ts", import.meta.url),
  "utf8",
);
const certificationStart = inceptionSource.indexOf("function certifyChannelPipeline");
const certificationAdmission = inceptionSource.indexOf(
  "assertFamilyAutonomousPlanningPipeline(args.family, args.pipeline);",
);
const certificationCompile = inceptionSource.indexOf(
  "const compilation = compilePipeline(validatePipeline(args.pipeline));",
);
assert.ok(
  certificationStart >= 0 &&
    certificationAdmission > certificationStart &&
    certificationAdmission < certificationCompile,
  "Channel Inception must enforce family planning admission before sealing a compiled pipeline",
);

const runtimeSource = readFileSync(new URL("../../trigger/runPipeline.ts", import.meta.url), "utf8");
const laneAssertion = runtimeSource.indexOf("assertPipelineMatchesContentLane(contentLane, entries);");
const runtimeAdmission = runtimeSource.indexOf(
  "assertFamilyAutonomousPlanningPipeline(laneFamily as FamilyKey, entries);",
);
const videoRuntimeGate = runtimeSource.indexOf("assertPipelineVideoRuntimeReady(entries);");
assert.ok(
  laneAssertion >= 0 && runtimeAdmission > laneAssertion && runtimeAdmission < videoRuntimeGate,
  "every canonical family run must re-check its planning admission before provider execution",
);

console.log("Autonomous planning runtime admission tests passed");
