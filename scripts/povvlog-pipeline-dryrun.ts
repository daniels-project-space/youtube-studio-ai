/**
 * povvlog-pipeline-dryrun — full COMPILE + VALIDATE pass for the POV-character-vlog family.
 *
 *   ./node_modules/.bin/tsx scripts/povvlog-pipeline-dryrun.ts
 *
 * Structural twin of scripts/chartlane-pipeline-dryrun.ts, for the case where a
 * NEW family deliberately reuses an EXISTING family's renderer wholesale
 * (`novita_render_video`, the same one `cinematic` uses) rather than adding a
 * parallel render stack. The interesting failure mode here is not "does
 * povvlog compile" but "does it compile to the cinematic_ai lane's exact
 * shot-production spine, with only the three POV-specific writer blocks
 * (pov_vlog_script, fact_check, dialogue_scene) swapped in for the generic
 * ones (script_gen, hook_craft) it forbids" — and that its honest per-episode
 * cost arithmetic (documented as a comment in families.ts) is a real,
 * compiler-verified reservation, not merely a trusted comment.
 *
 * DRY RUN in the strict sense: it calls the real compiler entry point with real
 * catalog data, but executes NO block. No Convex read/write, no channel row, no
 * provider call, no ffmpeg, no Remotion, no spend, no Wikidata/Gemini request.
 *
 * Exits non-zero on the first failed assertion.
 */
import assert from "node:assert/strict";
import { designPipeline } from "@/engine/designer";
import { FAMILIES } from "@/engine/families";
import { CONTENT_LANE_POLICIES } from "@/engine/contentLane";

const FAMILY = "povvlog" as const;
const LANE = "pov_character_vlog" as const;

/** Renderers that must never co-exist with novita_render_video on this lane. */
const SIBLING_RENDERERS = [
  "stock_footage",
  "gen_footage",
  "loop_clips",
  "lore_short",
  "whiteboard_scribe",
  "motion_comic",
  "chart_render",
  "quiz_year",
];

/** The generic writer blocks this lane forbids, because it has its own. */
const FORBIDDEN_BLOCKS = ["script_gen", "hook_craft"];

