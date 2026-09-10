import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasEmbedKey } from "@/lib/embeddings";

const source = readFileSync(join(process.cwd(), "src/lib/topicraft.ts"), "utf8");

assert.equal(hasEmbedKey(), false, "the retired Gemini embedding route must remain disabled");
assert.match(
  source,
  /if \(!hasEmbedKey\(\)\) \{[\s\S]{0,500}semantic dedupe disabled by provider policy/,
  "topicraft must short-circuit disabled embeddings before constructing provider work",
);
assert.match(
  source,
  /return bets;\n  \}\n  const sample = avoid\.slice\(-40\)/,
  "lexical lint must be the explicit zero-provider fallback",
);
assert.match(
  source,
  /providerSemanticDedupe !== false/,
  "callers must still be able to disable optional semantic dedupe explicitly",
);

console.log("TOPICRAFT EFFICIENCY PASS — disabled embeddings do not create doomed provider work");
