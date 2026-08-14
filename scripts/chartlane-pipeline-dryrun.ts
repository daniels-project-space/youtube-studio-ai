/**
 * chartlane-pipeline-dryrun — full COMPILE + VALIDATE pass for BOTH chart families.
 *
 *   ./node_modules/.bin/tsx scripts/chartlane-pipeline-dryrun.ts
 *
 * Structural twin of scripts/quizyear-pipeline-dryrun.ts, extended to the case
 * that makes this lane different: TWO families that share ONE renderer. The
 * interesting failure mode is not "does datachart compile" but "do the two
 * compile to genuinely different pipelines that nevertheless converge on the
 * same chart_render module" — and, because both are narrated, that the
 * designer/compiler honour the lane's forbiddenBlocks instead of auto-inserting
 * story_spine and visual_inserts back in.
 *
 * DRY RUN in the strict sense: it calls the real compiler entry point with real
 * catalog data, but executes NO block. No Convex read/write, no channel row, no
 * provider call, no ffmpeg, no Remotion, no spend, no Wikidata request.
 *
 * Exits non-zero on the first failed assertion.
 */
import assert from "node:assert/strict";
import { designPipeline } from "@/engine/designer";
import { FAMILIES, type FamilyKey } from "@/engine/families";
import { CONTENT_LANE_POLICIES, type ContentLaneKey } from "@/engine/contentLane";

/** Renderers that must never co-exist with chart_render (one renderer per video). */
const SIBLING_RENDERERS = [
  "stock_footage",
  "gen_footage",
  "novita_render_images",
  "novita_render_video",
  "whiteboard_scribe",
  "motion_comic",
  "lore_short",
  "quiz_year",
  "documotion_short",
];

/**
 * Blocks the lane forbids and that the designer/compiler would OTHERWISE insert
 * on their own for any narrated family. This is the regression that matters:
 * both insertion points had to learn to read the lane, and a future edit to
 * either one would silently reintroduce paid work nothing reads.
 */
const AUTO_INSERTED_BUT_FORBIDDEN = ["story_spine", "visual_inserts"];

interface Case {
  family: FamilyKey;
  lane: ContentLaneKey;
  producer: string;
  lengthMinutes: number;
}

const CASES: Case[] = [
  { family: "datachart", lane: "data_chart", producer: "rank_data", lengthMinutes: 3 },
  { family: "simstory", lane: "sim_story", producer: "sim_narrative", lengthMinutes: 4 },
];

