import assert from "node:assert/strict";

import { CINEMATIC_CASE_SEQUENCE_VERSION } from "@/engine/cinematicCaseSequence";
import { CINEMATIC_CLIP_REVIEW_VERSION } from "@/engine/cinematicClipReview";
import { CINEMATIC_KEYFRAME_REVIEW_VERSION } from "@/engine/cinematicKeyframeReview";
import { CINEMATIC_TRANSITION_REVIEW_VERSION } from "@/engine/cinematicTransitionReview";
import { GENERATED_FOOTAGE_SCENE_MANIFEST_VERSION } from "@/engine/generatedFootageManifest";
import {
  SOURCE_PROOF_MEDIA_VERSION,
  createSourceProofMediaReceipt,
  sourceProofMediaProvenanceFingerprint,
  type SourceProofMediaObligation,
} from "@/engine/sourceProofMedia";
import {
  assertCinematicAssemblyHandoff,
  createCinematicAssemblyHandoff,
} from "../cinematicHandoff";

const fingerprint = "a".repeat(64);
const scenes = [0, 1].map((index) => ({
  id: `cinematic-shot-handoff-${index + 1}`,
  sequenceBeatId: "cinematic-beat-handoff",
  parentShotIds: ["shot-handoff"],
  claimIds: ["claim-handoff"],
  sourceIds: ["source-handoff"],
  t0: index * 3,
  t1: (index + 1) * 3,
  durationSec: 3,
  still: `A faceless mannequin evidence reconstruction, scene ${index + 1}.`,
  motion: "A restrained motivated camera move holds the evidence detail in frame.",
  diegeticSoundscape: "Restrained room tone and a distant train-platform hum.",
  negative: "no text, no real-person likeness, no gore",
  cameraMove: index === 0 ? "dolly_push" as const : "truck_left" as const,
  shotScale: index === 0 ? "close" as const : "wide" as const,
  lens: "50mm",
  visualMode: "source_proof" as const,
  coveragePurpose: "evidence_insert" as const,
  cutReason: index === 0 ? "new_fact" as const : "reveal" as const,
  tensionState: index === 0 ? "pressure" as const : "reversal" as const,
  castIds: [],
  continuitySeed: index + 1,
}));

const sourceProofObligation: SourceProofMediaObligation = {
  version: SOURCE_PROOF_MEDIA_VERSION,
  sourceId: "source-handoff",
  assetId: "asset-handoff-proof",
  rightsEvidenceLocator: "https://archive.example.org/rights/handoff-proof",
  sourcePacketFingerprint: "b".repeat(64),
  assetUrl: "https://archive.example.org/media/handoff-proof.jpg",
  assetSha256: "c".repeat(64),
  approvalReceiptId: "source-proof-receipt-handoff-proof",
  provenanceFingerprint: "",
};
sourceProofObligation.provenanceFingerprint = sourceProofMediaProvenanceFingerprint(sourceProofObligation);
const sourceProofReceipt = createSourceProofMediaReceipt({
  sceneId: scenes[0]!.id,
  sequenceFingerprint: fingerprint,
  obligation: sourceProofObligation,
  resolvedAssetSha256: sourceProofObligation.assetSha256,
  sourceProofClipSha256: "d".repeat(64),
  clipKey: `runs/case/${scenes[0]!.id}.mp4`,
});

