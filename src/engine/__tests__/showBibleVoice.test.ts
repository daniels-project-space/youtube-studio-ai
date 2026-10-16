import assert from "node:assert/strict";
import { showBibleVoicePromptLines } from "../showBibleVoice";

const worksInSpace = Array.from({ length: 10 }, (_, index) => `Distinct channel pattern ${index + 1}`);
const avoidInSpace = Array.from({ length: 10 }, (_, index) => `Distinct channel anti-pattern ${index + 1}`);
const lines = showBibleVoicePromptLines({
  positioning: "A rigorous, welcoming channel for curious adults.",
  vibe: "Quietly wondrous, precise, and warm.",
  worksInSpace,
  avoidInSpace,
});

const workLines = lines.filter((line) => line.startsWith("Channel pattern to preserve:"));
const avoidLines = lines.filter((line) => line.startsWith("Channel anti-pattern to reject:"));
assert.equal(workLines.length, 10, "all authored channel patterns reach downstream creative modules");
assert.equal(avoidLines.length, 10, "all authored channel anti-patterns reach downstream creative modules");
assert.match(workLines.at(-1) ?? "", /Distinct channel pattern 10/u);
assert.match(avoidLines.at(-1) ?? "", /Distinct channel anti-pattern 10/u);

const bounded = showBibleVoicePromptLines({
  worksInSpace: ["First", " first ", " ", "Second".repeat(100)],
});
assert.deepEqual(bounded, [
  "Channel pattern to preserve: First",
  `Channel pattern to preserve: ${"Second".repeat(23)}Se`,
]);

console.log("SHOW BIBLE VOICE PASS: full bounded authored guidance reaches script, hook and critic prompts");