function runCase(testCase: Case): { blocks: string[]; reserved: number; fingerprint: string } {
  const family = FAMILIES[testCase.family];
  assert.ok(family, `${testCase.family} family must exist`);

  const design = designPipeline({
    family: testCase.family,
    nicheKey: "history",
    lengthMinutes: testCase.lengthMinutes,
    publishMode: "draft",
    toggles: { shorts: false, crosspost: false },
  });
  const blocks = design.pipeline.map((entry) => entry.block);

  /* 1 — shippable, not a draft-only stub */
  assert.equal(design.available, true, `${testCase.family} must compile as BUILDABLE`);
  assert.deepEqual(design.warnings, [], `${testCase.family} must raise no designer warnings`);

  /* 2 — lane identity is self-consistent end to end */
  assert.equal(design.contentLane.family, testCase.family);
  assert.equal(design.contentLane.key, testCase.lane);
  assert.equal(design.contentLane.primaryRenderer, "chart_render");
  assert.equal(design.contentLane.primaryRenderer, family.visualEngine);

  /* 3 — exactly one renderer, exactly one producer */
  assert.equal(blocks.filter((b) => b === "chart_render").length, 1, "the renderer must appear exactly once");
  assert.equal(blocks.filter((b) => b === testCase.producer).length, 1, "the producer must appear exactly once");
  for (const sibling of SIBLING_RENDERERS) {
    assert.ok(!blocks.includes(sibling), `must not carry sibling renderer ${sibling}`);
  }

  /* 4 — the producer runs BEFORE the renderer (a spec cannot be drawn before it exists) */
  assert.ok(
    blocks.indexOf(testCase.producer) < blocks.indexOf("chart_render"),
    "the ChartSpec producer must precede the renderer",
  );

  /* 5 — the lane's forbidden auto-inserts stayed out */
  for (const forbidden of AUTO_INSERTED_BUT_FORBIDDEN) {
    assert.ok(
      !blocks.includes(forbidden),
      `${forbidden} was auto-inserted back into ${testCase.family} despite the lane forbidding it: ${blocks.join(" -> ")}`,
    );
  }

  /* 6 — every block the lane demands is present */
  const lane = CONTENT_LANE_POLICIES[testCase.lane];
  for (const required of lane.requiredBlocks) {
    assert.ok(blocks.includes(required), `lane requires ${required}, which did not compile in`);
  }
  for (const forbidden of lane.forbiddenBlocks ?? []) {
    assert.ok(!blocks.includes(forbidden), `lane forbids ${forbidden}, which compiled in anyway`);
  }

  /* 7 — narration is the SHARED module, not a private copy inside the engine */
  assert.ok(blocks.includes("narration_tts"), "the chart lane reuses the shared voice module");
  assert.ok(blocks.includes("qa_visual") && blocks.includes("thumbnail_gen"), "shared QA/packaging must be present");

  /* 8 — the compilation exists and is complete */
  const compilation = design.compilation;
  assert.ok(compilation, "a buildable family must return a compilation");
  assert.equal(compilation.modules.length, design.pipeline.length);
  assert.equal(compilation.catalogFlow.length, design.pipeline.length);
  assert.match(compilation.fingerprint, /^[0-9a-f]{64}$/);
  assert.ok(compilation.capabilities.length > 0);

  /* 9 — the budget contract */
  const envelope = family.defaultRunBudgetUsd;
  if (envelope === undefined) {
    throw new Error(`${testCase.family} must declare a defaultRunBudgetUsd envelope`);
  }
  assert.ok(compilation.reservedMaxCostUsd > 0, "a reservation of 0 would mean nothing was priced");
  assert.ok(
    compilation.reservedMaxCostUsd <= envelope,
    `reserved $${compilation.reservedMaxCostUsd} exceeds the $${envelope} envelope`,
  );

  /* 10 — determinism: same inputs, same fingerprint and same order */
  const again = designPipeline({
    family: testCase.family,
    nicheKey: "history",
    lengthMinutes: testCase.lengthMinutes,
    publishMode: "draft",
    toggles: { shorts: false, crosspost: false },
  });
  assert.equal(again.compilation?.fingerprint, compilation.fingerprint, "fingerprints must be deterministic");
  assert.deepEqual(again.pipeline.map((entry) => entry.block), blocks, "block order must be deterministic");

  console.log(`\nfamily            ${testCase.family} (${family.label})`);
  console.log(`lane              ${design.contentLane.key} → renderer ${design.contentLane.primaryRenderer}`);
  console.log(`blocks (${String(design.pipeline.length).padStart(2)})       ${blocks.join(" -> ")}`);
  console.log(`fingerprint       ${compilation.fingerprint}`);
  console.log(`reserved cost     $${compilation.reservedMaxCostUsd.toFixed(4)} (family envelope $${envelope})`);
  console.log(`capabilities      ${compilation.capabilities.length}`);
  console.log(`designer warnings ${design.warnings.length}`);

  return { blocks, reserved: compilation.reservedMaxCostUsd, fingerprint: compilation.fingerprint };
}

function main(): void {
  const results = CASES.map((testCase) => [testCase, runCase(testCase)] as const);

  /* the two families must be genuinely DIFFERENT pipelines... */
  const [dataChart, simStory] = results;
  assert.notEqual(
    dataChart[1].fingerprint,
    simStory[1].fingerprint,
    "two families sharing a renderer must still compile to distinct pipelines",
  );
  assert.ok(dataChart[1].blocks.includes("script_gen"), "the ranking family writes with the shared script module");
  assert.ok(
    !simStory[1].blocks.includes("script_gen"),
    "the simulation family's authoring block IS its script — running both would write the story twice",
  );

  /* ...that nevertheless converge on ONE renderer */
  for (const [, result] of results) {
    assert.ok(result.blocks.includes("chart_render"), "both families must render through the same module");
  }

  /* the cheapest-family claim, verified rather than asserted */
  const quiz = designPipeline({ family: "quizyear", nicheKey: "history", lengthMinutes: 3, publishMode: "draft" });
  const quizReserved = quiz.compilation?.reservedMaxCostUsd ?? 0;
  assert.ok(
    dataChart[1].reserved < quizReserved,
    `datachart ($${dataChart[1].reserved.toFixed(4)}) must reserve less than quizyear ($${quizReserved.toFixed(4)})`,
  );

  console.log(
    `\ncheapest check    datachart $${dataChart[1].reserved.toFixed(4)} < quizyear $${quizReserved.toFixed(4)}`,
  );
  console.log("\nchartlane-pipeline-dryrun: design → validate → compile passed for both families with zero throws");
}

main();
