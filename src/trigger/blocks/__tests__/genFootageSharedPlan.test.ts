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
      terminalStill: `Cited consequence frame ${index + 1} preserves the anonymous role and evidence setting.`,
      motion: "Restrained camera motion preserves the cited evidence and the faceless role continuity.",
      diegeticSoundscape: "Paper handling and restrained archive room tone only; no dialogue or score.",
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
assert.deepEqual(cinematicPlan.scenes[0]!.expectedCastIds, [], "an empty sealed cinematic cast must reach the render gate as an explicit no-people contract");
assert.equal(cinematicPlan.scenes[0]!.forbidAdditionalPeople, true, "every cinematic LTX scene must prohibit undeclared people/mannequins");
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
  cinematicPlan.scenes[0]!.diegeticSoundscape,
  cinematicStore.cinematicGeneratedScenePlan.scenes[0]!.diegeticSoundscape,
  "shot-specific diegetic sound direction must survive the shared-plan adapter unchanged",
);
assert.equal(
  cinematicPlan.scenes[0]!.terminalStill,
  cinematicStore.cinematicGeneratedScenePlan.scenes[0]!.terminalStill,
  "the reviewed terminal keyframe target must survive to the LTX handoff",
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
assert.match(source, /terminalImagePrompt/);
assert.match(source, /motionPrompt: scene\.motion/);
assert.match(source, /seed: scene\.continuitySeed/);
assert.match(source, /LtxCreativeAdapterInputSchema\.optional\(\)\.parse/);
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
    /providers: \["openrouter"\]/,
    `${gate} must scope its purported non-Google evidence to the pinned OpenRouter route rather than accepting a Gemini fallback`,
  );
}

/* --------- Phase 17: nameCardText threading (story_spine → PlannedScene) -- */

const introSpine = planStorySpine({
  topic: "Detective Ayana Okafor opens the cold case",
  narrationDurationSec: 24,
  sentenceTimings: [
    { text: "Detective Ayana Okafor steps into the rain-soaked alley.", start: 0, end: 12 },
    { text: "The case would define the rest of her career.", start: 12, end: 24 },
  ],
  styleDNA: { recurringSubject: "Detective Ayana Okafor" },
  structure: {
    beats: [
      { name: "intro", note: "introduce the detective", narrativeRole: "introduction", nameCardText: "DETECTIVE AYANA OKAFOR" },
      { name: "stakes", note: "raise the stakes" },
    ],
  },
});
const introStore = {
  timedScript: introSpine.timedScript,
  narrativeBeats: introSpine.narrativeBeats,
  continuityLedger: introSpine.continuityLedger,
  shotList: introSpine.shotList,
  dpVisualSpecs: introSpine.dpVisualSpecs,
  editorEdl: introSpine.editorEdl,
  storyCoverage: introSpine.coverage,
};
const introPlan = resolveGeneratedFootageScenePlan({
  store: introStore,
  label: "gen_footage",
  maxScenes: 6,
  minScenes: 2,
  defaultDurationSec: 5,
});
assert.equal(introPlan.source, "story_spine");
const introBeatId = introSpine.narrativeBeats[0]!.id;
const introShotIndex = introSpine.shotList.findIndex((shot) => shot.beatId === introBeatId);
assert.ok(introShotIndex >= 0, "the introduction beat must have produced at least one shot");
assert.equal(
  introPlan.scenes[introShotIndex]!.nameCardText,
  "DETECTIVE AYANA OKAFOR",
  "scenePlanFromStorySpine must thread ShotPlan.nameCardText onto the matching PlannedScene",
);
for (const [index, scene] of introPlan.scenes.entries()) {
  if (index === introShotIndex) continue;
  assert.equal(scene.nameCardText, undefined, "no other scene may inherit the introduction shot's name card");
}
// A cinematic_case_sequence plan never carries story_spine's nameCardText —
// gen_footage.run gates its overlay call on plan.source === "story_spine".
assert.equal(cinematicPlan.scenes[0]!.nameCardText, undefined);

