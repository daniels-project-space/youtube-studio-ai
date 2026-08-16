import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  FAMILIES,
  FAMILY_KEYS,
  familyProductionReadiness,
  productionReadyFamilyFallback,
} from "@/engine/families";
import { familyChannelInceptionCapability } from "@/engine/channelInceptionCapability";
import { qaVisualCost } from "@/engine/pricing";

const quizyearReadiness = familyProductionReadiness("quizyear");
assert.equal(
  quizyearReadiness.productionReady,
  true,
  "QuizYear is admitted only after its deterministic draft-only creator foundation is wired",
);
assert.deepEqual(quizyearReadiness.blockers, []);
assert.equal(familyChannelInceptionCapability("quizyear").mode, "registered_non_gemini");
assert.equal(
  FAMILIES.quizyear.defaultThumbnailStyle,
  "banana",
  "QuizYear must use the universal Nano Banana thumbnail route",
);
for (const family of FAMILY_KEYS) {
  assert.equal(
    FAMILIES[family].requiresKeys.some((capability) => /gemini|google/i.test(capability)),
    false,
    `${family} must not advertise a general Google/Gemini video dependency; the universal thumbnail boundary is owned by thumbnail_gen rather than the family media profile`,
  );
  assert.equal(
    FAMILIES[family].requiresKeys.includes("fal"),
    false,
    `${family} must not advertise FAL as a production-visual requirement; it is thumbnail-only and cannot be a content renderer fallback`,
  );
}

const narratedReadiness = familyProductionReadiness("narrated_stock");
assert.equal(
  narratedReadiness.productionReady,
  true,
  "Narrated Stock is admitted only after its Claude/Story-Spine route, local voice evidence, non-Google art QA, and sealed thumbnail exception are registered",
);
assert.deepEqual(narratedReadiness.blockers, []);
assert.equal(familyChannelInceptionCapability("narrated_stock").mode, "registered_non_gemini");

for (const family of ["sleep", "shorts"] as const) {
  const readiness = familyProductionReadiness(family);
  assert.equal(
    readiness.productionReady,
    true,
    `${family} is admitted only through the shared Claude/Story-Spine foundation, explicit format shape, independent visual review, and sealed thumbnail exception`,
  );
  assert.deepEqual(readiness.blockers, []);
  assert.equal(familyChannelInceptionCapability(family).mode, "registered_non_gemini");
}

const illustratedReadiness = familyProductionReadiness("illustrated_explainer");
assert.equal(
  illustratedReadiness.productionReady,
  true,
  "Illustrated Explainer is admitted only after its local deterministic foundation and sealed Nano Banana thumbnail route are wired",
);
assert.deepEqual(illustratedReadiness.blockers, []);
assert.equal(familyChannelInceptionCapability("illustrated_explainer").mode, "registered_non_gemini");
assert.equal(FAMILIES.illustrated_explainer.defaultThumbnailStyle, "banana");

for (const family of FAMILY_KEYS.filter(
  (candidate) => !["quizyear", "narrated_stock", "sleep", "shorts", "illustrated_explainer"].includes(candidate),
)) {
  const readiness = familyProductionReadiness(family);
  assert.equal(
    readiness.productionReady,
    false,
    `${family} must not be advertised as production-ready while its non-Gemini automatic planner remains unregistered`,
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
  "a blocked cinematic family must not be silently substituted with unrelated QuizYear output",
);
assert.equal(
  productionReadyFamilyFallback("quizyear"),
  "quizyear",
  "the fully registered deterministic channel creator remains selectable only when QuizYear was requested",
);
assert.equal(
  productionReadyFamilyFallback("narrated_stock"),
  "narrated_stock",
  "the admitted reusable narrated route remains selectable only when it was requested",
);
assert.equal(productionReadyFamilyFallback("sleep"), "sleep");
assert.equal(productionReadyFamilyFallback("shorts"), "shorts");
assert.equal(
  productionReadyFamilyFallback("illustrated_explainer"),
  "illustrated_explainer",
  "the local illustrated creator remains selectable only when Illustrated Explainer was requested",
);

const inceptionSource = readFileSync(new URL("../../trigger/designChannelInception.ts", import.meta.url), "utf8");
const readinessGate = inceptionSource.indexOf("const runtimeReadiness = familyProductionReadiness(payload.family);");
const bootstrap = inceptionSource.indexOf("await bootstrapSecrets(log);");
assert.ok(readinessGate >= 0 && bootstrap >= 0 && readinessGate < bootstrap);
const quizyearBranch = inceptionSource.indexOf('if (payload.family === "quizyear")');
assert.ok(quizyearBranch >= 0 && quizyearBranch < bootstrap);
assert.match(inceptionSource, /buildAndPersistQuizYearFoundation/);
const illustratedBranch = inceptionSource.indexOf('if (payload.family === "illustrated_explainer")');
assert.ok(illustratedBranch >= 0 && illustratedBranch < bootstrap);
assert.match(inceptionSource, /buildAndPersistIllustratedFoundation/);
assert.match(inceptionSource, /zeroSpendDraft: true/);

assert.equal(
  qaVisualCost({ nativeWatch: true }),
  qaVisualCost({}),
  "retired nativeWatch must not reserve a native Gemini video-review call",
);

const qaVisualSource = readFileSync(new URL("../../trigger/blocks/narratedBlocks.ts", import.meta.url), "utf8");
assert.doesNotMatch(qaVisualSource, /nativeWatchRender/);
assert.match(qaVisualSource, /nativeWatch is retired/);

console.log("No-Gemini production admission tests passed");
