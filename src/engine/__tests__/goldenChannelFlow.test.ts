import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registerAllBlocks } from "@/engine/blocks";
import { buildChannelFlowExport, renderChannelFlowMarkdown, type ChannelFlowSource } from "@/engine/channelFlowExport";
import { CERTIFIED_CHANNEL_PROGRAM_ROUTE_DEFINITIONS } from "@/engine/channelProgramRoute";
import {
  CATALOG_EXECUTION_BINDINGS,
  NOVITA_GPU_VIDEO_RENDER_BINDING,
  assertNovitaVideoRenderBinding,
  assessNovitaVideoRenderBinding,
  catalogExecutionBinding,
  compileCatalogExecutionFlow,
  compileGoldenExecutionFlow,
  hasCatalogExecutableOwner,
  REFERENCE_EXECUTABLE_PROVENANCE,
} from "@/engine/goldenExecution";
import { GOLDEN_MODULES, GOLDEN_SPINE } from "@/engine/golden";
import { allManifests, getManifest } from "@/engine/registry";

function channel(name: string, slug: string, blocks: readonly string[]): ChannelFlowSource {
  return {
    id: `production-fixture:${slug}`,
    name,
    slug,
    status: "production-fixture",
    pipeline: blocks.map((block) => ({ block })),
  };
}

// Sanitized read-only snapshots of materially different production channel
// rows captured on 2026-08-06. They deliberately retain legacy entries so the
// test covers the exact compatibility boundary used by the live compiler.
const PRODUCTION_CHANNELS = {
  lofi: channel("Rainy Neon Lofi", "rainy-neon-lofi-1780273017590", [
    "competitor_research", "topic_select", "scene_planner", "keyframes", "loop_clips", "upscale",
    "music", "metadata", "intro_card", "assemble", "thumbnail_gen", "qa_visual", "upload_draft",
    "notify", "cleanup",
  ]),
  stoic: channel("Stoic Truths", "stoic-truths-1780681299779", [
    "competitor_research", "topic_select", "director_brief", "dp_brief", "editor_brief", "composer_brief",
    "critic_spec", "script_gen", "qa_script", "originality_gate", "compliance_check", "narration_tts",
    "stock_footage", "entity_imagery", "music", "intro_card", "quote_overlays", "timeline_assemble",
    "qa_refine", "length_check", "captions", "metadata", "thumbnail_gen", "qa_visual", "upload_draft",
    "notify", "emit_bundle", "cleanup",
  ]),
  investory: channel("Investory", "investory-1781107671769", [
    "competitor_research", "topic_select", "director_brief", "dp_brief", "editor_brief", "composer_brief",
    "critic_spec", "script_gen", "qa_script", "originality_gate", "compliance_check", "narration_tts",
    "stock_footage", "entity_imagery", "music", "intro_card", "quote_overlays", "visual_inserts",
    "timeline_assemble", "length_check", "captions", "metadata", "thumbnail_gen", "qa_visual",
    "upload_draft", "cleanup",
  ]),
  whiteboard: channel("Chalk & Compound", "chalk-compound-1783204937273", [
    "competitor_research", "topic_select", "director_brief", "editor_brief", "composer_brief", "critic_spec",
    "compliance_check", "music", "whiteboard_scribe", "originality_gate", "metadata", "thumbnail_gen",
    "qa_visual", "upload_draft", "notify", "cleanup",
  ]),
  comic: channel("Inked Histories", "inked-histories-1783204937695", [
    "competitor_research", "topic_select", "director_brief", "editor_brief", "critic_spec",
    "compliance_check", "motion_comic", "originality_gate", "metadata", "thumbnail_gen", "qa_visual",
    "upload_draft", "notify", "cleanup",
  ]),
  sleep: channel("Gratitude Springs", "gratitude-springs-1783204939314", [
    "topic_select", "dp_brief", "composer_brief", "critic_spec", "script_gen", "originality_gate",
    "compliance_check", "narration_tts", "stock_footage", "entity_imagery", "music", "intro_card",
    "timeline_assemble", "length_check", "captions", "metadata", "thumbnail_gen", "qa_visual",
    "upload_draft", "notify", "cleanup",
  ]),
} as const;

function catalogKeys(flow: ReturnType<typeof buildChannelFlowExport>): Set<string> {
  return new Set(flow.steps.map((step) => step.catalogKey));
}

