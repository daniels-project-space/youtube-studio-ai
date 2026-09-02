import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function main(): Promise<void> {
  const source = await readFile(new URL("../../../convex/channels.ts", import.meta.url), "utf8");
  const updateChannel = source.slice(source.indexOf("export const updateChannel"), source.indexOf("export const updatePipelineIfCurrent"));
  assert.match(updateChannel, /expectedBannerKey: v\.optional\(v\.union\(v\.string\(\), v\.null\(\)\)\)/,
    "channel updates must accept an explicit nullable banner revision guard");
  assert.match(updateChannel, /existing\.identity\?\.bannerKey \?\? null\) !== expectedBannerKey/,
    "a refresh must reject if an operator changed the banner while its candidate was rendering");
  assert.match(updateChannel, /changed while its reviewed replacement was rendering/,
    "the rejected race must be actionable to the operator");
  console.log("channel banner compare-and-swap contract passed");
}

void main();
