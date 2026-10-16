import assert from "node:assert/strict";
import { ARCHETYPES } from "../archetypes";
import { registerAllBlocks } from "../blocks";
import { CHILDREN_SHOW_BIBLE_INPUT_SEED_KEY } from "../childrenShowBible";
import { CURRICULUM_EPISODE_SEED_INPUT_SEED_KEY } from "../curriculumEpisodeSeed";
import { validatePipeline } from "../validate";
import { LOFI_PIPELINE } from "../../trigger/blocks/lofiBlocks";

registerAllBlocks();

for (const archetype of Object.values(ARCHETYPES)) {
  const stages = archetype.pipeline.map((entry) => entry.block);
  assert.ok(
    stages.includes("package_to_opening_plan"),
    `${archetype.key} must freeze its package/opening handoff`,
  );
  const seeds = stages.includes("curriculum_episode_seed")
    ? [
        "contentLane",
        CURRICULUM_EPISODE_SEED_INPUT_SEED_KEY,
        CHILDREN_SHOW_BIBLE_INPUT_SEED_KEY,
      ]
    : [];
  assert.doesNotThrow(
    () => validatePipeline(archetype.pipeline, seeds),
    `${archetype.key} must compile as a complete pipeline`,
  );

  const narrationIndex = stages.indexOf("narration_tts");
  const scriptIndex = stages.indexOf("script_gen");
  if (scriptIndex < 0 || narrationIndex < 0) continue;

  const approvalIndex = stages.lastIndexOf("qa_script", narrationIndex);
  assert.ok(
    approvalIndex > scriptIndex,
    `${archetype.key} must approve generated narration before TTS`,
  );
  assert.doesNotThrow(
    () => validatePipeline(archetype.pipeline.slice(0, narrationIndex + 1), seeds),
    `${archetype.key} must compile through the approved narration handoff`,
  );

  const hookIndex = stages.lastIndexOf("hook_craft", narrationIndex);
  if (hookIndex > scriptIndex) {
    assert.ok(
      approvalIndex > hookIndex,
      `${archetype.key} must approve the final hook-edited script`,
    );
  }
}

const quizStages = ARCHETYPES["quiz-year"].pipeline.map((entry) => entry.block);
const quizModules = [
  "quiz_topic_plan",
  "quiz_topic_safety",
  "quiz_critic_spec",
  "quiz_metadata",
  "quiz_year",
];
assert.deepEqual(
  quizStages.filter((stage) => quizModules.includes(stage)),
  quizModules,
  "Quiz Year must run its planner, safety, critic, and metadata modules before rendering",
);
assert.ok(!quizStages.includes("topic_select"), "Quiz Year must not duplicate its curated topic planner");
assert.ok(!quizStages.includes("compliance_check"), "Quiz Year safety fields must have one deterministic owner");
assert.ok(!quizStages.includes("metadata"), "Quiz Year must not overwrite its certified metadata");
const quizRendererIndex = quizStages.indexOf("quiz_year");
assert.doesNotThrow(
  () => validatePipeline(ARCHETYPES["quiz-year"].pipeline.slice(0, quizRendererIndex + 1)),
  "Quiz Year must compile its plan, safety, compliance, and QA artifacts before rendering",
);
assert.doesNotThrow(
  () => validatePipeline(LOFI_PIPELINE),
  "the standalone Lo-Fi pipeline must compile its shared module handoffs",
);

console.log("archetype gates, full pipeline contracts, and Lo-Fi module handoffs pass");