function assertHas(keys: ReadonlySet<string>, expected: readonly string[]): void {
  for (const key of expected) assert(keys.has(key), `expected selected catalog module ${key}`);
}

function assertLacks(keys: ReadonlySet<string>, excluded: readonly string[]): void {
  for (const key of excluded) assert(!keys.has(key), `unexpected unrelated catalog module ${key}`);
}

function registryHasOneGoldenOwner(): void {
  registerAllBlocks();
  const manifests = allManifests();
  const owners = new Map<string, string>();
  for (const [catalogKey, binding] of Object.entries(CATALOG_EXECUTION_BINDINGS)) {
    if (!hasCatalogExecutableOwner(binding)) continue;
    for (const executableId of binding.executableIds) {
      assert(!owners.has(executableId), `${executableId} is multiply owned`);
      owners.set(executableId, catalogKey);
    }
  }
  assert.deepEqual(
    [...owners.keys()].sort(),
    manifests.map((manifest) => manifest.id).sort(),
    "every registered executable ABI must have exactly one catalog owner",
  );
  assert.deepEqual(
    [...new Set(GOLDEN_SPINE.flatMap((stage) => stage.blocks))].sort(),
    manifests.map((manifest) => manifest.id).sort(),
    "the catalog spine overview must contain every executable ABI and no retired/nonexistent steps",
  );
  const selfContainedStory = catalogExecutionBinding("self-contained-story");
  assert.equal(selfContainedStory.kind, "pipeline-module");
  assert.deepEqual(selfContainedStory.executableIds, ["self_contained_story_plan", "self_contained_story"]);
  assert.equal(
    GOLDEN_MODULES.find((module) => module.key === "self-contained-story")?.status,
    "active",
    "self-contained story must be visible as the active shared foundation for its certified routes",
  );
  const selfContainedRoutes = CERTIFIED_CHANNEL_PROGRAM_ROUTE_DEFINITIONS.filter(
    (definition) => definition.requiredBlocks.includes("self_contained_story"),
  );
  assert.deepEqual(
    selfContainedRoutes.map((definition) => definition.key),
    ["whiteboard/foundation/v1", "comic/foundation/v1", "loreshort/foundation/v1"],
    "only registered self-contained family routes may materialize the shared planner/seal pair",
  );
  assert(
    selfContainedRoutes.every((definition) => definition.requiredBlocks.includes("self_contained_story_plan")),
    "a self-contained renderer route may never retain the seal without its bounded native planner",
  );
  assert.equal(getManifest("qa_refine"), undefined, "retired qa_refine must not remain executable");
}

function dormantQuizShortReleaseIsNotAnActiveCreatorRoute(): void {
  const quizYear = GOLDEN_MODULES.find((module) => module.key === "quiz-year");
  const quizShortRelease = GOLDEN_MODULES.find((module) => module.key === "quiz-short-private-release");
  assert(quizYear && quizShortRelease, "QuizYear and its dormant private-release adjunct must have distinct catalog cards");
  assert.equal(quizYear.status, "active", "ordinary certified QuizYear remains an active executable format");
  assert.equal(
    catalogExecutionBinding("quiz-year").kind,
    "pipeline-module",
    "ordinary QuizYear remains a compiler-executable catalog binding",
  );
  assert(
    !catalogExecutionBinding("quiz-year").executableIds.includes("quiz_short_release"),
    "ordinary QuizYear must not inherit the dormant portrait release block",
  );
  const releaseBinding = catalogExecutionBinding("quiz-short-private-release");
  assert.equal(quizShortRelease.status, "registered");
  assert.equal(releaseBinding.kind, "registered-private-release");
  assert.deepEqual(releaseBinding.executableIds, ["quiz_short_release"]);
  assert.match(releaseBinding.note ?? "", /no owner-facing intake/i);
  assert(
    CERTIFIED_CHANNEL_PROGRAM_ROUTE_DEFINITIONS.every(
      (definition) => !definition.requiredBlocks.includes("quiz_short_release"),
    ),
    "no automatic certified route may admit the dormant private-release block",
  );
  const releaseManifest = getManifest("quiz_short_release");
  assert(releaseManifest, "the private-release block must remain registered for its future controlled use");
  const [releaseStep] = compileCatalogExecutionFlow([releaseManifest]);
  assert.equal(releaseStep.catalogKey, "quiz-short-private-release");
  assert.equal(releaseStep.catalogStatus, "registered");
  assert.equal(releaseStep.goldenQualified, false, "registered private-release infrastructure is never Golden-promoted");
  assert.throws(
    () => compileGoldenExecutionFlow([releaseManifest]),
    /quiz_short_release=catalog-mapped/,
    "the dormant block must not become a Golden executable through registry presence alone",
  );
  const goldenPage = readFileSync(join(process.cwd(), "src/app/(app)/golden/page.tsx"), "utf8");
  assert.match(
    goldenPage,
    /REGISTERED PRIVATE-RELEASE BLOCK[\s\S]*?NO OWNER INTAKE[\s\S]*?NOT ROUTE-EXECUTABLE/,
    "the Golden card must not describe the dormant block as an executable route",
  );
}

