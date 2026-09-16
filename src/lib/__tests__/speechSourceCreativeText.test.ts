import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/lib/speechSource.ts", "utf8");

assert.match(source, /creativeTextJson/, "speech-source query resolution must use the canonical creative-text route");
assert.match(source, /hasCreativeTextKey/, "speech-source query resolution must use the approved key gate");
assert.doesNotMatch(source, /\bgeminiJson\b|\bhasGeminiKey\b/, "speech-source discovery must not dispatch the retired Gemini text route");

console.log("Speech-source creative-text route contract passed");
