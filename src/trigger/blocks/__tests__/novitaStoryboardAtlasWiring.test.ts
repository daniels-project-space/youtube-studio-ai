import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src/trigger/blocks/novitaRenderBlocks.ts"), "utf8");
const start = source.indexOf("export const novitaRenderImages: Block");
const end = source.indexOf("export const qaAssets: Block", start);
assert(start >= 0 && end > start, "novita_render_images block is missing");
const block = source.slice(start, end);

assert.match(block, /requestedQualifiedStoryboardAtlasGrid/u, "atlas activation must cross the reviewed-route gate");
assert.match(block, /createStoryboardAtlasRenderPlan/u, "the provider payload must be planned as actual atlas sheets");
assert.match(block, /shots: providerShots/u, "the direct Novita call must consume atlas jobs when qualified");
assert.match(block, /materializeStoryboardAtlasCrops/u, "provider sheets must be cropped into downstream stills");
assert.match(block, /StillRenderManifestSchema\.parse\([\s\S]*items/u, "atlas crops must enter the canonical still manifest");
assert.match(block, /assertExactStillCandidates\(shots, stillRenderManifest\)/u, "atlas crops must preserve every original shot candidate");

console.log("Novita storyboard atlas production wiring tests passed");