function packageOpeningProofIsAVisibleSeparateModule(): void {
  const packageOpening = GOLDEN_MODULES.find((module) => module.key === "package-opening-proof");
  assert(packageOpening, "package/opening evidence must have its own Golden catalog card");
  assert.equal(packageOpening.status, "reference", "a structural evidence guard is not a visual Golden promotion receipt");
  assert.match(packageOpening.how, /structural evidence/i);
  assert.match(packageOpening.how, /not pretend to infer semantic equivalence/i);

  const binding = catalogExecutionBinding("package-opening-proof");
  assert.equal(binding.kind, "pipeline-module");
  assert.deepEqual(binding.executableIds, ["package_to_opening_plan"]);
  assert.deepEqual(
    catalogExecutionBinding("thumbnail").executableIds,
    ["thumbnail_gen"],
    "cover generation and package/opening verification must be separately visible module owners",
  );

  const [step] = compileCatalogExecutionFlow(manifests(["package_to_opening_plan"]));
  assert.equal(step.catalogKey, "package-opening-proof");
  assert.equal(step.qualification, "reference-executable");
  assert.equal(step.goldenQualified, false, "a structural contract is not a visual Golden promotion receipt");

  const goldenPage = readFileSync(join(process.cwd(), "src/app/(app)/golden/page.tsx"), "utf8");
  assert.match(goldenPage, /case "package-opening-proof": return <PackageOpeningEvidenceStrip \/>;/);
  assert.match(goldenPage, /STRUCTURAL WITNESS · NOT A SEMANTIC JUDGE/);
}

function studioAssetLibraryIsAVisibleGatedCatalogSurface(): void {
  const studioAssets = GOLDEN_MODULES.find((module) => module.key === "studio-assets");
  assert(studioAssets, "the reusable Studio Asset Library must be visible in Golden");
  assert.equal(studioAssets.status, "registered", "a read-only control inventory is not a production promotion");
  assert.match(studioAssets.how, /owner.*channel.*series/i);
  assert.match(studioAssets.how, /IC-LoRA.*future dedicated Comfy/i);
  const binding = catalogExecutionBinding("studio-assets");
  assert.equal(binding.kind, "catalog-only", "the library card must not claim a second executable pipeline stage");
  assert.deepEqual(binding.executableIds, []);
}

function finalMasterStoryCoverageIsAVisibleSeparateModule(): void {
  const coverage = GOLDEN_MODULES.find((module) => module.key === "final-master-story-coverage");
  assert(coverage, "final-master story coverage must have its own Golden catalog card");
  assert.equal(coverage.status, "reference", "narration-semantic coverage is not a visual Golden promotion receipt");
  assert.match(coverage.how, /narration-semantic story delivery only/i);
  assert.match(coverage.how, /not that every planned shot was visually realized/i);

  const binding = catalogExecutionBinding("final-master-story-coverage");
  assert.equal(binding.kind, "pipeline-module");
  assert.deepEqual(binding.executableIds, ["qa_visual"]);
  assert(
    !catalogExecutionBinding("verify").executableIds.includes("qa_visual"),
    "the final-master certificate gate must be visually distinct from preliminary asset/shot checks",
  );

  const [step] = compileCatalogExecutionFlow(manifests(["qa_visual"]));
  assert.equal(step.catalogKey, "final-master-story-coverage");
  assert.equal(step.goldenQualified, false, "certificate evidence must not be displayed as a Golden visual promotion");

  const goldenPage = readFileSync(join(process.cwd(), "src/app/(app)/golden/page.tsx"), "utf8");
  assert.match(goldenPage, /case "final-master-story-coverage": return <NarratedStoryCoverageStrip \/>;/);
  assert.match(goldenPage, /NARRATION-SEMANTIC ONLY/);
  assert.match(goldenPage, /NOT VISUAL-SHOT PROOF/);
}

