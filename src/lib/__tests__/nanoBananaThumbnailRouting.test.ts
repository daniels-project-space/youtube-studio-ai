import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function source(path: string): Promise<string> {
  return readFile(join(process.cwd(), path), "utf8");
}

async function main(): Promise<void> {
  const banana = await source("src/lib/banana.ts");
  const manualWrapper = banana.slice(banana.indexOf("export async function bananaThumbnail"));
  assert.match(manualWrapper, /renderThumbnail\s*\(/,
    "manual thumbnail compatibility must use the deterministic compositor");
  assert.doesNotMatch(manualWrapper, /generateBananaImage\s*\(/,
    "manual thumbnails must never enter the Fal-aware generic image router");
  assert.match(manualWrapper, /structured ThumbBriefArgs/,
    "one-pass baked-text strings must fail before provider spend");

  for (const path of [
    "scripts/banana-quietstoic.mjs",
    "scripts/documotion-robbery-full.mjs",
    "scripts/thumb-stevejobs.ts",
  ]) {
    const manual = await source(path);
    assert.match(manual, /bananaThumbnail\s*\(/, `${path} must use the strict compatibility wrapper`);
    assert.doesNotMatch(manual, /buildThumbBrief\s*\(/,
      `${path} must not rebuild a one-pass baked-text provider prompt`);
  }

  const production = await source("src/trigger/blocks/intelligenceBlocks.ts");
  assert.match(production, /thumbnail-gen-checkpoint-v4-nano-banana-only/);
  assert.doesNotMatch(production, /verifiedSceneBase|isThumbnailBaseProvenance|baseArt/,
    "publishable thumbnail_gen must purchase its pixels from the pinned Nano route");
  assert.match(production, /generateNanoBananaImageWithReceipt\s*\(/);

  const candidate = await source("src/lib/thumbnailLab.ts");
  assert.doesNotMatch(candidate, /baseArt\??:/,
    "the exported candidate renderer must not expose a scene-still bypass");

  console.log("NANO BANANA THUMBNAIL ROUTING PASS");
}

void main();
