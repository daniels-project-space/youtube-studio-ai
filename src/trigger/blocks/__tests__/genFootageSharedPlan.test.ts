import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { planStorySpine } from "@/engine/storySpine";
import {
  assertCentralNovitaSelection,
  resolveGeneratedFootageScenePlan,
} from "@/trigger/blocks/genFootageBlocks";

const spine = planStorySpine({
  topic: "How a missing archive photograph changed the case",
  narrationDurationSec: 24,
  sentenceTimings: [
    { text: "The archive box arrived with one photograph missing from the index.", start: 0, end: 6 },
    { text: "A careful comparison of the paper revealed it came from a different case file.", start: 6, end: 12 },
    { text: "The catalog number led the researcher to a long-forgotten newspaper room.", start: 12, end: 18 },
    { text: "That new evidence reframed what happened on the night in question.", start: 18, end: 24 },
  ],
  styleDNA: {
    recurringSubject: "archival investigator at a case-file desk",
    setting: "rainy city records room",
    colorGrade: "grounded amber-and-charcoal documentary",
    visualAvoid: ["logos"],
  },
  generationProfile: "production",
  targetShotSec: 6,
});

const store = {
  timedScript: spine.timedScript,
  narrativeBeats: spine.narrativeBeats,
  continuityLedger: spine.continuityLedger,
  shotList: spine.shotList,
  dpVisualSpecs: spine.dpVisualSpecs,
  editorEdl: spine.editorEdl,
  storyCoverage: spine.coverage,
};

const plan = resolveGeneratedFootageScenePlan({
  store,
  label: "gen_footage",
  maxScenes: 6,
  minScenes: 4,
  defaultDurationSec: 5,
  avoid: "logos",
});
assert.equal(plan.source, "story_spine");
assert.equal(plan.scenes.length, 4);
assert.equal(plan.scenes[0].cameraMove, spine.shotList[0].cameraMove);
assert.equal(plan.scenes[0].negative, "logos");
assert.doesNotMatch(plan.scenes[0].still, /\bno text\b/i, "renderer appends its own no-text rail");

const bakedText = structuredClone(store);
bakedText.dpVisualSpecs[0].keyframePrompt = "A bold title card reading The Missing Photograph in an archive room.";
assert.throws(
  () => resolveGeneratedFootageScenePlan({
    store: bakedText,
    label: "gen_footage",
    maxScenes: 6,
    minScenes: 4,
    defaultDurationSec: 5,
  }),
  /baked-in text or lettering/,
);

assert.throws(
  () => resolveGeneratedFootageScenePlan({
    store: {},
    label: "gen_footage",
    maxScenes: 6,
    minScenes: 4,
    defaultDurationSec: 5,
  }),
  /requires a validated shared scene plan/,
  "missing planning evidence must fail before any provider is invoked",
);

assert.doesNotThrow(() => assertCentralNovitaSelection("novita-ltx", "gen_footage"));
assert.throws(
  () => assertCentralNovitaSelection("Lightricks/LTX-2.5", "gen_footage"),
  /centrally attested Novita production profile/,
);

const source = readFileSync(new URL("../genFootageBlocks.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /\b(?:geminiJson|hasGeminiKey|hasNovitaRenderBridge|planCoverage)\b/);
assert.doesNotMatch(source, /Lightricks\/LTX-2\.5/);

console.log("Generated footage shared-plan tests passed");
