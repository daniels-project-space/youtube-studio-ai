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

for (const [family, concept] of [
  ["whiteboard", "Hand-drawn whiteboard explainer for a science mechanism"],
  ["comic", "An illustrated graphic-novel history channel with motion-comic panels"],
] as const) {
  const preflight = formatPreflight(family, { concept });
  assert.equal(preflight.productionReady, false, `${family} factual intent must not bypass source provenance`);
  assert.deepEqual(
    preflight.sourceRequirements,
    ["reviewed factual evidence pack", "source-bound claim ledger"],
    `${family} factual intent must request the durable evidence route rather than invent claims`,
  );
}
assert.equal(
  formatPreflight("whiteboard", { concept: "Original whiteboard logic puzzle stories" }).productionReady,
  true,
  "the source boundary must preserve automatic original whiteboard storytelling",
);
assert.equal(
  formatPreflight("comic", { concept: "Original character-led motion-comic mini stories" }).productionReady,
  true,
  "the source boundary must preserve automatic original motion-comic storytelling",
);

// `channelTypes` are capability promises, not decorative catalog copy. The
// deterministic advisor must discover the reusable families from the natural
// language used to describe the opportunity, without a bespoke per-channel
// branch or a model call.
const reusableExplainerOpportunities = [
  ["An animated geography atlas explaining trade routes", "illustrated_explainer", "geography atlas"],
  ["An animated science lesson showing how ecosystems work", "illustrated_explainer", "animated science"],
  ["An economic history explainer about the rise of railroads", "narrated_stock", "economic history"],
  ["A business history explainer about company strategy", "narrated_stock", "business history"],
] as const;
for (const [concept, family, expectedSignal] of reusableExplainerOpportunities) {
  const recommendation = recommendFormatDeterministically({ concept });
  assert.equal(recommendation.family, family, `${concept} must select its existing reusable family`);
  assert.match(recommendation.reasoning, new RegExp(`Matched .*${expectedSignal}`));
  // This taxonomy fix only improves discovery. It must not relax the existing
  // production, source, provider, or validation gates for the selected family.
  assert.equal(recommendation.preflight.validationRenderRequired, true);
}

const factualIllustratedExplainer = recommendFormatDeterministically({
  concept: "An animated geography atlas explaining factual trade routes with source-bound maps",
});
assert.equal(factualIllustratedExplainer.family, "illustrated_explainer");
assert.equal(factualIllustratedExplainer.available, false, "reviewed factual illustrated work must not be advertised as automatic production");
assert.deepEqual(
  factualIllustratedExplainer.preflight.recommendedModules.map((module) => module.block),
  ["editorial_evidence_packet"],
);
assert.equal(factualIllustratedExplainer.preflight.creatorAdmission.mode, "registered_supervised_non_gemini");
assert.equal(factualIllustratedExplainer.preflight.creatorAdmission.reviewHref, "/editorial-evidence");
assert(
  factualIllustratedExplainer.preflight.runtimeBlockers.some((blocker) => blocker.includes("does not authorize automatic production")),
  "creator-level private-review admission must be a production-readiness blocker, not merely display metadata",
);

