import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
for (const relativePath of [
  "src/trigger/blocks/whiteboardScribeBlocks.ts",
  "src/trigger/blocks/motionComicBlocks.ts",
  "src/trigger/blocks/loreShortBlocks.ts",
]) {
  const source = readFileSync(join(root, relativePath), "utf8");
  assert.match(source, /@\/lib\/storyboardCritic/);
  assert.match(source, /critiqueStoryboardText\(/);
  assert.match(source, /unavailableStoryboardCriticVerdict\(/);
  assert.match(source, /assertStoryboardCritiqueApproved\(/);
  assert.doesNotMatch(source, /from\s+["']@\/lib\/gemini(?:["']|\/)/);
  assert.doesNotMatch(source, /\bgemini[A-Za-z0-9_]*\s*\(/i);
  assert.doesNotMatch(source, /accepting candidate .*deterministic checks alone/i);
}

console.log("Shared storyboard critic wiring tests passed");
