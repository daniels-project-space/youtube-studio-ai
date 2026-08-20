import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./designChannelInception.ts", import.meta.url), "utf8");

// A supplied example URL is intentionally legacy/inert. Channel inception must
// never revive the retired clip-analysis provider path or hydrate a direct
// Gemini/Google model dependency from that input.
assert.match(source, /exampleClipUrl\?: string;/);
assert.equal(
  [...source.matchAll(/\bexampleClipUrl\b/g)].length,
  1,
  "exampleClipUrl must remain an inert legacy input, not an analysis dependency",
);
assert.doesNotMatch(
  source,
  /@\/lib\/(?:clipAnalysis|gemini)|@google\/generative-ai|generativelanguage\.googleapis\.com|GEMINI_API_KEY|GOOGLE_API_KEY|analyzeClip\(/i,
);
assert.doesNotMatch(source, /exampleClipAnalysisUnavailable\(/);

console.log("Channel inception legacy example-clip no-Gemini guard tests passed");
