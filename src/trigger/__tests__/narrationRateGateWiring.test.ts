import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../blocks/narratedBlocks.ts", import.meta.url), "utf8");
const start = source.indexOf("export const narrationTts: Block =");
const end = source.indexOf("export const stockFootage: Block =", start);
assert.ok(start >= 0 && end > start, "narration_tts source boundary must remain discoverable");
const route = source.slice(start, end);

assert.match(route, /assertNarrationSpeed\([\s\S]*explicitSpeed === undefined/u);
assert.match(route, /quality === "production" && !rate\.ok[\s\S]*assertNarrationDeliveryRate\(\{ \.\.\.evidence, speed, label: "narration_tts" \}\)/u);

const chapter = route.slice(route.indexOf("if (chapterMode"), route.indexOf("// Synth PER SENTENCE"));
const sentence = route.slice(route.indexOf("// Synth PER SENTENCE"));
for (const [label, branch] of [["chapter", chapter], ["sentence", sentence]] as const) {
  const rateAt = branch.indexOf("assertFinalDeliveryRate(narrationPerformanceEvidence)");
  const uploadAt = branch.indexOf("await putObject(narrationKey");
  assert.ok(rateAt >= 0 && uploadAt > rateAt, `${label} narration must enforce final delivery rate before upload`);
}

console.log("NARRATION RATE GATE WIRING PASS — production pace is measured and enforced before master upload");
