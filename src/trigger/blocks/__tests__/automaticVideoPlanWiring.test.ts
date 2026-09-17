import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const metadata = readFileSync(resolve(process.cwd(), "src/trigger/blocks/intelligenceBlocks.ts"), "utf8");
const metacraft = readFileSync(resolve(process.cwd(), "src/lib/metacraft.ts"), "utf8");
const runner = readFileSync(resolve(process.cwd(), "src/trigger/runPipeline.ts"), "utf8");

assert.match(runner, /createAutomaticVideoPlan\(/);
assert.match(runner, /seedStore\.automaticVideoPlan = automaticVideoPlan/);
assert.match(runner, /automaticControlPolicy: automaticVideoPlan\.controlPolicy/);
assert.match(metadata, /ctx\.store\["automaticVideoPlan"\]/);
assert.match(metadata, /frameStrategy: automaticVideoPlan\?\.frameStrategy/);
assert.match(metacraft, /SEALED FRAME STRATEGY/);

console.log("automatic video plan wiring passed");
