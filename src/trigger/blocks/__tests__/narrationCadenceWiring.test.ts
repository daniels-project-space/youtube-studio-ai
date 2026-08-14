import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src/trigger/blocks/narratedBlocks.ts"), "utf8");
const narrationStart = source.indexOf("export const narrationTts: Block");
const narrationEnd = source.indexOf("export const timelineAssemble: Block", narrationStart);
const narrationSource = source.slice(narrationStart, narrationEnd > narrationStart ? narrationEnd : undefined);

assert(narrationStart >= 0, "narration_tts must remain the shared spoken-audio producer");
assert.match(narrationSource, /planNarrationCadence\(/, "narration_tts must plan semantic pauses before synthesis");
assert.match(narrationSource, /evaluateNarrationCadence\(/, "narration_tts must bind actual sentence timing to the planned delivery beats");
assert.doesNotMatch(narrationSource, /Math\.random\(/, "narration timing must be repeatable across retries and cannot use random pauses");
assert.match(narrationSource, /chapterCadencePlan/, "chapter narration must use the same shared cadence planner");

console.log("narration cadence wiring test passed");
