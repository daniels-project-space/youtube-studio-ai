import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pipeline = readFileSync(new URL("../runPipeline.ts", import.meta.url), "utf8");
const topicSelect = readFileSync(
  new URL("../blocks/lofiBlocks.ts", import.meta.url),
  "utf8",
);

const selectorPreflight = pipeline.indexOf("const narrativeSelectorPreflightInput = durableInvocation");
const planReload = pipeline.indexOf("getNarrativeSeriesPlanRecord({", selectorPreflight);
const bootstrap = pipeline.indexOf("await bootstrapSecrets(");
const selectorAdmission = pipeline.indexOf("const narrativeSelectorInput = durableInvocation");
const selectorSeed = pipeline.indexOf("narrativeSeriesRunAdmissionSeed(narrativeSeriesAdmission)");
const postAdmissionBootstrap = pipeline.indexOf("await bootstrapSecrets(", selectorSeed);
assert.ok(selectorPreflight >= 0, "run-pipeline must preflight an immutable narrative selector before credential setup");
assert.ok(planReload > selectorPreflight, "the selector preflight must reload the persisted immutable plan server-side");
assert.ok(
  selectorPreflight < bootstrap && planReload < bootstrap,
  "a mismatched narrative selector must fail before credential bootstrap or any provider stage",
);
assert.ok(
  selectorAdmission > bootstrap && selectorSeed > selectorAdmission && selectorSeed < postAdmissionBootstrap,
  "the full route-bound selector admission must still freeze its seed before general provider hydration",
);
const genericScheduleBoundary = pipeline.indexOf("assertNarrativeSeriesNoGenericSchedule({");
const genericPlanRead = pipeline.indexOf("api.contentPlan.getClaimedPlanItemForRun");
assert.ok(
  genericScheduleBoundary >= 0 && genericScheduleBoundary < genericPlanRead,
  "selected narrative runs must reject generic contentPlan before its item is read",
);
assert.doesNotMatch(
  pipeline,
  /narrativeSeriesStateApi\.recordCharacterLoRATrainingRequest|narrativeSeriesStateApi\.acceptCharacterLoRA/,
  "run-pipeline must never train or accept a character LoRA during an episode run",
);

const serialFirst = topicSelect.indexOf("assertNarrativeSeriesNoGenericTopicFastPath({");
const frozenContinuation = topicSelect.indexOf("continueFrozenNarrativeSeriesEpisode({", serialFirst);
const plannedFastPath = topicSelect.indexOf('if (typeof plannedTopic === "string" && plannedTopic.trim())');
assert.ok(serialFirst >= 0 && frozenContinuation > serialFirst, "narrative topic selection must use the frozen serial continuation");
assert.ok(
  serialFirst < plannedFastPath && frozenContinuation < plannedFastPath,
  "generic plannedTopic cannot reach a selected narrative series before serial admission",
);

console.log("narrative series run-pipeline wiring tests passed");
