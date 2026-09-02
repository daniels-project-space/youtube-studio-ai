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
  /family.*music_loop[\s\S]*prepareLofiThumbnailReference[\s\S]*generateFalNanoBananaLofiThumbnailWithReceipt[\s\S]*lofi_nano_banana_15s_reference[\s\S]*generateFalNanoBananaProThumbnailWithReceipt/,
  "Lo-Fi must take its Fal 15-second reference-edit branch before the sealed native Pro thumbnail path",
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
assert.match(
  lofi,
  /assemble[\s\S]*thumbnail_gen[\s\S]*qa_visual/,
  "the exact Lo-Fi render must exist before its thumbnail is derived and final visual QA runs",
);
assert.match(contract, /"loopUnitKey"[\s\S]*"videoKey"[\s\S]*"videoLocalPath"/);
assert.match(replay, /"loopUnitKey"[\s\S]*"videoKey"[\s\S]*"videoDurationSec"/);
assert.match(block, /refusing a false 4K|sourceResolution/);

console.log("LOFI THUMBNAIL WIRING PASS");
