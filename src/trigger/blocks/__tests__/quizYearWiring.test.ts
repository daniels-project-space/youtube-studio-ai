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
import {
  CATEGORY_PROMPTS,
  planRoundCategories,
  QUIZ_CERTIFIED_NO_GEMINI_CATEGORIES,
  QUIZ_ROUND_CATEGORIES,
  resolveCertifiedNoGeminiCategories,
  resolveCategories,
  type PlannedRound,
  type QuizRoundCategory,
} from "@/trigger/blocks/quizYearBlocks";
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
  assert.ok(
    block.produces.includes("onScreenTextCues"),
    "the final quiz master must carry an explicit readable-text contract into QA",
  );

  /* 2 — family / lane / archetype plumbing */
  const family = FAMILIES.quizyear;
  assert.ok(family, "quizyear family must exist");
  assert.equal(family.visualEngine, "quiz_year");
  assert.equal(family.archetypeKey, "quiz-year");
  assert.equal(family.narrated, false, "nobody speaks in this format");
  assert.equal(CONTENT_LANE_BY_FAMILY.quizyear, "quiz_year");
  assert.deepEqual(
    FAMILY_CREW.quizyear,
    [],
    "the certified route owns a deterministic critic receipt; a generic crew critic would reintroduce a Gemini path",
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
  for (const banned of ["geminiJson", "hasGeminiKey", "proposeGeneralKnowledgeCandidates"]) {
    assert.ok(
      !source.includes(banned),
      `QuizYear must not retain an optional Gemini/model fallback (${banned}); Gemini is reserved for the sealed thumbnail module`,
    );
  }
  assert.match(
    source,
    /certified only in noGemini mode/,
    "direct invocations must fail closed unless they use the registered deterministic route",
  );
  assert.match(
    source,
    /const onScreenTextCues: TimedOnScreenTextCue\[\]/,
    "QuizYear must derive timed OCR cues from its actual rendered questions and options",
  );

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
  assert.deepEqual(binding.executableIds, [
    "quiz_topic_plan",
    "quiz_topic_safety",
    "quiz_critic_spec",
    "quiz_metadata",
    "quiz_thumbnail",
    "quiz_year",
  ]);
  assert.ok(
    MODULE_CONTRACTS.quiz_critic_spec,
    "the deterministic critic must stay registered rather than being replaced by a generic model crew role",
  );
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

  // …and the isolated bundle only helps if the CLOUD IMAGE actually contains it.
  // @remotion/bundler compiles src/remotion/quiz/index.ts from source at runtime,
  // so the raw .ts/.tsx must be baked in by the additionalFiles build extension.
  // `src/remotion/**` covers the nested quiz/ dir today (globstar recurses —
  // confirmed against a real `trigger deploy --dry-run`, whose build output
  // contained all three quiz files). This lock fires if that glob is ever
  // narrowed: the quiz bundle would vanish from the image and EVERY cloud render
  // would fail on a missing entry point while local renders kept passing.
  const triggerConfig = await readFile(join(ROOT, "trigger.config.ts"), "utf8");
  const filesBlock = /additionalFiles\(\{\s*files:\s*\[([\s\S]*?)\]/.exec(triggerConfig);
  assert.ok(filesBlock, "trigger.config.ts must bake files in via additionalFiles({ files: [...] })");
  const bakedGlobs = [...filesBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  for (const quizFile of [
    "src/remotion/quiz/index.ts",
    "src/remotion/quiz/Root.tsx",
    "src/remotion/quiz/QuizYear.tsx",
  ]) {
    assert.ok(
      bakedGlobs.some(
        (g) =>
          g === quizFile ||
          (g.endsWith("/**") && quizFile.startsWith(g.slice(0, -2))),
      ),
      `${quizFile} is not covered by any additionalFiles glob [${bakedGlobs.join(", ")}] — ` +
        "the Trigger image would ship without the quiz Remotion bundle and every cloud quiz render would fail",
    );
  }

  /* round sizing + deterministic set defects */
  assert.equal(quizRoundCount(80, 6, 4), 8);
  assert.equal(quizRoundCount(0, 6, 4), 8, "no target → engine default");
  assert.ok(quizRoundCount(10_000, 6, 4) <= 15, "round count is capped so LLM calls are bounded");
  assert.ok(quizRoundCount(1, 6, 4) >= 3, "round count has a floor so the video is watchable");

  assert.equal(resolveTopic("space_exploration"), "space_exploration");
  assert.equal(resolveTopic("not_a_topic"), "science_discovery", "unknown topics fall back safely");
  assert.equal(resolveTopic(undefined), "science_discovery");

  // `quizSetDefects` now grades the UNIFIED round shape every category collapses
  // to, so one set of set-level locks covers years, capitals, currencies,
  // symbols and general knowledge rather than each category re-implementing them.
  const q = (
    subjectId: string,
    answer: string,
    text: string,
    category: QuizRoundCategory = "guess_year",
  ): PlannedRound => ({
    category,
    categoryPrompt: CATEGORY_PROMPTS[category],
    subjectId,
    subject: `Subject ${subjectId}`,
    questionText: text,
    answerLabel: answer,
    sourceUrl: wikidataSourceUrl(subjectId),
    options: [
      { label: answer, isCorrect: true, provenance: "wikidata-sourced" },
      { label: `${answer}-x`, isCorrect: false, provenance: "generated-decoy" },
      { label: `${answer}-y`, isCorrect: false, provenance: "generated-decoy" },
      { label: `${answer}-z`, isCorrect: false, provenance: "generated-decoy" },
    ],
    phrasedByModel: false,
  });
  assert.deepEqual(
    quizSetDefects([
      q("Q1", "1781", "In what year was A discovered?"),
      q("Q2", "1846", "In what year was B discovered?"),
      q("Q3", "1900", "In what year was C discovered?"),
    ]),
    [],
  );
  assert.ok(
    quizSetDefects([
      q("Q1", "1781", "In what year was A discovered?"),
      q("Q1", "1781", "In what year was A discovered?"),
      q("Q3", "1900", "In what year was C discovered?"),
    ]).some((d) => d.includes("duplicate subject")),
  );
  assert.ok(
    quizSetDefects([
      q("Q1", "1900", "In what year was A discovered?"),
      q("Q2", "1900", "In what year was B discovered?"),
      q("Q3", "1900", "In what year was C discovered?"),
    ]).some((d) => d.includes("every answer is the same")),
    "a set where every answer is identical is a bad quiz",
  );
  assert.ok(
    quizSetDefects([q("Q1", "1781", "Was it around 1781?")]).some((d) => d.includes("spoils")),
    "a spoiling question must surface as a set defect",
  );
  // The same spoiler lock has to hold for a NON-numeric answer, which is the
  // whole point of generalising past years.
  assert.ok(
    quizSetDefects([q("Q142", "Paris", "Which city is the capital, Paris or Lyon?", "capital_city")])
      .some((d) => d.includes("spoils")),
    "a capital question naming its own answer must be caught too",
  );

  // REGRESSION: the spoiler check must match on WORD BOUNDARIES.
  //
  // It was a raw `String.includes`, which reads two-letter chemical symbols
  // inside ordinary words. Because this gate THROWS in the block's final
  // integrity check — and the repair path falls back to the same deterministic
  // template, which trips it again — every one of these rounds was an
  // unrecoverable video failure rather than a dropped question. All five are
  // real element rows from the live P246 pool.
  for (const [element, symbol] of [
    ["indium", "In"],
    ["iodine", "I"],
    ["nobelium", "No"],
    ["barium", "Ba"],
    ["astatine", "At"],
  ] as const) {
    assert.deepEqual(
      quizSetDefects([
        q("Q1", symbol, `What is the chemical symbol for ${element}?`, "element_symbol"),
        q("Q2", "Fe", "What is the chemical symbol for iron?", "element_symbol"),
        q("Q3", "Au", "What is the chemical symbol for gold?", "element_symbol"),
      ]),
      [],
      `"${symbol}" appears inside "${element}" as a substring but not as a word — must not throw`,
    );
  }
  // …and a symbol that really does stand alone in the text is still caught.
  assert.ok(
    quizSetDefects([q("Q1", "Au", "Is the answer Au or Ag?", "element_symbol")])
      .some((d) => d.includes("spoils")),
  );

  /* ------------------------------------------------------------------ *
   * Category mixing — a single video draws rounds from several categories
   * ------------------------------------------------------------------ */
  {
    const plan = planRoundCategories(8, [...QUIZ_ROUND_CATEGORIES]);
    assert.equal(plan.length, 8, "the plan fills every requested round");
    assert.ok(
      new Set(plan).size >= 4,
      `a mixed 8-round video must span several categories, got ${new Set(plan).size}`,
    );
    // Interleaved, not blocked: no category may take the first three slots.
    assert.ok(
      !(plan[0] === plan[1] && plan[1] === plan[2]),
      `categories must interleave rather than cluster: ${plan.join(",")}`,
    );
    // Deterministic — a healer replay must reproduce the same plan.
    assert.deepEqual(plan, planRoundCategories(8, [...QUIZ_ROUND_CATEGORIES]));

    // A restricted request is honoured exactly.
    const only = planRoundCategories(6, ["capital_city", "guess_year"]);
    assert.equal(only.length, 6);
    assert.deepEqual([...new Set(only)].sort(), ["capital_city", "guess_year"]);

    assert.deepEqual(resolveCategories("capital_city, guess_year"), ["capital_city", "guess_year"]);
    assert.deepEqual(
      resolveCategories("nonsense"),
      [...QUIZ_ROUND_CATEGORIES],
      "an unparseable category list falls back to the full mix rather than failing",
    );
    assert.deepEqual(
      resolveCertifiedNoGeminiCategories(undefined),
      [...QUIZ_CERTIFIED_NO_GEMINI_CATEGORIES],
      "the automatic planner omits categories, so its default must be the certified no-Gemini mix",
    );
    assert.deepEqual(
      resolveCertifiedNoGeminiCategories("capital_city, guess_year"),
      ["capital_city", "guess_year"],
    );
    assert.throws(
      () => resolveCertifiedNoGeminiCategories("general_knowledge"),
      /does not allow general_knowledge/,
      "the legacy model-backed category cannot leak through an explicit renderer parameter",
    );
    for (const c of QUIZ_ROUND_CATEGORIES) {
      assert.ok(CATEGORY_PROMPTS[c], `every category needs an on-screen prompt (${c})`);
    }
  }

  console.log("quizYearWiring: engine registration, lane policy, cost shape, category mixing and catalog honesty locks passed");
}

void main();
