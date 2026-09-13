import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const metadata = readFileSync(join(root, "src/trigger/blocks/intelligenceBlocks.ts"), "utf8");
const metacraft = readFileSync(join(root, "src/lib/metacraft.ts"), "utf8");

// A checked-in manual route can quietly become the path somebody runs under
// pressure. Keep the retired Gemini comparison utility and its disproven
// long-title doctrine out of the executable repository surface.
assert.equal(
  existsSync(join(root, "scripts/meta-duel.mjs")),
  false,
  "the retired direct-Gemini metadata utility must not be reintroduced",
);

for (const [label, source] of [["metadata block", metadata], ["metacraft", metacraft]] as const) {
  assert.doesNotMatch(source, /70\s*[-–]\s*100\s*char(?:acter)? titles earn/i, `${label} must not encode unsupported title-length CTR uplift`);
  assert.doesNotMatch(source, /title:\s*60\s*[-–]\s*90\s*characters\s*\(aim long/i, `${label} must not restore the old long-title prompt`);
}
assert.doesNotMatch(metadata, /geminiJson(?:Pro)?\s*\(/, "production metadata must not dispatch the retired Gemini text route");
assert.match(metadata, /craftMetadata\(/, "production metadata must retain the single current metacraft authority");

console.log("TITLE LEGACY DOCTRINE AUDIT PASS — no stale Gemini long-title route remains executable");