const genFootageSource = readFileSync(new URL("../genFootageBlocks.ts", import.meta.url), "utf8");
assert.match(genFootageSource, /import \{ applyNameCardOverlay \} from "@\/lib\/ffmpeg";/);
assert.match(
  genFootageSource,
  /plan\.source === "story_spine" \? scenes\[index\]\?\.nameCardText : undefined/,
  "the name-card overlay must be gated to the automatic story_spine path, never the Casefile cinematic_case_sequence route",
);
assert.match(
  genFootageSource,
  /required name-card overlay failed on scene/,
  "a planned deterministic name card must fail closed rather than silently shipping a clip without it",
);

/* ------- Phase 18: realImageInsertQuery + evidenceOverlay threading ------ */

const phase18Spine = planStorySpine({
  topic: "phase 18 probe",
  narrationDurationSec: 32,
  targetShotSec: 6,
  sentenceTimings: [
    { text: "Detective Ayana Okafor opens the old case file in the archive.", start: 0, end: 8 },
    { text: "The torn photograph revealed a second man standing in the doorway.", start: 8, end: 16 },
    { text: "New evidence in the forensic report changed everything about the timeline.", start: 16, end: 24 },
    { text: "By morning, the department reopened the case.", start: 24, end: 32 },
  ],
});
// Ground truth for this exact fixture (verified by running planStorySpine
// directly): shot-0001 establish, shot-0002 investigate ("evidence"),
// shot-0003/shot-0004 reveal ("revealed"), shot-0007/shot-0008 advance.
assert.deepEqual(
  phase18Spine.shotList.map((shot) => shot.id),
  ["shot-0001", "shot-0002", "shot-0003", "shot-0004", "shot-0005", "shot-0006", "shot-0007", "shot-0008"],
);
assert.match(phase18Spine.shotList[1]!.coveragePurpose, /evidence/, "shot-0002 must be the investigate-bucket shot");
assert.match(phase18Spine.shotList[2]!.coveragePurpose, /contradiction/, "shot-0003 must be a reveal-bucket shot");
assert.match(phase18Spine.shotList[3]!.coveragePurpose, /contradiction/, "shot-0004 must be a reveal-bucket shot");

// realImageInsertQuery is schema-only (not threaded through planStorySpine —
// see storySpine.ts's doc comment on the field): inject it directly onto a
// shotList entry post-hoc, the same way the `bakedText` fixture above
// injects a keyframePrompt directly rather than going through planStorySpine.
const phase18Store = structuredClone({
  timedScript: phase18Spine.timedScript,
  narrativeBeats: phase18Spine.narrativeBeats,
  continuityLedger: phase18Spine.continuityLedger,
  shotList: phase18Spine.shotList,
  dpVisualSpecs: phase18Spine.dpVisualSpecs,
  editorEdl: phase18Spine.editorEdl,
  storyCoverage: phase18Spine.coverage,
});
phase18Store.shotList[0]!.realImageInsertQuery = "Marcus Aurelius bust";

const phase18Plan = resolveGeneratedFootageScenePlan({
  store: phase18Store,
  label: "gen_footage",
  maxScenes: 8,
  minScenes: 4,
  defaultDurationSec: 5,
});
assert.equal(phase18Plan.source, "story_spine");
assert.equal(
  phase18Plan.scenes[0]!.realImageInsertQuery,
  "Marcus Aurelius bust",
  "resolveGeneratedFootageScenePlan must thread ShotPlan.realImageInsertQuery onto the matching PlannedScene",
);
for (const [index, scene] of phase18Plan.scenes.entries()) {
  if (index === 0) continue;
  assert.equal(scene.realImageInsertQuery, undefined, "no other scene may inherit shot-0001's real-image-insert query");
}

