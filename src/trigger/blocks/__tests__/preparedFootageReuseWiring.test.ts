import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../genFootageBlocks.ts", import.meta.url), "utf8");
const start = source.indexOf("export const genFootage: Block =");
const end = source.indexOf("export const signatureClipsBlock", start);
const footage = source.slice(start, end);

const prepared = footage.indexOf('const preparedFootage = ctx.store["preparedFootage"]');
const visionGate = footage.indexOf("if (hasCinematicSequence && !hasNonGoogleVisionKey())");

assert.ok(prepared >= 0, "gen_footage must recognize runner-admitted prepared footage");
assert.ok(footage.includes('preparedFootage.renderer?.kind === "minimax-h3"'),
  "prepared H3 footage must have an explicit renderer branch");
assert.ok(footage.includes('footageRenderer: {\n            kind: "minimax-h3"'),
  "prepared H3 footage must publish explicit renderer identity to downstream consumers");
assert.ok(visionGate > prepared, "verified prepared footage must be reusable before a new vision/provider route is required");
for (const required of [
  "preparedManifest.source !== plan.source",
  "preparedFootage.ltxStyleId !== ltxStyleSelection.styleId",
  "timing does not match the frozen scene plan",
  "getObjectBytes(clip.r2Key)",
  "sha256BytesHex(bytes) !== clip.sha256",
  "!measured.hasVideo",
  "prepared weekly clip ${index + 1} video duration",
  "generatedFootageSceneManifest: preparedManifest",
  "no Novita spend",
  "native 5.17s scene plan",
  "prepared MiniMax H3 clip(s)",
] as const) {
  assert.ok(footage.includes(required), `prepared footage must retain ${required}`);
}

console.log("prepared weekly footage reuse wiring passed");
