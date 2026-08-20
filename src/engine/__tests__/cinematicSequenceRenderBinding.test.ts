import assert from "node:assert/strict";

import { CINEMATIC_CASE_SEQUENCE_VERSION } from "@/engine/cinematicCaseSequence";
import {
  assertCinematicAssemblyRoute,
  assertCinematicSequenceRenderBinding,
} from "@/engine/cinematicSequenceRenderBinding";
import { GENERATED_FOOTAGE_SCENE_MANIFEST_VERSION } from "@/engine/generatedFootageManifest";
import { CINEMATIC_KEYFRAME_REVIEW_VERSION } from "@/engine/cinematicKeyframeReview";
import { CINEMATIC_CLIP_REVIEW_VERSION } from "@/engine/cinematicClipReview";
import { CINEMATIC_TRANSITION_REVIEW_VERSION } from "@/engine/cinematicTransitionReview";

const fingerprint = "a".repeat(64);
const scenes = [0, 1].map((index) => ({
  id: `cinematic-shot-binding-${index + 1}`,
  sequenceBeatId: "cinematic-beat-binding",
  parentShotIds: ["shot-binding"],
  claimIds: ["claim-binding"],
  sourceIds: ["source-binding"],
  t0: index * 3,
  t1: (index + 1) * 3,
  durationSec: 3,
  still: `Evidence-led anonymous reconstruction shot ${index + 1} with cited archival object.`,
  motion: "A restrained motivated camera move holds anonymous mannequin continuity and the evidence object.",
  diegeticSoundscape: "Restrained archive room tone and paper movement motivated only by the visible evidence object; no dialogue, narration, or score.",
  negative: "no text, no real-person likeness, no gore",
  cameraMove: index === 0 ? "dolly_push" as const : "truck_left" as const,
  shotScale: index === 0 ? "close" as const : "wide" as const,
  lens: "50mm",
  visualMode: "source_proof" as const,
  coveragePurpose: "evidence_insert" as const,
  cutReason: index === 0 ? "new_fact" as const : "reveal" as const,
  tensionState: index === 0 ? "pressure" as const : "reversal" as const,
  castIds: index === 0 ? [] : ["mannequin-investigator"],
  continuitySeed: index + 1,
}));

const args = {
  scenePlan: {
    version: CINEMATIC_CASE_SEQUENCE_VERSION,
    sequenceFingerprint: fingerprint,
    sourcePacketFingerprint: "b".repeat(64),
    evidenceShotMapFingerprint: "c".repeat(64),
    durationSec: 6,
    scenes,
    release: "private_human_editorial_review_only" as const,
  },
  editDecisionList: {
    version: CINEMATIC_CASE_SEQUENCE_VERSION,
    sequenceFingerprint: fingerprint,
    durationSec: 6,
    edits: scenes.map((scene) => ({
      shotId: scene.id,
      t0: scene.t0,
      t1: scene.t1,
      cutReason: scene.cutReason,
      tensionState: scene.tensionState,
      narrationPurpose: "Advance the supported causal question with a motivated visual turn.",
    })),
  },
  footageManifest: {
    version: GENERATED_FOOTAGE_SCENE_MANIFEST_VERSION,
    source: "cinematic_case_sequence" as const,
    sequenceFingerprint: fingerprint,
    exactOrder: true as const,
    durationSec: 6,
    items: scenes.map((scene, index) => ({
      sceneId: scene.id,
      clipKey: `runs/case/${scene.id}.mp4`,
      t0: scene.t0,
      t1: scene.t1,
      continuitySeed: scene.continuitySeed,
      keyframeReview: {
        version: CINEMATIC_KEYFRAME_REVIEW_VERSION,
        reviewer: "non_google_vision" as const,
        sceneId: scene.id,
        reviewedAgainstSceneIds: [],
        expectedCastIds: scene.castIds,
        forbidAdditionalPeople: true as const,
        onlyExpectedCastVisible: true as const,
        semanticAlignment: 0.9,
        composition: 0.9,
        continuity: 0.9,
        artifactFree: 0.9,
        textWatermarkFree: true as const,
        pass: true as const,
        notes: ["Independent keyframe gate accepted the source frame."],
      },
      clipReview: {
        version: CINEMATIC_CLIP_REVIEW_VERSION,
        reviewer: "non_google_vision" as const,
        sceneId: scene.id,
        sampleOffsetsSec: [0.2, 1.5, 2.8],
        expectedCastIds: scene.castIds,
        forbidAdditionalPeople: true as const,
        onlyExpectedCastVisible: true as const,
        semanticAlignment: 0.9,
        motionIntegrity: 0.9,
        continuity: 0.9,
        endBeat: 0.9,
        artifactFree: 0.9,
        textWatermarkFree: true as const,
        pass: true as const,
        notes: ["Independent clip gate accepted the actual LTX take."],
      },
      ...(index < scenes.length - 1 ? {
        transitionToNextReview: {
          version: CINEMATIC_TRANSITION_REVIEW_VERSION,
          reviewer: "non_google_vision" as const,
          fromSceneId: scene.id,
          toSceneId: scenes[index + 1]!.id,
          cutReason: scenes[index + 1]!.cutReason,
          tensionState: scenes[index + 1]!.tensionState,
          semanticContinuity: 0.9,
          visualProgression: 0.9,
          cutMotivation: 0.9,
          artifactFree: 0.9,
          textWatermarkFree: true as const,
          pass: true as const,
          notes: ["The outgoing proof frame motivates the incoming reveal."],
        },
      } : {}),
    })),
  },
  narrationDurationSec: 6,
};

