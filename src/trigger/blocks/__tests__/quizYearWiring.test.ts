/**
 * quiz_year wiring regression lock.
 *
 * The `quiz` catalog entry sat as "reference / NOT BUILDABLE" because all three
 * of its originally-envisioned sub-formats (trivia, flag-guess, music-guess)
 * were independently found unbuildable on licensing grounds. The guess-the-year
 * format is the one that survives, and this suite binds the properties that
 * make that claim true so none of them can silently regress:
 *
 *   1. the engine is REGISTERED and reachable from the pipeline
 *   2. the family / lane / archetype plumbing exists and is self-consistent
 *   3. NO paid media provider is on the path (that is the whole cost story)
 *   4. the lane forbids every sibling renderer (one renderer per video)
 *   5. the catalog entry claims exactly what is wired — no overclaim
 *   6. the Remotion bundle is genuinely ISOLATED from the shared root
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FAMILIES, FAMILY_CREW } from "@/engine/families";
import { ARCHETYPES } from "@/engine/archetypes";
import { CONTENT_LANE_POLICIES, CONTENT_LANE_BY_FAMILY, LANE_QUALITY_POLICIES } from "@/engine/contentLane";
import { MODULE_CONTRACTS } from "@/engine/moduleContracts";
import { GOLDEN_MODULES } from "@/engine/golden";
import { CATALOG_EXECUTION_BINDINGS } from "@/engine/goldenExecution";
import { quizRoundCount, quizSetDefects, resolveTopic, quizYearBlocks } from "../quizYearBlocks";
import { wikidataSourceUrl, type QuizYearQuestion } from "@/lib/quizYearFacts";

const ROOT = join(__dirname, "../../../..");

async function main(): Promise<void> {
  /* 1 — the block exists and declares the right shape */
  assert.equal(quizYearBlocks.length, 1);
  const block = quizYearBlocks[0];
  assert.equal(block.id, "quiz_year");
  assert.equal(block.paid, true, "the block spends real (if small) money and must be preflighted");
  assert.ok(block.produces.includes("videoKey"), "self-contained engines emit the final video");
  assert.ok(block.produces.includes("videoDurationSec"));

  /* 2 — family / lane / archetype plumbing */
  const family = FAMILIES.quizyear;
  assert.ok(family, "quizyear family must exist");
  assert.equal(family.visualEngine, "quiz_year");
  assert.equal(family.archetypeKey, "quiz-year");
  assert.equal(family.narrated, false, "nobody speaks in this format");
  assert.equal(CONTENT_LANE_BY_FAMILY.quizyear, "quiz_year");
  assert.ok(FAMILY_CREW.quizyear.includes("critic"), "wording is the only creative surface — the critic matters");
  assert.ok(
    !FAMILY_CREW.quizyear.includes("composer"),
    "no score is bedded, so a composer brief would be a paid call nothing reads",
  );

  const archetype = ARCHETYPES["quiz-year"];
  assert.ok(archetype, "quiz-year archetype must exist");
  const blocks = archetype.pipeline.map((p) => p.block);
  assert.ok(blocks.includes("quiz_year"), "the archetype must actually run the engine");
  assert.ok(blocks.includes("compliance_check"), "compliance gates before the engine runs");
  for (const forbidden of ["script_gen", "narration_tts", "timeline_assemble", "assemble"]) {
    assert.ok(!blocks.includes(forbidden), `self-contained engine must not chain ${forbidden}`);
  }

  const lane = CONTENT_LANE_POLICIES.quiz_year;
  assert.ok(lane, "quiz_year lane must exist");
  assert.equal(lane.primaryRenderer, "quiz_year");
  assert.ok(lane.requiredBlocks.includes("quiz_year"));
  // 4 — exactly one renderer per video.
  for (const sibling of [
    "stock_footage",
    "gen_footage",
    "novita_render_images",
    "novita_render_video",
    "whiteboard_scribe",
    "motion_comic",
    "lore_short",
  ]) {
    assert.ok(
      lane.forbiddenRendererBlocks.includes(sibling),
      `lane must forbid the sibling renderer ${sibling}`,
    );
  }
  assert.ok(LANE_QUALITY_POLICIES.quiz_year, "the lane needs a quality calibration");

  /* 3 — the cost story: NO paid media provider anywhere on the path */
  const source = await readFile(join(ROOT, "src/trigger/blocks/quizYearBlocks.ts"), "utf8");
  for (const banned of [
    "novitaRenderFarm",
    "novitaMedia",
    "generateI2V",
    "synthNarration",
    "replicate",
    "elevenlabs",
    "falImage",
    "musicTrack",
  ]) {
    assert.ok(
      !source.includes(banned),
      `quiz_year must not reach a paid media provider (found ${banned}) — the format's entire economic case is that it needs none`,
    );
  }

  const contract = MODULE_CONTRACTS.quiz_year;
  assert.ok(contract, "quiz_year needs a module contract");
  assert.ok(
    contract.maxCostUsd !== undefined && contract.maxCostUsd <= 1,
    "a quiz run costing more than $1 is a bug (runaway loop or a provider that must not be there)",
  );
  // A silent format must not claim script/narration capabilities.
  const capabilities = contract.capabilities ?? [];
  for (const cap of capabilities) {
    assert.ok(
      !String(cap).startsWith("narration."),
      `a silent format must not claim ${String(cap)}`,
    );
  }

  /* 5 — the catalog claims exactly what is wired */
  const entry = GOLDEN_MODULES.find((m) => m.key === "quiz-year");
  assert.ok(entry, "quiz-year catalog entry must exist");
  const binding = CATALOG_EXECUTION_BINDINGS["quiz-year"];
  assert.ok(binding, "quiz-year needs an execution binding");
  assert.equal(binding.kind, "pipeline-module", "the entry claims to be wired, so it must bind as one");
  assert.deepEqual(binding.executableIds, ["quiz_year"]);
  // The OLD entry must stay honest: it is still not buildable.
  const oldEntry = GOLDEN_MODULES.find((m) => m.key === "quiz");
  assert.ok(oldEntry, "the original quiz entry must be preserved as the licensing record");
  assert.equal(
    CATALOG_EXECUTION_BINDINGS["quiz"]?.kind,
    "catalog-only",
    "wiring guess-the-year must NOT retroactively make trivia/flag/music-guess look buildable",
  );

  /* 6 — the Remotion bundle is genuinely isolated */
  const quizRenderSource = await readFile(join(ROOT, "src/lib/quizYearRender.ts"), "utf8");
  assert.ok(
    quizRenderSource.includes("src/remotion/quiz/index.ts"),
    "the quiz renderer must bundle its OWN entry point",
  );
  assert.ok(
    !quizRenderSource.includes('"src/remotion/index.ts"'),
    "the quiz renderer must not reuse the shared bundle",
  );
  const sharedRoot = await readFile(join(ROOT, "src/remotion/Root.tsx"), "utf8");
  assert.ok(
    !sharedRoot.includes("QuizYear"),
    "registering QuizYear in the shared root would defeat the isolation gate",
  );

  /* round sizing + deterministic set defects */
  assert.equal(quizRoundCount(80, 6, 4), 8);
  assert.equal(quizRoundCount(0, 6, 4), 8, "no target → engine default");
  assert.ok(quizRoundCount(10_000, 6, 4) <= 15, "round count is capped so LLM calls are bounded");
  assert.ok(quizRoundCount(1, 6, 4) >= 3, "round count has a floor so the video is watchable");

  assert.equal(resolveTopic("space_exploration"), "space_exploration");
  assert.equal(resolveTopic("not_a_topic"), "science_discovery", "unknown topics fall back safely");
  assert.equal(resolveTopic(undefined), "science_discovery");

  const q = (qid: string, year: number, text: string): QuizYearQuestion => ({
    fact: {
      eventLabel: `Subject ${qid}`,
      eventDescription: "",
      year,
      wikidataQid: qid,
      sourceUrl: wikidataSourceUrl(qid),
      topic: "science_discovery",
      notability: 50,
    },
    questionText: text,
    phrasedByModel: false,
  });
  assert.deepEqual(
    quizSetDefects([
      q("Q1", 1781, "In what year was A discovered?"),
      q("Q2", 1846, "In what year was B discovered?"),
      q("Q3", 1900, "In what year was C discovered?"),
    ]),
    [],
  );
  assert.ok(
    quizSetDefects([
      q("Q1", 1781, "In what year was A discovered?"),
      q("Q1", 1781, "In what year was A discovered?"),
      q("Q3", 1900, "In what year was C discovered?"),
    ]).some((d) => d.includes("duplicate subject")),
  );
  assert.ok(
    quizSetDefects([
      q("Q1", 1900, "In what year was A discovered?"),
      q("Q2", 1900, "In what year was B discovered?"),
      q("Q3", 1900, "In what year was C discovered?"),
    ]).some((d) => d.includes("same year")),
    "a set where every answer is the same year is a bad quiz",
  );
  assert.ok(
    quizSetDefects([q("Q1", 1781, "Was it around 1781?")]).some((d) => d.includes("spoils")),
    "a spoiling question must surface as a set defect",
  );

  console.log("quizYearWiring: engine registration, lane policy, cost shape and catalog honesty locks passed");
}

void main();
