import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OPENROUTER_MODELS } from "@/lib/openRouter";
import { scriptCreativeTextModel } from "@/lib/creativeText";

const source = readFileSync(join(process.cwd(), "src/lib/scriptGen.ts"), "utf8");

assert.match(source, /from "@\/lib\/creativeText"/, "script generation must import the canonical creative-text boundary directly");
assert.doesNotMatch(source, /@\/lib\/anthropic|claudeJson|hasAnthropicKey|ANTHROPIC_CREATIVE/, "script generation must not retain legacy provider aliases");
assert.match(source, /tier: "pro",\s*\n\s*maxTokens: 16_000/, "the one-shot request must declare the creative-text ceiling it can actually receive");
assert.equal(scriptCreativeTextModel(), OPENROUTER_MODELS.creative, "long-form scripts remain pinned to the approved OpenRouter Gemini Flash model");

console.log("SCRIPT CREATIVE TEXT ROUTE PASS — direct OpenRouter boundary, truthful one-shot ceiling, no legacy provider aliases");