function manifests(ids: readonly string[]) {
  return ids.map((id) => {
    const manifest = getManifest(id);
    assert(manifest, `missing registered manifest ${id}`);
    return manifest;
  });
}

function approvedVideoRenderRouteIsExact(): void {
  const approved = manifests(NOVITA_GPU_VIDEO_RENDER_BINDING.requiredChain);
  const assessment = assessNovitaVideoRenderBinding(approved);
  assert.equal(assessment.required, true);
  assert.equal(assessment.compliant, true);
  assert.deepEqual(assessment.selectedProviderExecutables, ["novita_render_images", "novita_render_video"]);
  assert.deepEqual(assessment.violations, []);
  assert.doesNotThrow(() => assertNovitaVideoRenderBinding(approved));

  assert.throws(
    () => assertNovitaVideoRenderBinding(manifests(["novita_render_images", "novita_render_video"])),
    /required Novita render-chain module is missing: qa_assets/,
  );
  assert.throws(
    () => assertNovitaVideoRenderBinding(manifests(["loop_clips"])),
    /required specialized Novita render module is missing: keyframes/,
  );
  assert.throws(
    () => assertNovitaVideoRenderBinding(manifests(["keyframes"])),
    /required specialized Novita render module is missing: loop_clips/,
  );
  assert.doesNotThrow(() => assertNovitaVideoRenderBinding(manifests(["keyframes", "loop_clips"])));
  assert.doesNotThrow(() => assertNovitaVideoRenderBinding(manifests(["gen_footage"])));
  assert.doesNotThrow(() => assertNovitaVideoRenderBinding(manifests(["signature_clips"])));
}

function qualificationIsSourceBackedAndHonest(): void {
  registerAllBlocks();
  for (const [executableId, provenance] of Object.entries(REFERENCE_EXECUTABLE_PROVENANCE)) {
    const binding = catalogExecutionBinding(provenance.catalogKey);
    assert(binding.executableIds.includes(executableId), `${executableId}: provenance owner mismatch`);
    const caller = readFileSync(join(process.cwd(), provenance.callerFile), "utf8");
    const reference = readFileSync(join(process.cwd(), provenance.referenceFile), "utf8");
    const escaped = provenance.referenceSymbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert(
      new RegExp(`\\b${escaped}\\s*\\(`).test(caller),
      `${executableId}: caller does not invoke ${provenance.referenceSymbol}`,
    );
    assert(
      new RegExp(`\\b(?:function|const)\\s+${escaped}\\b`).test(reference),
      `${executableId}: reference symbol ${provenance.referenceSymbol} is missing`,
    );
  }

  const thumbnailFlow = compileCatalogExecutionFlow(manifests(["thumbnail_gen"]));
  assert.equal(thumbnailFlow[0].qualification, "reference-executable");
  assert.equal(thumbnailFlow[0].goldenQualified, false);
  assert.match(thumbnailFlow[0].qualificationBlockers.join("; "), /not an approved equivalence proof/);
  assert.throws(
    () => compileGoldenExecutionFlow(manifests(["thumbnail_gen"])),
    /not Golden-qualified: thumbnail_gen=reference-executable/,
  );

  const lofiFlow = compileCatalogExecutionFlow(manifests(["scene_planner", "keyframes", "loop_clips", "upscale", "assemble"]));
  assert(lofiFlow.every((step) => step.qualification === "catalog-mapped"));
  assert(lofiFlow.every((step) => step.goldenQualified === false));
  assert.equal(REFERENCE_EXECUTABLE_PROVENANCE["keyframes"], undefined);
  assert.equal(REFERENCE_EXECUTABLE_PROVENANCE["assemble"], undefined);
}

