import { registerAllBlocks } from "@/engine/blocks";
import { validatePipeline } from "@/engine/validate";
import { ARCHETYPES } from "@/engine/archetypes";
import { CHILDREN_SHOW_BIBLE_INPUT_SEED_KEY } from "@/engine/childrenShowBible";
import { CURRICULUM_EPISODE_SEED_INPUT_SEED_KEY } from "@/engine/curriculumEpisodeSeed";
import { LOFI_PIPELINE } from "@/trigger/blocks/lofiBlocks";

registerAllBlocks();
let ok = true;
for (const [key, a] of Object.entries(ARCHETYPES)) {
  try {
    const seeds = key === "children-learning"
      ? [
          "contentLane",
          CURRICULUM_EPISODE_SEED_INPUT_SEED_KEY,
          CHILDREN_SHOW_BIBLE_INPUT_SEED_KEY,
        ]
      : [];
    const resolved = validatePipeline(a.pipeline, seeds);
    console.log(`OK   archetype ${key} (${resolved.blocks.length} blocks)`);
  } catch (e) {
    ok = false;
    console.log(`FAIL archetype ${key}: ${e instanceof Error ? e.message : e}`);
  }
}
try {
  const resolved = validatePipeline(LOFI_PIPELINE);
  console.log(`OK   LOFI_PIPELINE (${resolved.blocks.length} blocks)`);
} catch (e) {
  ok = false;
  console.log(`FAIL LOFI_PIPELINE: ${e instanceof Error ? e.message : e}`);
}
console.log(ok ? "\nALL ARCHETYPES VALID" : "\nVALIDATION FAILURES");
process.exit(ok ? 0 : 1);
