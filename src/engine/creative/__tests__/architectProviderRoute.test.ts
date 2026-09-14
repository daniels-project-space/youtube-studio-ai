import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const architectSource = readFileSync(join(process.cwd(), "src/engine/creative/architect.ts"), "utf8");
const taskSource = readFileSync(join(process.cwd(), "src/trigger/architectPipelineTask.ts"), "utf8");

assert.match(architectSource, /import \{ agentJson \} from "@\/agents\/mastra"/,
  "the architect must use the shared agent boundary");
assert.doesNotMatch(architectSource, /@\/lib\/anthropic|claudeJson|hasAnthropicKey|ANTHROPIC_CREATIVE|\bClaude\b|\bAnthropic\b/,
  "the architect must not retain retired provider routes or labels");
assert.doesNotMatch(taskSource, /@\/lib\/anthropic|claudeJson|hasAnthropicKey|ANTHROPIC_CREATIVE|\bClaude\b|\bAnthropic\b/,
  "the architect Trigger task must not advertise or route through a retired provider");

console.log("ARCHITECT PROVIDER ROUTE PASS — shared OpenRouter agent boundary with no retired provider aliases");
