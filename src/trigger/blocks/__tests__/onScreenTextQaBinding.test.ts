import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src", "trigger", "blocks", "narratedBlocks.ts"), "utf8");

assert.match(source, /TimedOnScreenTextCueSchema\.array\(\)\.safeParse/);
assert.match(source, /proveOnScreenText\(/);
assert.match(source, /on-screen text legibility failure:/);
assert.match(source, /on-screen text evidence unavailable:/);
assert.match(source, /onScreenTextOcr=/);

console.log("on-screen text final-QA binding test passed");
