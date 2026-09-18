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
  "getObjectBytes(clip.r2Key)",
  "sha256BytesHex(bytes) !== clip.sha256",
  "!measured.hasVideo",
  "prepared H3 clip ${index + 1} failed native duration verification",
  "generatedFootageSceneManifest: preparedManifest",
  "no provider spend",
  "native 5.17s scene plan",
  "prepared MiniMax H3 clip(s)",
  "retained legacy LTX receipt and cannot enter a new run",
] as const) {
  assert.ok(footage.includes(required), `prepared footage must retain ${required}`);
}

console.log("prepared weekly footage reuse wiring passed");
