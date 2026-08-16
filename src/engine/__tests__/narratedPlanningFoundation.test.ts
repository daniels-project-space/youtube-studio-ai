import assert from "node:assert/strict";

import { familyChannelInceptionCapability } from "@/engine/channelInceptionCapability";
import { designPipeline } from "@/engine/designer";
import {
  assertFamilyAutonomousPlanningPipeline,
  familyProductionReadiness,
} from "@/engine/families";
import {
  NON_GEMINI_NARRATED_FOUNDATION_VERSION,
  narratedPlanningFoundation,
} from "@/engine/narratedPlanningFoundation";

for (const family of ["narrated_stock", "sleep", "shorts"] as const) {
  const foundation = narratedPlanningFoundation(family);
  assert(foundation, `${family} must opt into the shared narrated foundation explicitly`);
  assert.equal(foundation.version, NON_GEMINI_NARRATED_FOUNDATION_VERSION);
  assert.match(foundation.sourcePolicy, /Topiccraft requires a verified demand\/freshness evidence packet/);
  assert.match(foundation.publishingPolicy, /upload_draft is mandatory/);
  assert.ok(
    foundation.requiredEntries.some((entry) => entry.block === "upload_draft"),
    `${family} must retain the private-first release gate in its executable admission spine`,
  );

  const designed = designPipeline({ family, nicheKey: "general" });
  assert.doesNotThrow(
    () => assertFamilyAutonomousPlanningPipeline(family, designed.pipeline),
    `${family} must satisfy the exact shared non-Gemini planning contract after design`,
  );
  assert.equal(
    familyProductionReadiness(family).productionReady,
    true,
    `${family} cannot be admitted until the complete planner, render, and creator route is registered`,
  );
  const inception = familyChannelInceptionCapability(family);
  assert.equal(inception.mode, "registered_non_gemini");
  if (inception.mode === "registered_non_gemini") {
    assert.ok(inception.coveredStages.includes("draft-only-publication-state"));
    assert.match(inception.provenance, /sealed thumbnail-only Gemini exception/);
  }
}

const sleep = designPipeline({ family: "sleep", nicheKey: "general" }).pipeline;
assert.throws(
  () => assertFamilyAutonomousPlanningPipeline(
    "sleep",
    sleep.map((entry) => entry.block === "script_gen"
      ? { ...entry, params: { ...(entry.params ?? {}), style: "essay" } }
      : entry),
  ),
  /requires script_gen\.style="meditation"/,
  "guided ambient cannot be relabelled from a generic narrated essay",
);

const shorts = designPipeline({ family: "shorts", nicheKey: "general" }).pipeline;
assert.throws(
  () => assertFamilyAutonomousPlanningPipeline(
    "shorts",
    shorts.map((entry) => entry.block === "timeline_assemble"
      ? { ...entry, params: { ...(entry.params ?? {}), aspect: "16:9" } }
      : entry),
  ),
  /requires timeline_assemble\.aspect="9:16"/,
  "a vertical Short cannot silently become a landscape narrated essay",
);
assert.throws(
  () => assertFamilyAutonomousPlanningPipeline(
    "shorts",
    shorts.map((entry) => entry.block === "length_check"
      ? { ...entry, params: { ...(entry.params ?? {}), maxSeconds: 61 } }
      : entry),
  ),
  /15–60 second length_check envelope/,
  "the admitted Shorts foundation must not tolerate a render beyond the platform-length contract",
);

const children = familyProductionReadiness("children_learning");
assert.equal(children.productionReady, false, "children remain separately blocked pending their supervised planner and creator foundation");

console.log("narrated planning foundation tests passed");
