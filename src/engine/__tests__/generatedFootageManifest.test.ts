import assert from "node:assert/strict";

import {
  GENERATED_FOOTAGE_SCENE_MANIFEST_VERSION,
  GeneratedFootageSceneManifestSchema,
} from "@/engine/generatedFootageManifest";
import { CINEMATIC_KEYFRAME_REVIEW_VERSION } from "@/engine/cinematicKeyframeReview";
import { CINEMATIC_CLIP_REVIEW_VERSION } from "@/engine/cinematicClipReview";
import { CINEMATIC_TRANSITION_REVIEW_VERSION } from "@/engine/cinematicTransitionReview";

const review = (sceneId: string) => ({
  version: CINEMATIC_KEYFRAME_REVIEW_VERSION,
  reviewer: "non_google_vision" as const,
  sceneId,
  reviewedAgainstSceneIds: [],
  semanticAlignment: 0.9,
  composition: 0.9,
  continuity: 0.9,
  artifactFree: 0.9,
  textWatermarkFree: true as const,
  pass: true as const,
  notes: ["Independent keyframe gate accepted the source frame."],
});

const clipReview = (sceneId: string) => ({
  version: CINEMATIC_CLIP_REVIEW_VERSION,
  reviewer: "non_google_vision" as const,
  sceneId,
  sampleOffsetsSec: [0.2, 1.5, 2.8],
  semanticAlignment: 0.9,
  motionIntegrity: 0.9,
  continuity: 0.9,
  endBeat: 0.9,
  artifactFree: 0.9,
  textWatermarkFree: true as const,
  pass: true as const,
  notes: ["The moving clip preserves the source still and completes its causal action."],
});

const transitionReview = (fromSceneId: string, toSceneId: string) => ({
  version: CINEMATIC_TRANSITION_REVIEW_VERSION,
  reviewer: "non_google_vision" as const,
  fromSceneId,
  toSceneId,
  cutReason: "reveal",
  tensionState: "reversal",
  semanticContinuity: 0.9,
  visualProgression: 0.9,
  cutMotivation: 0.9,
  artifactFree: 0.9,
  textWatermarkFree: true as const,
  pass: true as const,
  notes: ["The outgoing proof frame motivates the incoming reveal."],
});

const cinematic = {
  version: GENERATED_FOOTAGE_SCENE_MANIFEST_VERSION,
  source: "cinematic_case_sequence" as const,
  sequenceFingerprint: "a".repeat(64),
  exactOrder: true as const,
  durationSec: 6,
  items: [
    { sceneId: "cinematic-shot-one", clipKey: "runs/case/one.mp4", t0: 0, t1: 3, continuitySeed: 101, keyframeReview: review("cinematic-shot-one"), clipReview: clipReview("cinematic-shot-one"), transitionToNextReview: transitionReview("cinematic-shot-one", "cinematic-shot-two") },
    { sceneId: "cinematic-shot-two", clipKey: "runs/case/two.mp4", t0: 3, t1: 6, continuitySeed: 102, keyframeReview: review("cinematic-shot-two"), clipReview: clipReview("cinematic-shot-two") },
  ],
};

assert.equal(GeneratedFootageSceneManifestSchema.parse(cinematic).items.length, 2);

const missingFingerprint = structuredClone(cinematic);
delete (missingFingerprint as { sequenceFingerprint?: string }).sequenceFingerprint;
assert.throws(
  () => GeneratedFootageSceneManifestSchema.parse(missingFingerprint),
  /cinematic manifest requires its sequence fingerprint/,
);

const missingClipReview = structuredClone(cinematic);
delete (missingClipReview.items[0] as { clipReview?: unknown }).clipReview;
assert.throws(
  () => GeneratedFootageSceneManifestSchema.parse(missingClipReview),
  /requires an independent moving-clip review before assembly/,
);

const missingTransitionReview = structuredClone(cinematic);
delete (missingTransitionReview.items[0] as { transitionToNextReview?: unknown }).transitionToNextReview;
assert.throws(
  () => GeneratedFootageSceneManifestSchema.parse(missingTransitionReview),
  /requires an independent transition review before the next cut/,
);

const lowMotionReview = structuredClone(cinematic);
lowMotionReview.items[0].clipReview.motionIntegrity = 0.3;
assert.throws(
  () => GeneratedFootageSceneManifestSchema.parse(lowMotionReview),
  /motion integrity/,
  "a claimed pass with a below-floor LTX motion score cannot reach assembly",
);

const brokenTiming = structuredClone(cinematic);
delete (brokenTiming.items[1] as { t1?: number }).t1;
assert.throws(
  () => GeneratedFootageSceneManifestSchema.parse(brokenTiming),
  /cinematic manifest requires exact t0\/t1/,
);

const missingContinuitySeed = structuredClone(cinematic);
delete (missingContinuitySeed.items[0] as { continuitySeed?: number }).continuitySeed;
assert.throws(
  () => GeneratedFootageSceneManifestSchema.parse(missingContinuitySeed),
  /requires the exact approved continuity seed/,
);

const missingReview = structuredClone(cinematic);
delete (missingReview.items[0] as { keyframeReview?: unknown }).keyframeReview;
assert.throws(
  () => GeneratedFootageSceneManifestSchema.parse(missingReview),
  /requires an independent keyframe review before LTX/,
);

console.log("Generated footage scene manifest tests passed");
