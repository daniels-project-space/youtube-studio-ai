import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

assert.match(source, /redirect\("\/runs"\)/, "the legacy production URL must resolve to the canonical production workspace");
assert.doesNotMatch(source, /convex|fetch\(|mutat|trigger/i, "the compatibility alias must remain a read-only routing change");

console.log("production route compatibility contract passed");
