import assert from "node:assert/strict";

import { GOLDEN_MODULES } from "@/engine/golden";

function module(key: string) {
  const found = GOLDEN_MODULES.find((candidate) => candidate.key === key);
  assert.ok(found, `missing Golden module ${key}`);
  return found;
}

const lore = module("loreshort");
assert.match(lore.engine, /OpenRouter/i);
assert.match(lore.engine, /MiniMax H3/i);
assert.doesNotMatch(`${lore.engine}\n${lore.how}\n${lore.gates.join("\n")}`, /\b(?:LTX|Gemini)\b/i);

const lofi = module("lofi");
assert.match(`${lofi.engine}\n${lofi.how}\n${lofi.gates.join("\n")}`, /MiniMax H3/i);
assert.doesNotMatch(`${lofi.engine}\n${lofi.how}\n${lofi.gates.join("\n")}`, /\bLTX\b/i);

const script = module("script");
const metadata = module("metadata");
assert.match(script.engine, /OpenRouter/i);
assert.doesNotMatch(`${script.engine}\n${script.how}`, /Gemini Pro/i);
assert.doesNotMatch(metadata.engine, /Gemini Pro/i);

const legacy = module("videocraft-novita");
assert.match(legacy.title, /Retired Route Record/i);
assert.match(`${legacy.engine}\n${legacy.how}\n${legacy.gates.join("\n")}`, /Historical|H3/i);
assert.doesNotMatch(`${legacy.title}\n${legacy.engine}\n${legacy.how}\n${legacy.gates.join("\n")}`, /\bLTX\b/i);

console.log("Golden current route copy tests passed");
