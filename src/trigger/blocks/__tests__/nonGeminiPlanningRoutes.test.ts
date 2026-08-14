import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

const topicSelect = source("src/trigger/blocks/lofiBlocks.ts");
const metadata = source("src/trigger/blocks/intelligenceBlocks.ts");
const weekAhead = source("src/trigger/planWeekAhead.ts");
const narrated = source("src/trigger/blocks/narratedBlocks.ts");
const compliance = source("src/trigger/blocks/complianceBlocks.ts");
const metacraft = source("src/lib/metacraft.ts");

for (const [name, implementation] of [
  ["topic_select", topicSelect],
  ["metadata", metadata],
  ["plan-week-ahead", weekAhead],
  ["narrated text enhancements", narrated],
  ["compliance", compliance],
  ["metadata package", metacraft],
] as const) {
  assert.doesNotMatch(
    implementation,
    /geminiJson(?:Pro)?/,
    `${name} must not retain a generic Gemini planning route`,
  );
}

assert.match(topicSelect, /hasAnthropicKey/, "topic_select must require the permitted text planner");
assert.match(metadata, /hasAnthropicKey/, "metadata must use the permitted text planner");
assert.match(weekAhead, /hasAnthropicKey/, "week-ahead planning must use the permitted text planner");
assert.match(narrated, /claudeJson/, "narrated quality enhancements must use the permitted text planner");
assert.match(compliance, /claudeJson/, "compliance review must use the permitted text planner");
assert.match(metacraft, /claudeJson/, "metadata package must use the permitted text planner");
assert.match(metadata, /hasNanoBanana\(\)/, "the sealed thumbnail capability remains explicit");

console.log("Non-Gemini planning route tests passed");