function validArgs() {
  return {
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
}

function validArgsWithSourceProof(): Parameters<typeof createCinematicAssemblyHandoff>[0] {
  const args = validArgs();
  return {
    scenePlan: args.scenePlan,
    editDecisionList: args.editDecisionList,
    footageManifest: {
      ...args.footageManifest,
      items: args.footageManifest.items.map((item, index) => index === 0
        ? {
            sceneId: item.sceneId,
            clipKey: item.clipKey,
            t0: item.t0,
            t1: item.t1,
            continuitySeed: item.continuitySeed,
            sourceProofMediaReceipt: sourceProofReceipt,
            transitionToNextReview: item.transitionToNextReview,
          }
        : item),
    },
    narrationDurationSec: args.narrationDurationSec,
  };
}

const handoff = createCinematicAssemblyHandoff(validArgs());
assert.equal(handoff.manifest.exactOrder, true);
assert.deepEqual(
  handoff.manifest.items.map((item) => [item.sequenceIndex, item.shotId, item.clipKey]),
  scenes.map((scene, index) => [index, scene.id, `runs/case/${scene.id}.mp4`]),
  "handoff preserves the reviewed scene order and exact renderer clip bindings",
);
assert.doesNotThrow(() => assertCinematicAssemblyHandoff(handoff));

const sourceProofHandoff = createCinematicAssemblyHandoff(validArgsWithSourceProof());
assert.equal(
  sourceProofHandoff.manifest.items[0]?.sourceProofMediaReceipt?.receiptFingerprint,
  sourceProofReceipt.receiptFingerprint,
  "exact approved source-proof receipt must survive the cinematic render-to-assembly handoff",
);
const swappedProofReceipt = structuredClone(sourceProofHandoff);
swappedProofReceipt.manifest.items[0]!.sourceProofMediaReceipt!.clipKey = "runs/case/substitute.mp4";
assert.throws(
  () => assertCinematicAssemblyHandoff(swappedProofReceipt),
  /source-proof receipt|fingerprint/i,
  "a resumed handoff cannot substitute a different evidence object key",
);

const reorderedHandoff = structuredClone(handoff);
[reorderedHandoff.manifest.items[0], reorderedHandoff.manifest.items[1]] = [
  reorderedHandoff.manifest.items[1]!,
  reorderedHandoff.manifest.items[0]!,
];
assert.throws(
  () => assertCinematicAssemblyHandoff(reorderedHandoff),
  /sequenceIndex|contiguous|exactly equal/i,
  "a persisted handoff may never reorder reviewed cinematic cuts",
);

const staleFingerprint = structuredClone(handoff);
staleFingerprint.manifest.sequenceFingerprint = "d".repeat(64);
assert.throws(
  () => assertCinematicAssemblyHandoff(staleFingerprint),
  /same sequence fingerprint/i,
  "a resumed handoff fails closed when its EDL belongs to another sequence",
);

const missingBinding = validArgs();
missingBinding.footageManifest.items.pop();
assert.throws(
  () => createCinematicAssemblyHandoff(missingBinding),
  /final cinematic clip|do not bind the same exact reviewed sequence/i,
  "assembly cannot begin when one approved shot lacks an actual rendered clip binding",
);

// A resume/store corruption can shift every representation of the second cut
// together. The ordinary receipt equality checks still agree, but exact
// assembly must never turn that missing half-second into a repeated shot.
const gappedTimeline = validArgs();
const secondScene = gappedTimeline.scenePlan.scenes[1]!;
const secondEdit = gappedTimeline.editDecisionList.edits[1]!;
const secondClip = gappedTimeline.footageManifest.items[1]!;
gappedTimeline.scenePlan.scenes[1] = { ...secondScene, t0: 3.5, t1: 6.5 };
gappedTimeline.editDecisionList.edits[1] = { ...secondEdit, t0: 3.5, t1: 6.5 };
gappedTimeline.footageManifest.items[1] = { ...secondClip, t0: 3.5, t1: 6.5 };
gappedTimeline.scenePlan.durationSec = 6.5;
gappedTimeline.editDecisionList.durationSec = 6.5;
gappedTimeline.footageManifest.durationSec = 6.5;
gappedTimeline.narrationDurationSec = 6.5;
assert.throws(
  () => createCinematicAssemblyHandoff(gappedTimeline),
  /contiguous/i,
  "exact cinematic assembly must reject jointly shifted receipt timings before they can create a repeated final-master shot",
);

console.log("Cinematic assembly handoff tests passed");