assert.equal(assertCinematicSequenceRenderBinding(args).footageManifest.items.length, 2);

assert.throws(
  () => assertCinematicAssemblyRoute({
    useAssemblyEdl: true,
    scenePlan: args.scenePlan,
    editDecisionList: args.editDecisionList,
    footageManifest: args.footageManifest,
  }),
  /exact clip-order assembler.*no cinematic real-render parity proof/i,
  "an unproven generic assembler must never replace exact source-bound cinematic assembly",
);
assert.doesNotThrow(() => assertCinematicAssemblyRoute({
  useAssemblyEdl: false,
  scenePlan: args.scenePlan,
  editDecisionList: args.editDecisionList,
  footageManifest: args.footageManifest,
}));

const reordered = structuredClone(args);
[reordered.footageManifest.items[0], reordered.footageManifest.items[1]] = [
  reordered.footageManifest.items[1],
  reordered.footageManifest.items[0],
];
assert.throws(
  () => assertCinematicSequenceRenderBinding(reordered),
  /transition review before the next cut|not bound to its approved scene.*edit window/,
  "a renderer receipt may not reorder reviewed cuts",
);

const changedSeed = structuredClone(args);
changedSeed.footageManifest.items[0]!.continuitySeed = 999;
assert.throws(
  () => assertCinematicSequenceRenderBinding(changedSeed),
  /continuity seed/,
  "the final render receipt must retain the approved mannequin continuity prior",
);

const missingTransition = structuredClone(args);
delete (missingTransition.footageManifest.items[0] as { transitionToNextReview?: unknown }).transitionToNextReview;
assert.throws(
  () => assertCinematicSequenceRenderBinding(missingTransition),
  /independent transition review/,
  "each actual LTX cut needs its own pixel-level transition evidence",
);

const narrationDrift = structuredClone(args);
narrationDrift.narrationDurationSec = 6.2;
assert.throws(
  () => assertCinematicSequenceRenderBinding(narrationDrift),
  /do not bind the same exact reviewed sequence/,
  "edited cinematic timings must remain attached to the actual narration",
);

const undeclaredExtraPerson = structuredClone(args);
undeclaredExtraPerson.footageManifest.items[0]!.keyframeReview.expectedCastIds = ["mannequin-unapproved"];
assert.throws(
  () => assertCinematicSequenceRenderBinding(undeclaredExtraPerson),
  /sealed no-extra-people cast contract.*cast contract/i,
  "a keyframe receipt that admits an undeclared person cannot reach LTX/assembly binding",
);

console.log("Cinematic sequence render binding tests passed");
