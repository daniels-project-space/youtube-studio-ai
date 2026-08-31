import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../crewBlocks.ts", import.meta.url), "utf8");

assert.match(
  source,
  /g\.moduleConfig\?\.\["show-bible"\] !== undefined[\s\S]*?throw new Error\([\s\S]*?invalid frozen show-bible configuration/,
  "an explicit invalid crew selection must stop a legacy/retried run instead of silently using generic defaults",
);
assert.match(
  source,
  /resolveCrew unavailable without saved Show-Bible configuration[\s\S]*?return null/,
  "the intentional fallback remains limited to channels with no saved crew selection",
);
assert.doesNotMatch(
  source,
  /resolveCrew check failed \(non-fatal, brief still proceeds\)/,
  "malformed saved crew configuration must not retain the old non-fatal fallback",
);

console.log("crew configuration fail-closed wiring tests passed");
