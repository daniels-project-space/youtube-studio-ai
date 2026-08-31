import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function source(relative: string): Promise<string> {
  return await readFile(join(process.cwd(), relative), "utf8");
}

async function main(): Promise<void> {
  const [designer, blocks, quotes, inserts, music, renderer, quoteOverlay, dataInsert] = await Promise.all([
    source("src/engine/designer.ts"),
    source("src/trigger/blocks/studioAssetLibraryBlocks.ts"),
    source("src/trigger/blocks/narratedBlocks.ts"),
    source("src/trigger/blocks/insertBlocks.ts"),
    source("src/trigger/blocks/lofiBlocks.ts"),
    source("src/lib/remotionRender.ts"),
    source("src/remotion/QuoteOverlay.tsx"),
    source("src/remotion/DataInsert.tsx"),
  ]);

  assert.match(designer, /studio_postproduction_asset_resolve/);
  assert.match(blocks, /moduleId: "music"/);
  assert.match(blocks, /moduleId: "quote_overlays"/);
  assert.match(blocks, /moduleId: "visual_inserts"/);
  assert.match(blocks, /moduleId: "timeline_assemble"/);
  assert.match(blocks, /audio_recipe/);
  assert.match(blocks, /overlay_template/);
  assert.match(blocks, /motion_graphics_template/);
  assert.match(blocks, /transition_template/);

  assert.match(quotes, /studioOverlayRecipeProjection/);
  assert.match(quotes, /presentation: studioOverlayRecipe\.quoteOverlayPreset/);
  assert.match(quotes, /studioPostproductionRecipeProjectionFromUnknown/);
  assert.match(inserts, /studioMotionGraphicsRecipeProjection/);
  assert.match(inserts, /presentation: studioMotionGraphicsRecipe\.dataInsertPreset/);
  assert.match(music, /studioAudioRecipeProjection/);
  assert.match(music, /must preserve the locked channel sound/);
  assert.match(music, /const basePrompt/);
  assert.match(quotes, /studioTransitionRecipeProjection/);
  assert.match(quotes, /transition: assemblyTransition/);
  assert.match(quotes, /createStudioTransitionDecisionReceipt/);
  assert.match(quotes, /studioPostproductionDecision/);

  assert.match(renderer, /presentation\?: "clean_editorial" \| "technical_grid" \| "soft_paper"/);
  assert.match(renderer, /presentation\?: "editorial_glass" \| "ink_card" \| "signal_card"/);
  assert.match(quoteOverlay, /ink_card/);
  assert.match(quoteOverlay, /signal_card/);
  assert.match(dataInsert, /technical_grid/);
  assert.match(dataInsert, /soft_paper/);
  console.log("STUDIO POSTPRODUCTION ASSET WIRING PASS");
}

void main();
