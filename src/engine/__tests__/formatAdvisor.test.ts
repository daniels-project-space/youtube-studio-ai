import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatPreflight,
  rankFormatCandidates,
  recommendFormatDeterministically,
} from "@/engine/creative/selectFormat";
import { DATA_STORY_CONTRACT_VERSION } from "@/engine/dataStory";

function expectFamily(concept: string, family: string): void {
  const recommendation = recommendFormatDeterministically({ concept });
  assert.equal(
    recommendation.family,
    family,
    `expected \"${concept}\" to choose ${family}, got ${recommendation.family}`,
  );
  assert.equal(recommendation.preflight.validationRenderRequired, true);
  assert.equal(recommendation.crew.includes("critic"), true, "every recommendation retains the critic gate");
}

// The no-model path is the safety floor for automatic creation. It must be able
// to discover every specialist lane rather than silently collapsing to narrated
// stock when an LLM/provider is unavailable.
expectFamily("An illustrated graphic-novel history channel with motion-comic panels", "comic");
expectFamily("Source-led archival micro-documentary Shorts with on-screen evidence", "documentary_collage_short");
expectFamily("First-person mythology lore micro stories", "loreshort");
expectFamily("Interactive multiple-choice trivia challenge about capitals and currencies", "quizyear");
expectFamily("Cinematic true-crime reconstruction mini films", "cinematic");
expectFamily("Lo-fi study beats over a seamless animated loop", "music_loop");
expectFamily("Guided breathwork for sleep and relaxation", "sleep");
expectFamily("Hand-drawn whiteboard explainer for a science mechanism", "whiteboard");
expectFamily("Vertical caption-led viral fact reels", "shorts");

const ranked = rankFormatCandidates({ concept: "evidence-led archival documentary short" });
assert.equal(ranked[0]?.family, "documentary_collage_short");
assert(ranked[0]!.matchedSignals.length > 0, "ranking must explain its deterministic match");

const documentary = formatPreflight("documentary_collage_short", {
  concept: "A source-led archival documentary Short",
});
assert.equal(documentary.templateAvailable, true, "the built documentary lane must have a registered template");
assert.equal(documentary.runtimeCompilationRequired, true, "only the authorized runtime design task may compile the exact pipeline");
assert.equal(documentary.contentLane, "documentary_collage_short");
assert.deepEqual(documentary.missingRequirements, ["structured sourceReferences", "per-claim claimEvidence"]);
assert(documentary.requiredPipelineModules.includes("short_strategy"), "the preflight must expose the evidence-owning lane requirement");
assert(documentary.requiredPipelineModules.includes("documotion_short"));

const dataStory = recommendFormatDeterministically({
  concept: "A source-attributed data storytelling channel with animated charts and ranked comparisons",
});
assert.equal(dataStory.family, "narrated_stock", "chart-led data stories must select the real narrated timeline family");
assert.deepEqual(
  dataStory.preflight.recommendedModules.map((module) => module.block),
  ["visual_inserts"],
  "the advisor must recommend the existing certified data-insert module, not invent a renderer",
);
assert.equal(
  dataStory.preflight.recommendedModules[0]?.contract.version,
  DATA_STORY_CONTRACT_VERSION,
  "the recommendation must carry the typed strict evidence contract",
);
assert.equal(
  dataStory.preflight.recommendedModules[0]?.automationAdmission.autonomous,
  false,
  "a wired data renderer must not be advertised as a no-Gemini autonomous production module",
);
assert.deepEqual(
  formatPreflight("narrated_stock", { concept: "A calm finance explainer" }).recommendedModules,
  [],
  "generic finance language must not silently imply the source-attributed data-story profile",
);

const cinematic = formatPreflight("cinematic", { concept: "A historical cinematic reconstruction" });
assert.equal(cinematic.templateAvailable, true, "the Novita cinematic lane must be registered");
assert.equal(cinematic.productionReady, false, "the creator must not advertise the known-impossible LTX renderer as ready");
assert.equal(
  cinematic.fallbackFamily,
  undefined,
  "a Gemini-blocked family must not advertise another Gemini-blocked route as a production fallback",
);
assert.equal(cinematic.contentLane, "cinematic_ai");
assert(cinematic.requiredPipelineModules.includes("novita_render_images"));
assert(cinematic.requiredPipelineModules.includes("novita_render_video"));
assert(cinematic.requiredPipelineModules.includes("qa_shots"));
assert.equal(cinematic.validationRenderRequired, true);

const blockedLofi = recommendFormatDeterministically({ concept: "Lo-fi study beats over a seamless animated loop" });
assert.equal(blockedLofi.family, "music_loop", "the advisor must preserve the actual requested format");
assert.equal(blockedLofi.available, false, "a blocked renderer must not become a fake production recommendation");
assert.match(blockedLofi.reasoning, /No unlike substitute was selected automatically/);

// The creator route is a lightweight server request. It must describe the lane
// without importing the executable renderer registry (which contains browser
// compositions and native render dependencies); runtime compilation remains in
// the authorized Trigger design path.
const advisorSource = readFileSync(join(process.cwd(), "src/engine/creative/selectFormat.ts"), "utf8");
assert(!advisorSource.includes("@/engine/designer"), "format advisor must not import the runtime designer");
assert(!advisorSource.includes("@/engine/blocks"), "format advisor must not import the executable block registry");

console.log("FORMAT ADVISOR TESTS PASS");
