import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../narratedBlocks.ts", import.meta.url), "utf8");
const narrationStart = source.indexOf("export const narrationTts: Block =");
const narrationEnd = source.indexOf("export const stockFootage: Block =", narrationStart);
const narration = source.slice(narrationStart, narrationEnd);
const qaStart = source.indexOf("export const qaVisual: Block =");
const qa = source.slice(qaStart);

assert.ok(narrationStart >= 0 && narrationEnd > narrationStart && qaStart >= 0, "narration and QA boundaries must remain discoverable");
for (const [label, branch] of [
  ["chapter", narration.slice(narration.indexOf("if (chapterMode"), narration.indexOf("// Synth PER SENTENCE"))],
  ["sentence", narration.slice(narration.indexOf("// Synth PER SENTENCE"))],
] as const) {
  const bind = branch.indexOf("bindQwenProviderEvidence({");
  const upload = branch.indexOf("await putObject(narrationKey, narrationBytes");
  assert.ok(bind >= 0 && upload > bind, `${label} Qwen source proof must be sealed before its final narration object is written`);
  assert.match(branch, /qwenSourceChunks:[\s\S]*part\.qwenReceipt/u, `${label} source proof must bind every emitted Qwen take, not only a summary`);
}
assert.match(
  qa,
  /getObjectBytes\(narrationKey\)[\s\S]*assertQwenNarrationSourceBinding\(/u,
  "final QA must re-read the durable narration object and bind it to the typed Qwen source proof",
);
assert.match(
  qa,
  /retainedSha256 !== sourceSha256/u,
  "final QA must refuse when the durable object differs from the transcript-proven local source",
);
assert.match(
  qa,
  /qwenNarrationSource=/u,
  "the final quality evidence must retain a compact Qwen source provenance marker",
);
assert.match(
  narration,
  /planWeekPreparationPrompt\([\s\S]*?"narration"/u,
  "a qualified weekly run must read its frozen narration brief rather than regenerate one at synthesis time",
);
assert.match(
  narration,
  /composeQwenNarrationInstruction\(\{\s*explicit: ctx\.params\["qwenInstruction"\],\s*editorialBrief: weeklyNarrationBrief,\s*delivery: dnaPacing\?\.delivery,\s*pacing: dnaPacing\?\.pacing,\s*archetype: physics\.archetype,/u,
  "the shared Qwen instruction composer must receive the frozen weekly brief and the complete channel delivery context",
);
console.log("Qwen narration final-source QA wiring PASS");
