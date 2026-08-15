import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  assertScriptApprovedForNarration,
  assertScriptCritiqueAccepted,
} from "@/engine/scriptQualityGate";

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

const narratedBlocks = readFileSync(
  new URL("../../trigger/blocks/narratedBlocks.ts", import.meta.url),
  "utf8",
);
assert.match(narratedBlocks, /consumes: \["narrationText", "scriptApproved"\]/);
assert.match(narratedBlocks, /assertScriptApprovedForNarration\(ctx\.store\["scriptApproved"\]\)/);
assert.match(narratedBlocks, /assertScriptCritiqueAccepted\(\{/);
assert.match(narratedBlocks, /script_gen FAILED: independent narrative critic unavailable/);
assert.match(narratedBlocks, /qa_script FAILED: independent narrative critic unavailable/);
assert.match(narratedBlocks, /hook_craft FAILED: independent hook critic unavailable/);
assert.match(narratedBlocks, /stage: "hook_craft"/);
assert.doesNotMatch(narratedBlocks, /return \{ scriptApproved: false \}/);

console.log("script quality admission gate tests passed");