function realChannelsCompileMinimally(): void {
  const flows = Object.fromEntries(
    Object.entries(PRODUCTION_CHANNELS)
      .map(([key, source]) => [key, buildChannelFlowExport(source)]),
  ) as Record<keyof typeof PRODUCTION_CHANNELS, ReturnType<typeof buildChannelFlowExport>>;

  for (const flow of Object.values(flows)) {
    assert.deepEqual(
      flow.steps.map((step) => step.executableId),
      flow.effectiveBlocks,
      `${flow.channel.name}: catalog mapping must preserve the exact executable selection and order`,
    );
    assert.equal(flow.steps.length, flow.effectiveBlocks.length, "catalog routing must never inject all modules");
    for (const step of flow.steps) {
      const binding = catalogExecutionBinding(step.catalogKey);
      assert.equal(binding.kind, "pipeline-module");
      assert(binding.executableIds.includes(step.executableId));
      assert.notEqual(step.certification, "legacy");
      assert.notEqual(step.certification, "revoked");
      assert.equal(step.goldenQualified, step.qualification === "equivalence-proven");
    }
  }

  assert.equal(
    Object.values(flows).flatMap((flow) => flow.steps).filter((step) => step.goldenQualified).length,
    0,
    "empty promotion-proof registry means no selected step may be presented as Golden-qualified",
  );
  assert.equal(
    flows.whiteboard.steps.find((step) => step.executableId === "whiteboard_scribe")?.qualification,
    "reference-executable",
  );
  assert.equal(
    flows.comic.steps.find((step) => step.executableId === "motion_comic")?.qualification,
    "reference-executable",
  );
  assert.equal(
    flows.investory.steps.find((step) => step.executableId === "timeline_assemble")?.qualification,
    "catalog-mapped",
  );

  assertHas(catalogKeys(flows.investory), ["script", "narration", "visuals", "inserts", "assemble"]);
  assertLacks(catalogKeys(flows.investory), ["lofi", "whiteboard", "comic"]);

  assertHas(catalogKeys(flows.whiteboard), ["whiteboard", "music"]);
  assertLacks(catalogKeys(flows.whiteboard), ["script", "narration", "visuals", "lofi", "comic", "assemble"]);

  assertHas(catalogKeys(flows.comic), ["comic"]);
  assertLacks(catalogKeys(flows.comic), ["script", "narration", "visuals", "lofi", "whiteboard", "assemble", "music"]);

  assert(catalogKeys(flows.investory).has("inserts"), "finance channel selects data-viz inserts");
  assert(!catalogKeys(flows.stoic).has("inserts"), "non-data-viz channel does not inherit inserts");
  assert.deepEqual(flows.stoic.retiredLegacyBlocks, ["qa_refine"]);
  assert(!flows.stoic.effectiveBlocks.includes("qa_refine"));
  assert(flows.sleep.insertedPolicyBlocks.includes("qa_script"), "missing script gate is capability-completed");

  assert.equal(flows.lofi.videoRenderBinding.required, true);
  assert.equal(flows.lofi.videoRenderBinding.compliant, true);

  for (const flow of [flows.stoic, flows.investory, flows.whiteboard, flows.comic, flows.sleep]) {
    assert.equal(flow.videoRenderBinding.required, false);
    assert.equal(flow.videoRenderBinding.compliant, true);
  }

  const markdown = renderChannelFlowMarkdown([flows.investory]);
  assert(markdown.includes("Per-channel executable catalog flows"));
  assert(markdown.includes("Equivalence-proven (Golden-qualified) steps: 0/"));
  assert(markdown.includes("catalog-mapped"));
  assert(!markdown.includes("# Per-channel Golden execution flows"));
  assert(markdown.includes("Data-Viz Inserts"));
  assert(markdown.includes("visual_inserts"));
  assert(markdown.includes("Provider AI-video route"));
}

registryHasOneGoldenOwner();
dormantQuizShortReleaseIsNotAnActiveCreatorRoute();
packageOpeningProofIsAVisibleSeparateModule();
studioAssetLibraryIsAVisibleGatedCatalogSurface();
finalMasterStoryCoverageIsAVisibleSeparateModule();
approvedVideoRenderRouteIsExact();
qualificationIsSourceBackedAndHonest();
realChannelsCompileMinimally();
console.log("CATALOG FLOW + GOLDEN QUALIFICATION PASS");
