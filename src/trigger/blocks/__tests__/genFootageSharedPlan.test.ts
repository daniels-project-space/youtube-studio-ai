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
  /requires an admitted cinematic_case_sequence, validated story_spine/,
  "missing planning evidence must fail before any provider is invoked",
);

assert.throws(
  () => resolveGeneratedFootageScenePlan({
    store: { ...store, casefileEvidenceShotMap: {} },
    label: "gen_footage",
    maxScenes: 6,
    minScenes: 4,
    defaultDurationSec: 5,
  }),
  /Casefile evidence is present but its admitted cinematic_case_sequence is missing/,
  "Casefile source evidence must never degrade into a generic Story Spine render",
);

const cinematicStore = {
  cinematicGeneratedScenePlan: {
    version: "cinematic-case-sequence/v1" as const,
    sequenceFingerprint: "c".repeat(64),
    sourcePacketFingerprint: "b".repeat(64),
    evidenceShotMapFingerprint: "e".repeat(64),
    durationSec: 12,
    release: "private_human_editorial_review_only" as const,
    scenes: [0, 1, 2, 3].map((index) => ({
      id: `cinematic-shot-proof-${index + 1}`,
      sequenceBeatId: "cinematic-beat-proof",
      parentShotIds: ["shot-proof"],
      claimIds: ["claim-proof"],
      sourceIds: ["source-proof"],
      t0: index * 3,
      t1: (index + 1) * 3,
      durationSec: 3,
      still: `Cited archival evidence frame ${index + 1} in an anonymous documentary reconstruction.`,
      motion: "Restrained camera motion preserves the cited evidence and the faceless role continuity.",
      negative: "no text, no likeness, no gore",
      cameraMove: index % 2 === 0 ? "dolly_push" : "truck_left",
      shotScale: index % 2 === 0 ? "close" : "wide",
      lens: "50mm",
      visualMode: "source_proof" as const,
      coveragePurpose: "evidence_insert" as const,
      cutReason: "new_fact" as const,
      tensionState: "pressure" as const,
      castIds: [],
      continuitySeed: index + 1,
    })),
  },
};
const cinematicPlan = resolveGeneratedFootageScenePlan({
  store: cinematicStore,
  label: "gen_footage",
  maxScenes: 4,
  minScenes: 4,
  defaultDurationSec: 5,
});
assert.equal(cinematicPlan.source, "cinematic_case_sequence");
assert.equal(cinematicPlan.sequenceFingerprint, "c".repeat(64));
assert.deepEqual(cinematicPlan.scenes.map((scene) => scene.id), [
  "cinematic-shot-proof-1",
  "cinematic-shot-proof-2",
  "cinematic-shot-proof-3",
  "cinematic-shot-proof-4",
]);
assert.equal(
  cinematicPlan.scenes[0]!.still,
  cinematicStore.cinematicGeneratedScenePlan.scenes[0]!.still,
  "cinematic identity/location locks must survive the shared-plan adapter unchanged",
);
assert.equal(
  cinematicPlan.scenes[0]!.motion,
  cinematicStore.cinematicGeneratedScenePlan.scenes[0]!.motion,
  "cinematic movement and first/last-frame constraints must survive the shared-plan adapter unchanged",
);
assert.equal(
  cinematicPlan.scenes[0]!.continuitySeed,
  cinematicStore.cinematicGeneratedScenePlan.scenes[0]!.continuitySeed,
  "the reviewed cinematic continuity seed must reach Novita still generation unchanged",
);
assert.throws(
  () => resolveGeneratedFootageScenePlan({
    store: cinematicStore,
    label: "gen_footage",
    maxScenes: 3,
    minScenes: 2,
    defaultDurationSec: 5,
  }),
  /scenes are never dropped/,
  "reviewed cinematic coverage must fail rather than truncate to a renderer transaction cap",
);

assert.doesNotThrow(() => assertCentralNovitaSelection("novita-ltx", "gen_footage"));
assert.throws(
  () => assertCentralNovitaSelection("Lightricks/LTX-2.5", "gen_footage"),
  /centrally attested Novita production profile/,
);

const source = readFileSync(new URL("../genFootageBlocks.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /\b(?:geminiJson|hasGeminiKey|hasNovitaRenderBridge|planCoverage)\b/);
assert.match(
  source,
  /hasCinematicSequence && !hasNonGoogleVisionKey\(\)/,
  "an admitted cinematic sequence must fail before paid Novita work without an eligible independent reviewer",
);
assert.doesNotMatch(source, /Lightricks\/LTX-2\.5/);
assert.match(source, /imagePrompt: `\$\{scene\.still\}\. Absolutely NO text/);
assert.match(source, /motionPrompt: scene\.motion/);
assert.match(source, /seed: scene\.continuitySeed/);
assert.match(source, /LtxCreativeAdapterSelectionSchema\.optional\(\)\.parse/);
assert.match(source, /creativeAdapter \? \{ creativeAdapter \} : \{\}/);
assert.match(
  source,
  /signatureCreativeAdapter \? \{ creativeAdapter: signatureCreativeAdapter \} : \{\}/,
  "signature LTX clips must use the same sealed creative-adapter route as the main footage lane",
);

for (const gate of ["cinematicKeyframeGate.ts", "cinematicClipGate.ts", "cinematicTransitionGate.ts"]) {
  const gateSource = readFileSync(new URL(`../../../lib/${gate}`, import.meta.url), "utf8");
  assert.match(
    gateSource,
    /providers: \["groq", "fal"\]/,
    `${gate} must scope its purported non-Google evidence to Groq/FAL rather than accepting a Gemini fallback`,
  );
}

console.log("Generated footage shared-plan tests passed");
