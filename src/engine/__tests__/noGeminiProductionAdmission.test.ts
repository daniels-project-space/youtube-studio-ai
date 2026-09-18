import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  FAMILIES,
  FAMILY_KEYS,
  familyAutonomousPlanningCapability,
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
  "Narrated Stock is admitted only after its OpenRouter Gemini Story-Spine route, local voice evidence, non-Google art QA, and sealed thumbnail exception are registered",
);
assert.deepEqual(narratedReadiness.blockers, []);
assert.equal(familyChannelInceptionCapability("narrated_stock").mode, "registered_non_gemini");

for (const family of ["sleep", "shorts"] as const) {
  const readiness = familyProductionReadiness(family);
  assert.equal(
    readiness.productionReady,
    true,
    `${family} is admitted only through the shared OpenRouter Gemini Story-Spine foundation, explicit format shape, independent visual review, and sealed thumbnail exception`,
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
const illustratedPlanner = familyAutonomousPlanningCapability("illustrated_explainer");
assert.equal(illustratedPlanner.mode, "registered_non_gemini");
if (illustratedPlanner.mode === "registered_non_gemini") {
  assert.match(illustratedPlanner.id, /openrouter-gemini-3-7-flash/);
  assert.doesNotMatch(illustratedPlanner.id, /claude|anthropic/i);
}

const documentaryReadiness = familyProductionReadiness("documentary_collage_short");
assert.equal(
  documentaryReadiness.productionReady,
  true,
  "Documentary Collage Short is admitted only through its finite reviewed official-source season and draft-only DocuMotion route",
);
assert.deepEqual(documentaryReadiness.blockers, []);
assert.equal(
  familyChannelInceptionCapability("documentary_collage_short").mode,
  "registered_non_gemini",
);

for (const family of FAMILY_KEYS.filter(
  (candidate) => !["quizyear", "narrated_stock", "sleep", "shorts", "documentary_collage_short", "cinematic", "music_loop", "whiteboard", "comic", "loreshort", "illustrated_explainer"].includes(candidate),
)) {
  const readiness = familyProductionReadiness(family);
  assert.equal(
    readiness.productionReady,
    false,
    `${family} must not be advertised as production-ready while its non-Gemini automatic planner remains unregistered`,
  );
  assert.match(
    readiness.blockers.join(" "),
    /automatic planning is not registered; still missing/,
    `${family} must explain the actual automatic-planning admission failure`,
  );
  assert.match(readiness.remediation ?? "", /route-owned deterministic or non-Gemini planner\/seal/);
}

const loreReadiness = familyProductionReadiness("loreshort");
assert.equal(loreReadiness.productionReady, false);
assert.ok(
  loreReadiness.blockers.length > 0 && loreReadiness.blockers.every((blocker) =>
    blocker.startsWith("Lore micro-documentary: lore_short:MINIMAX_H3_NOVITA_"),
  ),
  "Lore must expose its actual H3 qualification gate after its non-Gemini planner, route, composition, and inception are registered",
);
assert.equal(familyChannelInceptionCapability("loreshort").mode, "registered_non_gemini");

const musicLoopReadiness = familyProductionReadiness("music_loop");
assert.equal(musicLoopReadiness.productionReady, false);
assert.ok(
  musicLoopReadiness.blockers.length > 0 && musicLoopReadiness.blockers.every((blocker) =>
    blocker.startsWith("Music + looping visual: loop_clips:MINIMAX_H3_NOVITA_"),
  ),
  "Music Loop must expose its actual H3 qualification gate after its original-program route, composition, and inception are registered",
);
assert.equal(familyChannelInceptionCapability("music_loop").mode, "registered_non_gemini");

const cinematicReadiness = familyProductionReadiness("cinematic");
assert.equal(cinematicReadiness.productionReady, false);
assert.ok(
  cinematicReadiness.blockers.some((blocker) => blocker.includes("novita_render_video:MINIMAX_H3_NOVITA_")),
  "Cinematic must expose the qualified MiniMax H3 runtime gate after its non-Gemini planning, route, composition, and inception foundation are registered",
);
assert.equal(familyChannelInceptionCapability("cinematic").mode, "registered_non_gemini");

for (const family of ["whiteboard", "comic"] as const) {
  const readiness = familyProductionReadiness(family);
  assert.equal(readiness.productionReady, true, `${family} must be ready only after the sealed self-contained route, composition, and inception foundation exist`);
  assert.deepEqual(readiness.blockers, []);
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
assert.equal(productionReadyFamilyFallback("documentary_collage_short"), "documentary_collage_short");
assert.equal(
  productionReadyFamilyFallback("illustrated_explainer"),
  "illustrated_explainer",
  "the local illustrated creator remains selectable only when Illustrated Explainer was requested",
);

const inceptionSource = readFileSync(new URL("../../trigger/designChannelInception.ts", import.meta.url), "utf8");
const staticAdmissionGate = inceptionSource.indexOf("const certifiedAdmission = certifiedFamilyAdmission(payload.family);");
const runtimeAdmissionGate = inceptionSource.indexOf(
  "const runtimeReadiness = familyProductionReadiness(payload.family);",
);
const bootstrap = inceptionSource.indexOf("await bootstrapSecrets(log);");
assert.ok(
  staticAdmissionGate >= 0
    && runtimeAdmissionGate >= 0
    && bootstrap >= 0
    && staticAdmissionGate < runtimeAdmissionGate
    && runtimeAdmissionGate < bootstrap,
  "static and H3 runtime family gates must both run before credential bootstrap",
);
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
