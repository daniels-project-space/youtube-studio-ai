import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  assertScriptApprovedForNarration,
  assertScriptCritiqueAccepted,
  parseScriptCritique,
  scriptCritiqueExcerpt,
} from "@/engine/scriptQualityGate";

assert.deepEqual(parseScriptCritique({ pass: true, issues: [] }), { pass: true, issues: [] });
assert.deepEqual(parseScriptCritique({ pass: false, issues: ["  Weak payoff.  "] }), { pass: false, issues: ["Weak payoff."] });
assert.deepEqual(parseScriptCritique({ pass: true, issues: ["Weak payoff."] }), {
  pass: false,
  issues: ["Weak payoff."],
}, "a critic's concrete finding overrides its contradictory passing flag");
for (const invalid of [{}, { pass: "true", issues: [] }, { pass: true }, { pass: true, issues: [false] }]) {
  assert.throws(() => parseScriptCritique(invalid), /malformed script critique/);
}

assert.doesNotThrow(() => assertScriptCritiqueAccepted({ accepted: true }));
assert.throws(
  () => assertScriptCritiqueAccepted({ accepted: false, issues: ["cold open is generic"] }),
  /script_gen FAILED: independent narrative critique did not clear the quality bar \(cold open is generic\)/,
);
assert.doesNotThrow(() => assertScriptApprovedForNarration(true));
for (const unapproved of [false, undefined, null, "true"]) {
  assert.throws(
    () => assertScriptApprovedForNarration(unapproved),
    /narration_tts FAILED: script quality is not approved/,
  );
}

const boundedNarration = "opening sentinel" + "h".repeat(11_000) + "middle sentinel" +
  "m".repeat(11_000) + "ending sentinel" + "t".repeat(1_000);
const excerpt = scriptCritiqueExcerpt(boundedNarration);
assert.ok(excerpt.includes("opening sentinel"));
assert.ok(excerpt.includes("middle sentinel"), "long-script review must sample the central narrative");
assert.ok(excerpt.includes("ending sentinel"));
assert.deepEqual(
  excerpt.split("\n\n[... OMITTED ...]\n\n").map((part) => part.length),
  [3_500, 3_000, 2_500],
  "long-script review stays bounded to three non-overlapping source regions",
);
const shortNarration = "short script stays intact";
assert.equal(scriptCritiqueExcerpt(shortNarration), shortNarration);

const narratedBlocks = readFileSync(
  new URL("../../trigger/blocks/narratedBlocks.ts", import.meta.url),
  "utf8",
);
assert.match(narratedBlocks, /consumes: \["narrationText", "scriptApproved"\]/);
assert.match(narratedBlocks, /assertScriptApprovedForNarration\(ctx\.store\["scriptApproved"\]\)/);
assert.match(narratedBlocks, /assertScriptCritiqueAccepted\(\{/);
assert.match(narratedBlocks, /script_gen FAILED: independent narrative critic unavailable/);
assert.match(narratedBlocks, /scriptCritiqueExcerpt\(draft\.narrationText\)/);
assert.match(narratedBlocks, /scriptCritiqueExcerpt\(narration\)/);
assert.match(narratedBlocks, /qa_script FAILED: independent narrative critic unavailable/);
assert.match(narratedBlocks, /hook_craft FAILED: independent hook critic unavailable/);
assert.match(narratedBlocks, /stage: "hook_craft"/);
assert.match(narratedBlocks, /if \(critiqueEnabled && !loop\.accepted\) \{/);
assert.match(narratedBlocks, /falling back to primary footage rather than materializing unreviewed imagery/);
assert.match(narratedBlocks, /could not be independently verified.*skipping/);
assert.doesNotMatch(narratedBlocks, /return \{ scriptApproved: false \}/);

console.log("script quality admission gate tests passed");
