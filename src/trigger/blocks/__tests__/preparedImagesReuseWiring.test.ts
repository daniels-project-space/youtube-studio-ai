import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../novitaRenderBlocks.ts", import.meta.url), "utf8");
const branch = source.indexOf('const preparedImages = ctx.store["preparedImages"]');
const verify = source.indexOf("assertPreparedImagesForShots(shots, preparedImages)");
const reread = source.indexOf("getObjectBytes(item.stillKey)");
const noSpend = source.indexOf("[COST_PATCH_KEY]: 0", branch);
const provider = source.indexOf("const result = await renderImages(cfg)", branch);

assert.ok(branch >= 0, "novita image stage must recognize a prepared weekly image sidecar");
assert.ok(verify > branch, "prepared stills must be validated against the exact shot list before reuse");
assert.ok(reread >= 0, "prepared still bytes must be re-read and hashed immediately before reuse");
assert.ok(noSpend > reread, "prepared still reuse must report zero provider spend");
assert.ok(provider > noSpend, "the normal paid renderer remains available when no prepared sidecar is present");

console.log("prepared image reuse wiring passed");
