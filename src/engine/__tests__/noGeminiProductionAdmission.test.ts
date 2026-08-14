import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  FAMILY_KEYS,
  familyProductionReadiness,
  productionReadyFamilyFallback,
} from "@/engine/families";
import { qaVisualCost } from "@/engine/pricing";

for (const family of FAMILY_KEYS) {
  const readiness = familyProductionReadiness(family);
  assert.equal(
    readiness.productionReady,
    false,
    `${family} must not be advertised as production-ready while its automatic planner is Gemini-only`,
  );
  assert.match(
    readiness.blockers.join(" "),
    /no-Gemini automatic planning is not registered/,
    `${family} must explain the no-Gemini admission failure`,
  );
  assert.match(readiness.remediation ?? "", /non-Gemini topic\/story planner/);
}

assert.equal(
  productionReadyFamilyFallback("cinematic"),
  undefined,
  "a blocked Gemini-dependent family must not be redirected to another blocked family",
);
assert.equal(
  qaVisualCost({ nativeWatch: true }),
  qaVisualCost({}),
  "retired nativeWatch must not reserve a native Gemini video-review call",
);

const qaVisualSource = readFileSync(new URL("../../trigger/blocks/narratedBlocks.ts", import.meta.url), "utf8");
assert.doesNotMatch(qaVisualSource, /nativeWatchRender/);
assert.match(qaVisualSource, /nativeWatch is retired/);

console.log("No-Gemini production admission tests passed");
