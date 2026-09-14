import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const source = (relativePath: string) => readFileSync(new URL(relativePath, `file://${root}/`), "utf8");

for (const relativePath of [
  "src/engine/creative/styleDNA.ts",
  "src/engine/creative/showBible.ts",
]) {
  const content = source(relativePath);
  assert.doesNotMatch(
    content,
    /hasGeminiKey|geminiJson|Gemini/i,
    `${relativePath} is part of automatic channel inception and must remain Gemini-free`,
  );
  assert.match(
    content, /hasCreativeTextKey\(\)/, `${relativePath} must fail closed without its canonical creative-text model`);
  assert.doesNotMatch(
    content,
    /hasAnthropicKey|@\/lib\/anthropic/,
    `${relativePath} must not route through the deprecated provider alias`,
  );
}

console.log("no-Gemini creator foundations: ok");
