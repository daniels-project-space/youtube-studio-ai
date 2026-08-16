import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src", "trigger", "blocks", "lofiBlocks.ts"), "utf8");

assert.match(source, /production loop requires a grounded Style DNA subject and setting/);
assert.match(source, /production loop requires a configured non-Google OpenRouter vision reviewer/);
assert.match(source, /providers: \["openrouter"\]/);
assert.match(source, /independent art-direction review failed/);
assert.match(source, /independent motion-direction review failed/);
assert.doesNotMatch(source, /critic failed .*accepting attempt/);

console.log("lofi non-Google visual-gate tests passed");
