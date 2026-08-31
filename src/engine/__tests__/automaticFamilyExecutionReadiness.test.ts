import assert from "node:assert/strict";

import {
  assessAutomaticFamilyExecutionReadiness,
  automaticFamilyExecutionReadinessAdmission,
  requiresAutomaticFamilyExecutionReadiness,
} from "@/engine/automaticFamilyExecutionReadiness";
import { certifiedFamilyAdmission } from "@/engine/certifiedFamilyAdmission";
import { FAMILY_KEYS } from "@/engine/families";

const allReady = {
  whiteboardReady: () => true,
  comicReady: () => true,
  thumbnailRouteReady: () => true,
  nonGoogleVisionReady: () => true,
  topicPlannerReady: () => true,
  narrationReady: () => true,
  footageReady: () => true,
  musicReady: () => true,
};

assert.deepEqual(
  assessAutomaticFamilyExecutionReadiness("whiteboard", allReady),
  { family: "whiteboard", ready: true, scope: "live_renderer_stack", blockers: [] },
);
assert.deepEqual(
  assessAutomaticFamilyExecutionReadiness("comic", allReady),
  { family: "comic", ready: true, scope: "live_renderer_stack", blockers: [] },
);
assert.equal(
  assessAutomaticFamilyExecutionReadiness("whiteboard", { ...allReady, whiteboardReady: () => false }).ready,
  false,
  "whiteboard must not claim automatic execution when its real renderer stack is missing",
);
assert.equal(
  assessAutomaticFamilyExecutionReadiness("comic", { ...allReady, comicReady: () => false }).ready,
  false,
  "comic must not claim automatic execution when its real renderer stack is missing",
);
assert.deepEqual(
  assessAutomaticFamilyExecutionReadiness("narrated_stock", {
    whiteboardReady: () => { throw new Error("unrelated capability must not be checked"); },
    comicReady: () => { throw new Error("unrelated capability must not be checked"); },
    thumbnailRouteReady: () => true,
    nonGoogleVisionReady: () => true,
    topicPlannerReady: () => true,
    narrationReady: () => true,
    footageReady: () => true,
    musicReady: () => true,
  }),
  { family: "narrated_stock", ready: true, scope: "live_pipeline_stack", blockers: [] },
  "unrelated renderer checks must not run for a narrated channel",
);
assert.equal(
  assessAutomaticFamilyExecutionReadiness("narrated_stock", {
    ...allReady,
    thumbnailRouteReady: () => false,
  }).ready,
  false,
  "every automatic family must stop before setup when its universal thumbnail foundation is unavailable",
);
assert.equal(
  assessAutomaticFamilyExecutionReadiness("quizyear", {
    ...allReady,
    nonGoogleVisionReady: () => false,
  }).ready,
  false,
  "every automatic family must stop before setup when its final visual-QA foundation is unavailable",
);
assert.equal(
  assessAutomaticFamilyExecutionReadiness("illustrated_explainer", {
    ...allReady,
    topicPlannerReady: () => false,
  }).ready,
  false,
  "a compiled topic-planning lane must not defer a missing planner until after channel setup",
);
assert.equal(
  assessAutomaticFamilyExecutionReadiness("shorts", {
    ...allReady,
    footageReady: () => false,
  }).ready,
  false,
  "a compiled stock-footage lane must not defer a missing footage provider until after channel setup",
);
assert.equal(
  assessAutomaticFamilyExecutionReadiness("quizyear", {
    ...allReady,
    musicReady: () => false,
  }).ready,
  false,
  "a compiled music lane must not defer a missing music provider until after channel setup",
);

for (const family of FAMILY_KEYS.filter((key) => certifiedFamilyAdmission(key).automatic)) {
  assert.equal(
    assessAutomaticFamilyExecutionReadiness(family, {
      ...allReady,
      thumbnailRouteReady: () => false,
    }).ready,
    false,
    `${family} must fail before setup when its universal thumbnail foundation is unavailable`,
  );
  assert.equal(
    assessAutomaticFamilyExecutionReadiness(family, {
      ...allReady,
      nonGoogleVisionReady: () => false,
    }).ready,
    false,
    `${family} must fail before setup when its universal final visual-QA foundation is unavailable`,
  );
}

assert.equal(requiresAutomaticFamilyExecutionReadiness("quizyear"), true);
assert.equal(requiresAutomaticFamilyExecutionReadiness("cinematic"), false);
assert.equal(requiresAutomaticFamilyExecutionReadiness("not-a-family"), false);
assert.deepEqual(
  automaticFamilyExecutionReadinessAdmission("quizyear", allReady),
  {
    applies: true,
    automatic: true,
    reason: "automatic live execution stack is ready",
    assessment: { family: "quizyear", ready: true, scope: "live_pipeline_stack", blockers: [] },
  },
  "an automatic family may continue only when its currently hydrated live stack is ready",
);
const missingRuntime = automaticFamilyExecutionReadinessAdmission("quizyear", {
  ...allReady,
  nonGoogleVisionReady: () => false,
});
assert.equal(missingRuntime.applies, true);
assert.equal(missingRuntime.automatic, false);
assert.match(missingRuntime.reason, /final visual-QA provider/);
assert.deepEqual(
  automaticFamilyExecutionReadinessAdmission("cinematic", {
    whiteboardReady: () => { throw new Error("supervised routes must not probe automatic capabilities"); },
    comicReady: () => { throw new Error("supervised routes must not probe automatic capabilities"); },
    thumbnailRouteReady: () => { throw new Error("supervised routes must not probe automatic capabilities"); },
    nonGoogleVisionReady: () => { throw new Error("supervised routes must not probe automatic capabilities"); },
    topicPlannerReady: () => { throw new Error("supervised routes must not probe automatic capabilities"); },
    narrationReady: () => { throw new Error("supervised routes must not probe automatic capabilities"); },
    footageReady: () => { throw new Error("supervised routes must not probe automatic capabilities"); },
    musicReady: () => { throw new Error("supervised routes must not probe automatic capabilities"); },
  }),
  {
    applies: false,
    automatic: true,
    reason: "live automatic execution readiness does not apply to this route",
  },
  "supervised routes keep their dedicated route/runtime fences",
);

console.log("Automatic family execution readiness tests passed");
