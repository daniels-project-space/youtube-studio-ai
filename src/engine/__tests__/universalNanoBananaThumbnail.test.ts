import assert from "node:assert/strict";

import { designPipeline } from "@/engine/designer";
import { FAMILY_KEYS } from "@/engine/families";
import { thumbnailGen } from "@/trigger/blocks/intelligenceBlocks";

assert.deepEqual(
  thumbnailGen.consumes,
  ["title", "thumbnailDescription", "topic", "packageToOpeningPlan"],
  "the only executable thumbnail producer must require a title plus a concrete visual description",
);

for (const family of FAMILY_KEYS) {
  const blocks = designPipeline({ family }).pipeline.map((entry) => entry.block);
  const thumbnailIndex = blocks.indexOf("thumbnail_gen");
  assert.ok(thumbnailIndex >= 0, `${family} must include the universal Nano Banana thumbnail module`);
  assert.equal(
    blocks.filter((block) => block === "thumbnail_gen").length,
    1,
    `${family} must generate exactly one final thumbnail through Nano Banana`,
  );
  assert.equal(
    blocks.includes("quiz_thumbnail"),
    false,
    `${family} must not use the retired QuizYear renderer-native thumbnail path`,
  );
  assert.equal(
    blocks.includes("scene_compiler_thumbnail"),
    false,
    `${family} must not use the retired Scene Compiler renderer-native thumbnail path`,
  );
  const metadataIndex = Math.max(blocks.lastIndexOf("metadata"), blocks.lastIndexOf("quiz_metadata"));
  assert.ok(
    metadataIndex >= 0 && metadataIndex < thumbnailIndex,
    `${family} must produce metadata and its thumbnail description before image generation`,
  );
}

console.log("UNIVERSAL NANO BANANA THUMBNAIL PASS: every family uses the described shared thumbnail path");
