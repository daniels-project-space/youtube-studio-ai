import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatPreflight,
  rankFormatCandidates,
  recommendFormatDeterministically,
  selectFormat,
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
const dataStoryModule = dataStory.preflight.recommendedModules.find(
  (module) => module.block === "visual_inserts",
);
assert.equal(
  dataStoryModule?.contract?.version,
  DATA_STORY_CONTRACT_VERSION,
  "the recommendation must carry the typed strict evidence contract",
);
assert.equal(
  dataStory.preflight.recommendedModules[0]?.automationAdmission.autonomous,
  false,
  "a wired data renderer must not be advertised as a no-Gemini autonomous production module",
);
assert.equal(dataStory.preflight.productionReady, false, "an implied non-autonomous module must block automatic channel admission");
assert.equal(dataStory.preflight.sourceRequirementsReady, false, "data-story evidence must be supplied before automatic production");
assert.deepEqual(
  dataStory.preflight.moduleAdmissions.map((module) => ({
    block: module.block,
    requiredForConcept: module.requiredForConcept,
    autonomous: module.autonomous,
  })),
  [{ block: "visual_inserts", requiredForConcept: true, autonomous: false }],
  "the advisor must expose the module's actual automation admission instead of treating it as decorative advice",
);
assert(
  dataStory.preflight.missingRequirements.some((requirement) => requirement.includes("named concrete source")),
  "the concept-specific source evidence contract must be surfaced before a channel can be created",
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
assert.equal(cinematic.planning.ready, false, "the advisor must expose the missing non-Gemini cinematic planner");
assert.equal(cinematic.runtime.ready, false, "the advisor must expose the unattested LTX runtime rather than hiding it behind a generic label");
assert(
  cinematic.runtime.blockers.some((blocker) => blocker.includes("ltx_2_5_revision_not_benchmarked_on_rtx_4090")),
  "the current Novita/LTX preflight must be reported from the real runtime assessment",
);
assert.equal(cinematic.contentLane, "cinematic_ai");
assert(cinematic.requiredPipelineModules.includes("novita_render_images"));
assert(cinematic.requiredPipelineModules.includes("novita_render_video"));
assert(cinematic.requiredPipelineModules.includes("qa_shots"));
assert.equal(cinematic.validationRenderRequired, true);

const casefileCinematic = recommendFormatDeterministically({
  concept: "A Fern-style true crime investigation with source-bound faceless mannequin reconstructions",
  targetDurationSeconds: 300,
  maxPerVideoBudgetUsd: 150,
});
assert.equal(casefileCinematic.family, "cinematic", "casework must retain the cinematic lane rather than collapse to generic narrated footage");
assert.equal(casefileCinematic.available, false, "human-reviewed Casefile evidence must never be advertised as automatic production");
assert.deepEqual(
  casefileCinematic.preflight.recommendedModules.map((module) => module.block),
  ["casefile_source_packet", "casefile_evidence_shot_map", "cinematic_case_sequence"],
  "high-integrity crime concepts must compose the real source, evidence-map, and cinematic-sequence modules",
);
assert.equal(
  casefileCinematic.preflight.moduleAdmissions.every((module) => !module.autonomous),
  true,
  "the creator must see the private-review status before any design/provider work starts",
);
assert(
  casefileCinematic.preflight.sourceRequirements.includes("source-first Case Packet"),
  "the creator must surface the Casefile evidence package before it offers cinematic reconstruction",
);
assert(
  casefileCinematic.preflight.qualityFocus.includes("causal tension-and-reveal edit"),
  "the quality bar must expose Fern-relevant editorial intent, not only generic shot continuity",
);

const fictionalCinematic = formatPreflight("cinematic", {
  concept: "An original fictional crime thriller mini film with faceless mannequins",
});
assert.deepEqual(
  fictionalCinematic.recommendedModules,
  [],
  "fictional mini-films must not be misclassified as factual Casefile work",
);

const blockedLofi = recommendFormatDeterministically({ concept: "Lo-fi study beats over a seamless animated loop" });
assert.equal(blockedLofi.family, "music_loop", "the advisor must preserve the actual requested format");
assert.equal(blockedLofi.available, false, "a blocked renderer must not become a fake production recommendation");
assert.match(blockedLofi.reasoning, /no unrelated channel was substituted/i);
assert.equal(
  blockedLofi.alternates.some((alternate) => alternate.family === "quizyear"),
  false,
  "a runnable but zero-signal QuizYear route is not an honest alternate to a blocked music channel",
);

const explicitHybrid = recommendFormatDeterministically({
  concept: "Cinematic reconstruction mini film with an interactive quiz challenge",
});
assert.equal(explicitHybrid.family, "cinematic", "a stronger cinematic intent must not be silently replaced by a quiz");
assert.deepEqual(
  explicitHybrid.alternates.map((alternate) => alternate.family),
  ["quizyear", "narrated_stock"],
  "an explicit quiz request may surface QuizYear, while an independently admitted narrated route may surface only when the concept also has real narrated-story intent",
);
assert(
  explicitHybrid.alternates.every((alternate) => formatPreflight(alternate.family, { concept: "Cinematic reconstruction mini film with an interactive quiz challenge" }).productionReady),
  "every visible alternate must pass its real current preflight",
);

const constrainedQuiz = formatPreflight("quizyear", {
  concept: "Interactive multiple-choice trivia challenge",
  targetDurationSeconds: 600,
  maxPerVideoBudgetUsd: 1,
});
assert.equal(constrainedQuiz.planning.ready, true, "the registered QuizYear planner should remain visible as a real no-Gemini capability");
assert.equal(constrainedQuiz.runtime.ready, true, "QuizYear has no unattested video-provider block in its family runtime contract");
assert.equal(constrainedQuiz.duration.withinFamilyContract, false, "creator duration constraints must be evaluated before the designer starts");
assert.equal(constrainedQuiz.budget.withinRequestedBudget, false, "creator budget caps must be evaluated against the family reservation floor");
assert.equal(constrainedQuiz.productionReady, false, "a runnable family cannot be advertised as ready when the requested constraints are impossible");
assert.match(constrainedQuiz.runtimeBlockers.join(" "), /requested 600s/);
assert.match(constrainedQuiz.runtimeBlockers.join(" "), /budget cap \$1\.00/);
assert.doesNotMatch(constrainedQuiz.runtimeBlockers.join(" "), /no-Gemini channel inception is not registered/);

// The creator route is a lightweight server request. It must describe the lane
// without importing the executable renderer registry (which contains browser
// compositions and native render dependencies); runtime compilation remains in
// the authorized Trigger design path.
const advisorSource = readFileSync(join(process.cwd(), "src/engine/creative/selectFormat.ts"), "utf8");
assert(!advisorSource.includes("@/engine/designer"), "format advisor must not import the runtime designer");
assert(!advisorSource.includes("@/engine/blocks"), "format advisor must not import the executable block registry");
assert(!advisorSource.includes("@/lib/gemini"), "the creator advisor must not import the Gemini runtime boundary");
assert(!/\bgeminiJson\s*(?:<|\()/.test(advisorSource), "the creator advisor must not retain a hidden Gemini selection call");
assert(!advisorSource.includes("catalogForPrompt"), "the Gemini prompt/catalog route must be removed rather than left dormant");

async function verifyPublicAsyncSelection(): Promise<void> {
  const logs: string[] = [];
  const selection = await selectFormat(
    { concept: "Interactive multiple-choice trivia challenge about capitals and currencies" },
    (message) => logs.push(message),
  );
  assert.equal(selection.family, "quizyear");
  assert.equal(selection.available, true, "selectFormat may advertise QuizYear after its deterministic channel foundation is wired");
  assert.equal(selection.fallback, true, "the public async API must identify deterministic selection truthfully");
  assert.equal(selection.preflight.planning.mode, "registered_non_gemini");
  assert.doesNotMatch(selection.preflight.runtimeBlockers.join(" "), /no-Gemini channel inception is not registered/);
  assert.match(logs.join("\n"), /selectFormat: deterministic/);
  assert.doesNotMatch(logs.join("\n"), /semantic advisor unavailable/i);
}

void verifyPublicAsyncSelection()
  .then(() => console.log("FORMAT ADVISOR TESTS PASS"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