function main(): void {
  const family = FAMILIES[FAMILY];
  assert.ok(family, `${FAMILY} family must exist`);
  assert.equal(family.visualEngine, "ai_scenes", "povvlog must declare the same visual engine label as cinematic");

  const design = designPipeline({
    family: FAMILY,
    nicheKey: "history",
    lengthMinutes: 8,
    publishMode: "draft",
    toggles: { shorts: false, crosspost: false },
  });
  const blocks = design.pipeline.map((entry) => entry.block);

  /* 1 — shippable, not a draft-only stub */
  assert.equal(design.available, true, `${FAMILY} must compile as BUILDABLE`);
  assert.deepEqual(design.warnings, [], `${FAMILY} must raise no designer warnings`);

  /* 2 — lane identity is self-consistent end to end */
  assert.equal(design.contentLane.family, FAMILY);
  assert.equal(design.contentLane.key, LANE);
  assert.equal(design.contentLane.primaryRenderer, "novita_render_video");

  /* 3 — exactly one of each renderer/producer block */
  for (const solo of ["novita_render_video", "novita_render_images", "pov_vlog_script", "dialogue_scene", "fact_check"]) {
    assert.equal(blocks.filter((b) => b === solo).length, 1, `${solo} must appear exactly once`);
  }
  for (const sibling of SIBLING_RENDERERS) {
    assert.ok(!blocks.includes(sibling), `must not carry sibling renderer ${sibling}`);
  }
  for (const forbidden of FORBIDDEN_BLOCKS) {
    assert.ok(!blocks.includes(forbidden), `${forbidden} was auto-inserted back in despite the lane forbidding it: ${blocks.join(" -> ")}`);
  }

  /* 4 — writers run BEFORE the shots they describe are produced */
  assert.ok(blocks.indexOf("pov_vlog_script") < blocks.indexOf("novita_render_images"), "the episode script must precede image generation");
  assert.ok(blocks.indexOf("dialogue_scene") < blocks.indexOf("novita_render_images"), "dialogue scenes must precede image generation");
  assert.ok(blocks.indexOf("fact_check") < blocks.indexOf("novita_render_images"), "facts must be verified before shots are spent generating them");
  assert.ok(blocks.indexOf("novita_render_images") < blocks.indexOf("novita_render_video"), "keyframes must exist before they are animated");

  /* 5 — every block the lane demands is present */
  const lane = CONTENT_LANE_POLICIES[LANE];
  for (const required of lane.requiredBlocks) {
    assert.ok(blocks.includes(required), `lane requires ${required}, which did not compile in`);
  }
  for (const forbidden of lane.forbiddenBlocks ?? []) {
    assert.ok(!blocks.includes(forbidden), `lane forbids ${forbidden}, which compiled in anyway`);
  }

  /* 6 — the compilation exists and is complete */
  const compilation = design.compilation;
  assert.ok(compilation, "a buildable family must return a compilation");
  assert.equal(compilation.modules.length, design.pipeline.length);
  assert.equal(compilation.catalogFlow.length, design.pipeline.length);
  assert.match(compilation.fingerprint, /^[0-9a-f]{64}$/);
  assert.ok(compilation.capabilities.length > 0);

  /* 7 — the budget contract, verified not trusted */
  const envelope = family.defaultRunBudgetUsd;
  if (envelope === undefined) {
    throw new Error(`${FAMILY} must declare a defaultRunBudgetUsd envelope`);
  }
  assert.ok(compilation.reservedMaxCostUsd > 0, "a reservation of 0 would mean nothing was priced");
  assert.ok(
    compilation.reservedMaxCostUsd <= envelope,
    `reserved $${compilation.reservedMaxCostUsd} exceeds the $${envelope} envelope`,
  );

  /* 8 — the families.ts comment's central claim: povvlog's reservation stays
   * at or under cinematic's, because the only difference is three cheap text
   * blocks swapped in for other cheap text blocks — never a second copy of
   * the paid shot chain. */
  // cinematic cannot even compile at povvlog's own 8-minute design point (it
  // throws past its own ~5-minute/50-shot ceiling, using the default 6s/shot
  // pacing) — so the honest comparison is at a length BOTH can compile: 5
  // minutes. povvlog's `story_spine` pins targetShotSec=10 (fewer, longer,
  // "vlogger talking" shots) versus cinematic's 6s default, so at the SAME
  // requested length povvlog must reserve less, purely from having fewer
  // shots on the identical per-shot cost shape — not from a discount.
  const cinematicAt5 = designPipeline({
    family: "cinematic",
    nicheKey: "history",
    lengthMinutes: 5,
    publishMode: "draft",
    toggles: { shorts: false, crosspost: false },
  });
  const povvlogAt5 = designPipeline({
    family: FAMILY,
    nicheKey: "history",
    lengthMinutes: 5,
    publishMode: "draft",
    toggles: { shorts: false, crosspost: false },
  });
  const cinematicReserved5 = cinematicAt5.compilation?.reservedMaxCostUsd ?? 0;
  const povvlogReserved5 = povvlogAt5.compilation?.reservedMaxCostUsd ?? 0;
  assert.ok(
    povvlogReserved5 < cinematicReserved5,
    `povvlog ($${povvlogReserved5.toFixed(4)}) must reserve less than cinematic ($${cinematicReserved5.toFixed(4)}) ` +
      `at the same 5-minute length — longer, fewer shots on the identical per-shot cost shape`,
  );

  /* 9 — determinism: same inputs, same fingerprint and same order */
  const again = designPipeline({
    family: FAMILY,
    nicheKey: "history",
    lengthMinutes: 8,
    publishMode: "draft",
    toggles: { shorts: false, crosspost: false },
  });
  assert.equal(again.compilation?.fingerprint, compilation.fingerprint, "fingerprints must be deterministic");
  assert.deepEqual(again.pipeline.map((entry) => entry.block), blocks, "block order must be deterministic");

  console.log(`\nfamily            ${FAMILY} (${family.label})`);
  console.log(`lane              ${design.contentLane.key} -> renderer ${design.contentLane.primaryRenderer}`);
  console.log(`blocks (${String(design.pipeline.length).padStart(2)})       ${blocks.join(" -> ")}`);
  console.log(`fingerprint       ${compilation.fingerprint}`);
  console.log(`reserved cost     $${compilation.reservedMaxCostUsd.toFixed(4)} (family envelope $${envelope})`);
  console.log(`cheaper @5min     povvlog $${povvlogReserved5.toFixed(4)} < cinematic $${cinematicReserved5.toFixed(4)} (fewer, longer shots)`);
  console.log(`capabilities      ${compilation.capabilities.length}`);
  console.log(`designer warnings ${design.warnings.length}`);
  console.log("\npovvlog-pipeline-dryrun: design -> validate -> compile passed with zero throws");
}

main();
