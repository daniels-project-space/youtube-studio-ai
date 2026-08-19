import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./designChannelInception.ts", import.meta.url), "utf8");

assert.match(source, /exampleClipAnalysisUnavailable\(\)/);
assert.match(source, /example clip skipped:/);
assert.match(source, /exampleClip:\s*exampleClipAdmission/);
assert.doesNotMatch(source, /@\/lib\/clipAnalysis|analyzeClip\(payload\.exampleClipUrl/);

console.log("Channel inception example-clip no-Gemini admission tests passed");