// These are additional uses of the existing supervised Casefile evidence chain,
// not new automatic channel types or renderer claims.
for (const concept of [
  "An engineering systems failure investigation",
  "A historical aviation disaster investigation",
  "A financial fraud documentary investigation",
  "A company scandal investigation",
]) {
  const recommendation = recommendFormatDeterministically({ concept });
  assert.equal(recommendation.family, "cinematic", `${concept} must discover the cinematic Casefile intake`);
  assert.equal(
    recommendation.preflight.creativeCapabilities.some((offer) => offer.capability === "casefile_cinematic"),
    true,
    `${concept} must retain source-reviewed Casefile admission rather than a generic automatic route`,
  );
  assert.equal(recommendation.preflight.productionReady, false);
}

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
assert.equal(
  cinematic.planning.ready,
  true,
  "the advisor must recognize the registered non-Gemini cinematic planner while keeping runtime qualification separate",
);
assert.equal(cinematic.runtime.ready, false, "the advisor must expose the unattested LTX runtime rather than hiding it behind a generic label");
assert(
  cinematic.runtime.blockers.some((blocker) => blocker.includes("ltx_2_5_revision_not_benchmarked_on_rtx_4090")),
  "the current Novita/LTX preflight must be reported from the real runtime assessment",
);
assert.equal(cinematic.contentLane, "cinematic_ai");
assert.deepEqual(
  cinematic.requiredRendererChains,
  [
    ["novita_render_images", "qa_assets", "novita_render_video", "qa_shots"],
    ["gen_footage"],
  ],
  "the advisor must show every complete actual cinematic renderer path, not only shared assembly/QA modules",
);
assert.deepEqual(
  cinematic.rendererChainGuards,
  [{ whenPresent: ["gen_footage"], requires: ["cinematic_case_sequence"] }],
  "the creator must see that the Casefile renderer cannot be selected without its source-bound sequence admission",
);
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
assert.equal(
  casefileCinematic.preflight.creatorAdmission.mode,
  "registered_supervised_non_gemini",
  "a factual Casefile recommendation must expose its real private-review admission instead of a fake automatic route",
);
assert.equal(casefileCinematic.preflight.creatorAdmission.selectable, true);
assert.equal(casefileCinematic.preflight.creatorAdmission.autonomous, false);
assert.equal(casefileCinematic.preflight.creatorAdmission.privateReviewOnly, true);
assert.equal(casefileCinematic.preflight.creatorAdmission.reviewHref, "/casefile");
assert(
  casefileCinematic.preflight.runtimeBlockers.some((blocker) => blocker.includes("does not authorize automatic production")),
  "the final preflight blocker list must preserve the Casefile creator admission",
);
assert.equal(
  casefileCinematic.preflight.productionReady,
  false,
  "a selectable supervised intake must never promote the Casefile family to automatic production",
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
assert.equal(
  fictionalCinematic.creatorAdmission.mode,
  "registered_non_gemini",
  "a fictional cinematic concept may use the shared channel foundation without inheriting Casefile evidence authority",
);
assert.equal(
  fictionalCinematic.sourceRequirements.includes("source-first Case Packet"),
  false,
  "the Casefile registration must not leak onto unrelated fictional cinematic concepts",
);

const childrenShow = recommendFormatDeterministically({
  concept: "An original animated preschool kids show with gentle participation and a bedtime story rhythm",
});
assert.equal(childrenShow.family, "children_learning", "children’s-show language must discover the supervised show lane rather than generic narration");
assert.equal(childrenShow.available, false, "a children’s show must never be advertised as autonomous production");
assert.deepEqual(
  childrenShow.preflight.recommendedModules.map((module) => module.block),
  ["children_show_bible"],
  "the creator must surface the actual original-world/curriculum admission module for children’s content",
);
assert.equal(childrenShow.preflight.moduleAdmissions[0]?.autonomous, false);
assert.equal(childrenShow.preflight.creatorAdmission.mode, "registered_supervised_non_gemini");
assert.equal(childrenShow.preflight.creatorAdmission.selectable, true);
assert.equal(childrenShow.preflight.creatorAdmission.autonomous, false);
assert.equal(childrenShow.preflight.creatorAdmission.privateReviewOnly, true);
assert.equal(
  childrenShow.preflight.productionReady,
  false,
  "a selectable children Show Bible intake must never change automatic production readiness",
);
assert(
  childrenShow.preflight.missingRequirements.some((requirement) => requirement.includes("age-banded original Children’s Show Bible")),
  "children’s format advice must name its age/curriculum/editorial evidence before any automation claim",
);

// The creator can receive a neutral concept whose decisive format information
// is the declared audience or sample episodes. Those fields must genuinely
// influence deterministic classification rather than becoming detached UI copy.
const neutralAnimatedBedtimeConcept = "Original animated bedtime stories";
const unqualifiedBedtimeStories = recommendFormatDeterministically({
  concept: neutralAnimatedBedtimeConcept,
});
assert.equal(
  unqualifiedBedtimeStories.family,
  "narrated_stock",
  "without age or sample-topic context a neutral animated-story concept has no children-lane signal",
);
const audienceBoundChildrenShow = recommendFormatDeterministically({
  concept: neutralAnimatedBedtimeConcept,
  audience: "Preschool children ages 3 to 5",
  sampleTopics: ["A gentle toddler learning adventure"],
});
assert.equal(
  audienceBoundChildrenShow.family,
  "children_learning",
  "audience and sample topics must select the child-safe supervised lane when they carry the decisive intent",
);
assert.equal(audienceBoundChildrenShow.available, false);
assert.equal(
  audienceBoundChildrenShow.preflight.creativeCapabilities.some((offer) => offer.capability === "children_show_bible"),
  true,
  "audience-led child intent must retain the Show Bible admission instead of silently creating a narrated channel",
);

const blockedLofi = recommendFormatDeterministically({ concept: "Lo-fi study beats over a seamless animated loop" });
assert.equal(blockedLofi.family, "music_loop", "the advisor must preserve the actual requested format");
assert.equal(blockedLofi.available, false, "a blocked renderer must not become a fake production recommendation");
assert.match(blockedLofi.reasoning, /no unrelated channel was substituted/i);
assert.deepEqual(
  blockedLofi.executableAlternatives,
  [],
  "a blocked lane without an audited automatic adaptation must not receive an unrelated runnable option",
);
assert.equal(
  blockedLofi.alternates.some((alternate) => alternate.family === "quizyear"),
  false,
  "a runnable but zero-signal QuizYear route is not an honest alternate to a blocked music channel",
);

const blockedCinematicRecommendation = recommendFormatDeterministically({
  concept: "Cinematic true-crime reconstruction mini films",
});
assert.equal(blockedCinematicRecommendation.family, "cinematic");
assert.equal(blockedCinematicRecommendation.available, false);
assert.deepEqual(
  blockedCinematicRecommendation.executableAlternatives.map((alternate) => alternate.family),
  ["illustrated_explainer", "narrated_stock"],
  "the creator should receive only explicit automatic adaptations when cinematic production is blocked",
);
for (const alternate of blockedCinematicRecommendation.executableAlternatives) {
  assert.equal(alternate.selectable, true);
  assert.equal(alternate.executable, true);
  assert.equal(alternate.certifiedFamilyAdmission.automatic, true);
  assert.equal(
    formatPreflight(alternate.family, { concept: "Cinematic true-crime reconstruction mini films" }).productionReady,
    true,
    `${alternate.family} must pass its own exact creator preflight before it is offered as executable`,
  );
}

const blockedComicRecommendation = recommendFormatDeterministically({
  concept: "Illustrated graphic-novel history channel with motion-comic panels",
});
assert.equal(blockedComicRecommendation.family, "comic");
assert.equal(blockedComicRecommendation.available, false);
assert.deepEqual(
  blockedComicRecommendation.executableAlternatives.map((alternate) => alternate.family),
  ["narrated_stock"],
  "a factual comic-history request must not silently bypass source provenance; its factual adaptation remains deliberate",
);
assert.equal(
  formatPreflight("comic", { concept: "Illustrated graphic-novel history channel with motion-comic panels" }).productionReady,
  false,
  "creator preflight must refuse factual comic claims until their source evidence route exists",
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

// The creator UI receives an evidence-bearing planning contract, not merely a
// green availability bit. Every admitted reusable foundation must identify the
// no-Gemini planner that makes its automatic creation claim possible.
for (const family of ["narrated_stock", "sleep", "shorts", "quizyear", "illustrated_explainer"] as const) {
  const preflight = formatPreflight(family, { concept: "" });
  assert.equal(preflight.productionReady, true, `${family} must remain truthfully admitted before the creator advertises it`);
  assert.equal(preflight.planning.mode, "registered_non_gemini");
  assert.ok(preflight.planning.capabilityId, `${family} must name its planning capability`);
  assert.ok(preflight.planning.plannerBlock, `${family} must name its planner block`);
  assert.ok(preflight.planning.provenance, `${family} must carry creator-visible planning provenance`);
}

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

const creatorSource = readFileSync(join(process.cwd(), "src/app/(app)/channels/new/page.tsx"), "utf8");
assert(
  creatorSource.includes("registered_supervised_non_gemini"),
  "the creator must receive the explicit supervised admission state rather than treating every blocked route alike",
);
assert(
  creatorSource.includes("Private review package required") && creatorSource.includes("Open private review desk"),
  "a selectable supervised route must lead to its real review intake or remain blocked; it must not dispatch the automatic builder",
);
assert(
  creatorSource.includes("Private-review intake only: no setup spend, validation render, YouTube creation, publishing, cross-posting, or production budget can be authorized here.") &&
    creatorSource.includes("setApproveSetupSpend(false)") &&
    creatorSource.includes("setRunProbe(false)") &&
    creatorSource.includes("setAutoYoutube(false)") &&
    creatorSource.includes('setPublishMode("draft")') &&
    creatorSource.includes("setApprovedForPublish(false)") &&
    creatorSource.includes("crosspost: false"),
  "switching from an autonomous build to a supervised intake must clear retained spend, render, YouTube, publication, and cross-post authorities",
);
assert(
  creatorSource.includes("Registered private-review stages") &&
    creatorSource.includes("supervisedAdmission ? activeReviewOnlyStages : preview") &&
    creatorSource.includes('!supervisedAdmission && (publishMode !== "draft" || toggles.crosspost)'),
  "a private-review family must expose only its registered review stages and cannot present publishing approval as an executable build",
);
assert(
  creatorSource.includes("Certified automatic alternatives") &&
    creatorSource.includes("certifiedExecutableFormatAlternatives") &&
    creatorSource.includes("automaticFamilyCreatorReadiness(alternative.family).ready") &&
    creatorSource.includes("nothing was substituted automatically"),
  "a blocked recommendation must retain its identity while presenting only rechecked production-and-certified automatic alternatives as deliberate UI actions",
);

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
