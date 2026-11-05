import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const block = read("src/trigger/blocks/intelligenceBlocks.ts");
const lofi = read("src/trigger/blocks/lofiBlocks.ts");
const contract = read("src/engine/moduleContracts.ts");
const replay = read("src/lib/thumbnailRefreshReplay.ts");

assert.match(
  block,
  /family.*music_loop[\s\S]*prepareLofiThumbnailReference[\s\S]*uploadReference[\s\S]*client\.submit[\s\S]*lofi_nano_banana_15s_reference[\s\S]*client\.submit/,
  "Lo-Fi must submit its exact frame and the standard path must use the HRS candidate client",
);
assert.doesNotMatch(
  block,
  /generateNanoBananaImageWithReceipt/,
  "the production thumbnail block must not fall back to the retired direct-Google adapter",
);
assert.doesNotMatch(
  block,
  /generateLofiNanoBananaThumbnailWithReceipt/,
  "the Lo-Fi side lane must not call the direct-Google thumbnail adapter",
);
assert.doesNotMatch(
  block,
  /compositeProviderTypographyOverlay|measureLofiTypographyMatteUniformity|typographyMatteImage/,
  "Lo-Fi typography must be rendered by the native provider, never a local FFmpeg/matte compositor",
);
assert.match(
  block,
  /createHyperThumbnailEvidence\(\{result,requestContext,[\s\S]*mode:"lofi-render-frame-native"/,
  "the active Lo-Fi evidence must identify the HRS single-reference edit",
);
assert.match(
  lofi,
  /assemble[\s\S]*thumbnail_gen[\s\S]*qa_visual/,
  "the exact Lo-Fi render must exist before its thumbnail is derived and final visual QA runs",
);
assert.match(contract, /"loopUnitKey"[\s\S]*"videoKey"[\s\S]*"videoLocalPath"/);
assert.match(replay, /"loopUnitKey"[\s\S]*"videoKey"[\s\S]*"videoDurationSec"/);
assert.match(block, /refusing a false 4K|sourceResolution/);

console.log("LOFI THUMBNAIL WIRING PASS");
