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

const critic = readFileSync(join(root, "src/lib/storyboardCritic.ts"), "utf8");
assert.match(critic, /from ["']@\/lib\/creativeText["']/,
  "the shared storyboard critic must use the canonical OpenRouter creative-text boundary");
assert.doesNotMatch(critic, /@\/lib\/anthropic|claudeJson|hasAnthropicKey/,
  "the shared storyboard critic must not retain legacy Claude-labelled aliases");

console.log("Shared storyboard critic wiring tests passed");