// Evidence overlay: budgeted to 2, earliest-t0-wins — shot-0002
// (investigate/"contradiction" role -> evidence_tag) and shot-0003
// (reveal/"reveal" role -> case_file_stamp) win; shot-0004 (also reveal, but
// later) is capped out.
assert.equal(phase18Plan.scenes[0]!.evidenceOverlay, undefined, "the establish-bucket shot must never get an evidence overlay");
assert.deepEqual(
  phase18Plan.scenes[1]!.evidenceOverlay,
  { templateId: "evidence_tag", primary: "SEC. 001", secondary: undefined },
  "the investigate-bucket shot must get the evidence_tag template with a section-derived primary label",
);
assert.equal(phase18Plan.scenes[2]!.evidenceOverlay?.templateId, "case_file_stamp", "the reveal-bucket shot must get the case_file_stamp template");
assert.equal(phase18Plan.scenes[3]!.evidenceOverlay, undefined, "the third eligible shot must be capped out by the default budget of 2");
for (const index of [4, 5, 6, 7]) {
  assert.equal(phase18Plan.scenes[index]!.evidenceOverlay, undefined, `scene ${index} (investigate/advance beyond the budget) must not get an overlay`);
}
// A cinematic_case_sequence plan never carries story_spine's evidenceOverlay
// or realImageInsertQuery — gen_footage.run gates both on plan.source.
assert.equal(cinematicPlan.scenes[0]!.evidenceOverlay, undefined);
assert.equal(cinematicPlan.scenes[0]!.realImageInsertQuery, undefined);

const phase18Source = readFileSync(new URL("../genFootageBlocks.ts", import.meta.url), "utf8");
assert.match(phase18Source, /import \{ kenBurns, applyHyperframesOverlayClip \} from "@\/lib\/ffmpeg";/);
assert.match(phase18Source, /import \{ searchWikimediaImage \} from "@\/lib\/wikimedia";/);
assert.match(
  phase18Source,
  /import \{ renderOverlay, selectAutomaticEvidenceOverlayShots, type OverlayTemplateId \} from "@\/lib\/hyperframesOverlay";/,
);
assert.match(
  phase18Source,
  /plan\.source === "story_spine" \? plannedScene\.realImageInsertQuery : undefined/,
  "the real-image insert must be gated to the automatic story_spine path",
);
assert.match(
  phase18Source,
  /plan\.source === "story_spine" \? scenes\[index\]\?\.evidenceOverlay : undefined/,
  "the evidence overlay must be gated to the automatic story_spine path",
);
assert.match(
  phase18Source,
  /const ltxScenes = scenes\.filter\(\(scene\) => scene\.sourceProofMedia === undefined\);/,
  "approved cinematic source-proof scenes must be removed from the LTX render wave",
);
assert.match(
  phase18Source,
  /scenes: ltxScenes\.map\(\(scene\) => \(/,
  "the Novita handoff must receive only non-source-proof scenes",
);
assert.ok(
  phase18Source.indexOf("const sourceProofBySceneId") < phase18Source.indexOf("const rendered = ltxScenes.length > 0"),
  "approved source media must be resolved and hash-gated before any cinematic LTX render starts",
);
assert.match(
  phase18Source,
  /real-image insert failed on scene .* using the generated clip instead/,
  "a real-image-insert failure must degrade to the generated clip, never fail the whole render",
);
assert.match(
  phase18Source,
  /required evidence overlay failed on scene/,
  "a planned evidence overlay must fail closed rather than silently shipping a clip without it",
);
assert.match(
  phase18Source,
  /footageOnScreenTextCues\(/,
  "successful deterministic text overlays must emit body-relative OCR obligations for final QA",
);
assert.match(
  phase18Source,
  /selectLtxStyleForChannel\(/,
  "generated cinematic footage must resolve its treatment from the sealed channel identity rather than a hardcoded look",
);
assert.match(
  phase18Source,
  /styleId: ltxStyleSelection\.styleId/,
  "the selected treatment must reach the Novita LTX render handoff",
);
assert.match(
  phase18Source,
  /ltxStyleId: ltxStyleSelection\.styleId/,
  "the treatment used for pixels must be retained for final assembly and retry",
);
// The generated-clip download call must still be present unconditionally
// (as the fallback / default path) even after the real-image-insert branch
// was added. Its durable-output transfer must also stay bounded so a hung
// delivery cannot outlive the task and replay paid work.
assert.match(
  phase18Source,
  /downloadTo\(scene\.clipUrl, join\(tmp, `gen_\$\{index\}\.mp4`\), \{\s*timeoutMs: DURABLE_RENDER_OUTPUT_DOWNLOAD_TIMEOUT_MS,?\s*\}\)/,
);

console.log("Phase 18 (evidence overlays + real-image insert) shared-plan tests passed");

console.log("Generated footage shared-plan tests passed");
