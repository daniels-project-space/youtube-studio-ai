/**
 * quizyear-pipeline-dryrun — full COMPILE + VALIDATE pass for the quiz family.
 *
 *   ./node_modules/.bin/tsx scripts/quizyear-pipeline-dryrun.ts
 *
 * The quiz golden module was verified by unit tests, wiring locks and real
 * still-frame renders, but never by the one pass a real channel actually makes
 * first: designPipeline() → archetype expansion → lane injection →
 * validatePipeline() → compilePipeline(). This harness runs exactly that pass
 * and asserts the result is structurally sound.
 *
 * DRY RUN in the strict sense: it calls the real compiler entry point with real
 * catalog data, but executes NO block. No Convex read/write, no channel row, no
 * provider call, no ffmpeg, no Remotion, no spend. Same class of check as
 * scripts/assembly-parity.ts.
 *
 * Exits non-zero on the first failed assertion.
 */
import assert from "node:assert/strict";
import { designPipeline } from "@/engine/designer";
import { FAMILIES } from "@/engine/families";
import { CONTENT_LANE_POLICIES } from "@/engine/contentLane";

const FAMILY = "quizyear" as const;

/** Renderers that must never co-exist with quiz_year (one renderer per video). */
const SIBLING_RENDERERS = [
  "stock_footage",
  "gen_footage",
  "novita_render_images",
  "novita_render_video",
  "whiteboard_scribe",
  "motion_comic",
  "lore_short",
  "documotion_short",
];

/** A silent format must never compile a spoken/scripted path. */
const SPEECH_BLOCKS = ["script_gen", "narration_tts", "timeline_assemble", "assemble"];

function main(): void {
  const family = FAMILIES[FAMILY];
  assert.ok(family, `${FAMILY} family must exist`);

  /* ---- the pass a real channel makes at inception ---- */
  const design = designPipeline({
    family: FAMILY,
    nicheKey: "history",
    lengthMinutes: 3,
    publishMode: "draft",
    toggles: { shorts: false, crosspost: false },
  });

  const blocks = design.pipeline.map((e) => e.block);

  /* 1 — the design itself is shippable, not a draft-only stub */
  assert.equal(design.available, true, "quizyear must compile as BUILDABLE, not a draft");
  assert.deepEqual(design.warnings, [], "a clean quiz design must raise no designer warnings");
  assert.ok(design.pipeline.length > 0, "pipeline must not be empty");

  /* 2 — lane identity is self-consistent end to end */
  assert.equal(design.contentLane.family, FAMILY);
  assert.equal(design.contentLane.key, "quiz_year");
  assert.equal(design.contentLane.primaryRenderer, "quiz_year");
  assert.equal(design.contentLane.primaryRenderer, family.visualEngine);

  /* 3 — exactly one renderer, and it is the quiz engine */
  assert.equal(
    blocks.filter((b) => b === "quiz_year").length,
    1,
    "the quiz engine must appear exactly once",
  );
  for (const sibling of SIBLING_RENDERERS) {
    assert.ok(!blocks.includes(sibling), `compiled pipeline must not carry sibling renderer ${sibling}`);
  }
  for (const spoken of SPEECH_BLOCKS) {
    assert.ok(!blocks.includes(spoken), `a silent format must not compile ${spoken}`);
  }

  /* 4 — every block the lane demands is actually present */
  const lane = CONTENT_LANE_POLICIES.quiz_year;
  assert.ok(lane, "quiz_year lane policy must exist");
  for (const required of lane.requiredBlocks) {
    assert.ok(blocks.includes(required), `lane requires block ${required}, which did not compile in`);
  }

  /* 5 — the compilation exists and is complete */
  const c = design.compilation;
  assert.ok(c, "designPipeline must return a compilation for a buildable family");
  assert.equal(
    c.modules.length,
    design.pipeline.length,
    "every pipeline entry must resolve to a compiled module record",
  );
  assert.equal(
    c.catalogFlow.length,
    design.pipeline.length,
    "every pipeline entry must map to a catalog execution step",
  );
  assert.match(c.fingerprint, /^[0-9a-f]{64}$/, "fingerprint must be a sha256 hex digest");
  assert.ok(c.capabilities.length > 0, "the compilation must declare capabilities");

  /* 6 — the budget contract: the reservation must fit the family envelope */
  assert.ok(
    c.reservedMaxCostUsd > 0,
    "a reservation of 0 would mean the compiler priced nothing at all",
  );
  const envelope = family.defaultRunBudgetUsd;
  if (envelope === undefined) {
    throw new Error(`${FAMILY} must declare a defaultRunBudgetUsd envelope to bound a run`);
  }
  assert.ok(
    c.reservedMaxCostUsd <= envelope,
    `reserved $${c.reservedMaxCostUsd} exceeds the family budget envelope $${envelope}`,
  );

  /* 7 — no capability is claimed that this silent format cannot deliver */
  for (const cap of c.capabilities) {
    assert.ok(!cap.startsWith("narration."), `a silent format must not claim capability ${cap}`);
  }

  /* 8 — determinism: recompiling the same inputs must reproduce the fingerprint.
     A drifting fingerprint would break resume/replay and spend reservation. */
  const again = designPipeline({
    family: FAMILY,
    nicheKey: "history",
    lengthMinutes: 3,
    publishMode: "draft",
    toggles: { shorts: false, crosspost: false },
  });
  assert.equal(
    again.compilation?.fingerprint,
    c.fingerprint,
    "the same design inputs must compile to the same fingerprint",
  );
  assert.deepEqual(again.pipeline.map((e) => e.block), blocks, "block order must be deterministic");

  /* ---- report ---- */
  console.log(`family            ${FAMILY} (${family.label})`);
  console.log(`available         ${design.available}`);
  console.log(`lane              ${design.contentLane.key} → renderer ${design.contentLane.primaryRenderer}`);
  console.log(`blocks (${String(design.pipeline.length).padStart(2)})       ${blocks.join(" -> ")}`);
  console.log(`policy            ${c.policyId} ${c.policyVersion}`);
  console.log(`fingerprint       ${c.fingerprint}`);
  console.log(`modules           ${c.modules.length}  catalogFlow ${c.catalogFlow.length}`);
  console.log(`reserved cost     $${c.reservedMaxCostUsd.toFixed(3)} (family envelope $${envelope})`);
  console.log(`capabilities      ${c.capabilities.length}`);
  console.log(`designer warnings ${design.warnings.length}`);
  // The compiler's "migration artifact schema" notes are a CODEBASE-WIDE
  // baseline (every family carries them for shared blocks like cleanup /
  // metadata / notify), not a quiz defect — surfaced as a count, not a failure.
  console.log(`compiler notes    ${c.warnings.length} (migration-artifact baseline, shared by all families)`);
  console.log("\nquizyear-pipeline-dryrun: design → validate → compile passed with zero throws");
}

main();
