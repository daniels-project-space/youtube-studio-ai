import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

assert.match(page, /assessChannelArtFreshness\(\{/,
  "the Identity panel must derive freshness from proof, not banner-key presence");
assert.match(page, /Saved art does not prove the current channel identity/);
assert.match(page, /Owner verification is required because this spends money and replaces saved art/,
  "the paid mutation boundary must be explained at the action itself");
assert.match(page, /requestOwnerAccess\(\)/,
  "the banner action must open owner verification directly instead of dead-ending");
assert.match(page, /Replace stale banner/);
assert.match(page, /Rendering \+ reviewing…/,
  "the progress label must describe both paid generation and the visual gate");

console.log("CHANNEL ART FRESHNESS UI PASS");
