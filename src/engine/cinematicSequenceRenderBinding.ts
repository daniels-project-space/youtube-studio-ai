import {
  CinematicEditDecisionListSchema,
  CinematicGeneratedScenePlanSchema,
  type CinematicEditDecisionList,
  type CinematicGeneratedScenePlan,
} from "./cinematicCaseSequence";
import {
  GeneratedFootageSceneManifestSchema,
  type GeneratedFootageSceneManifest,
} from "./generatedFootageManifest";
import { assertCinematicKeyframeReview } from "./cinematicKeyframeReview";
import { assertCinematicClipReview } from "./cinematicClipReview";
import { assertCurrentSourceProofMediaReceipt } from "./sourceProofMedia";

export interface CinematicSequenceRenderBinding {
  scenePlan: CinematicGeneratedScenePlan;
  editDecisionList: CinematicEditDecisionList;
  footageManifest: GeneratedFootageSceneManifest;
}

/**
 * The experimental Assembly EDL route has no real-render parity proof for
 * source-bound cinematic work. It cannot replace the exact clip-order
 * assembler merely because an operator toggled a generic switch.
 */
export function assertCinematicAssemblyRoute(args: {
  useAssemblyEdl: unknown;
  scenePlan: unknown;
  editDecisionList: unknown;
  footageManifest: unknown;
}): void {
  const manifestSignalsCinematic =
    args.footageManifest !== null &&
    typeof args.footageManifest === "object" &&
    (args.footageManifest as Record<string, unknown>)["source"] === "cinematic_case_sequence";
  const cinematicArtifactsPresent =
    args.scenePlan !== undefined ||
    args.editDecisionList !== undefined ||
    manifestSignalsCinematic;
  if (args.useAssemblyEdl === true && cinematicArtifactsPresent) {
    throw new Error(
      "source-bound cinematic sequences require the exact clip-order assembler; " +
      "the Assembly EDL cutover has no cinematic real-render parity proof and is unavailable for this master",
    );
  }
}

/**
 * No timeline may treat a set of generated clips as a cinematic sequence just
 * because it has roughly the right duration. This assertion binds every R2
 * clip, scene, and edit window to the one human-reviewed sequence fingerprint.
 */
export function assertCinematicSequenceRenderBinding(args: {
  scenePlan: unknown;
  editDecisionList: unknown;
  footageManifest: unknown;
  narrationDurationSec: number;
}): CinematicSequenceRenderBinding {
  const scenePlan = CinematicGeneratedScenePlanSchema.parse(args.scenePlan);
  const editDecisionList = CinematicEditDecisionListSchema.parse(args.editDecisionList);
  const footageManifest = GeneratedFootageSceneManifestSchema.parse(args.footageManifest);
  if (footageManifest.source !== "cinematic_case_sequence") {
    throw new Error("cinematic render binding requires a cinematic generated-footage manifest");
  }
  if (
    scenePlan.sequenceFingerprint !== editDecisionList.sequenceFingerprint ||
    scenePlan.sequenceFingerprint !== footageManifest.sequenceFingerprint ||
    scenePlan.scenes.length !== editDecisionList.edits.length ||
    scenePlan.scenes.length !== footageManifest.items.length ||
    Math.abs(scenePlan.durationSec - editDecisionList.durationSec) > 0.03 ||
    Math.abs(scenePlan.durationSec - footageManifest.durationSec) > 0.03 ||
    Math.abs(scenePlan.durationSec - args.narrationDurationSec) > 0.02
  ) {
    throw new Error("cinematic plan, EDL, renderer receipt, and narration do not bind the same exact reviewed sequence");
  }
  scenePlan.scenes.forEach((scene, index) => {
    const edit = editDecisionList.edits[index];
    const rendered = footageManifest.items[index];
    if (
      !edit || !rendered ||
      edit.shotId !== scene.id ||
      rendered.sceneId !== scene.id ||
      Math.abs(edit.t0 - scene.t0) > 0.03 ||
      Math.abs(edit.t1 - scene.t1) > 0.03 ||
      Math.abs((rendered.t0 ?? Number.NaN) - scene.t0) > 0.03 ||
      Math.abs((rendered.t1 ?? Number.NaN) - scene.t1) > 0.03 ||
      rendered.continuitySeed !== scene.continuitySeed
    ) {
      throw new Error(`cinematic clip ${index + 1} is not bound to its approved scene, continuity seed, and edit window`);
    }
    if (scene.sourceProofMedia) {
      if (!rendered.sourceProofMediaReceipt) {
        throw new Error(
          `cinematic source-proof shot ${scene.id} is missing its exact approved source-media receipt; ` +
          "do not fall back to an LTX clip or another source asset",
        );
      }
      try {
        assertCurrentSourceProofMediaReceipt({
          receipt: rendered.sourceProofMediaReceipt,
          sceneId: scene.id,
          sequenceFingerprint: scenePlan.sequenceFingerprint,
          obligation: scene.sourceProofMedia,
        });
      } catch (error) {
        throw new Error(
          `cinematic source-proof shot ${scene.id} no longer preserves its exact approved source/right/asset obligation: ` +
          `${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (rendered.sourceProofMediaReceipt.clipKey !== rendered.clipKey) {
        throw new Error(
          `cinematic source-proof shot ${scene.id} receipt does not bind the footage-manifest clip key; refusing a substituted evidence clip`,
        );
      }
    } else {
      if (rendered.sourceProofMediaReceipt) {
        throw new Error(
          `cinematic clip ${scene.id} carries source-proof media without an approved source-proof scene obligation`,
        );
      }
      const castContract = {
        expectedCastIds: scene.castIds,
        forbidAdditionalPeople: true as const,
      };
      const keyframeReview = rendered.keyframeReview;
      const clipReview = rendered.clipReview;
      if (!keyframeReview || !clipReview) {
        throw new Error(`cinematic clip ${scene.id} is missing its sealed no-extra-people review evidence`);
      }
      try {
        assertCinematicKeyframeReview(keyframeReview, {
          sceneId: scene.id,
          reviewedAgainstSceneIds: keyframeReview.reviewedAgainstSceneIds,
          ...castContract,
        });
        if (rendered.terminalKeyframeReview) {
          assertCinematicKeyframeReview(rendered.terminalKeyframeReview, {
            sceneId: `${scene.id}-terminal`,
            reviewedAgainstSceneIds: rendered.terminalKeyframeReview.reviewedAgainstSceneIds,
            ...castContract,
          });
        }
        assertCinematicClipReview(clipReview, {
          sceneId: scene.id,
          sampleOffsetsSec: clipReview.sampleOffsetsSec,
          ...(rendered.terminalStillKey ? { terminalStillKey: rendered.terminalStillKey } : {}),
          ...castContract,
        });
      } catch (error) {
        throw new Error(
          `cinematic clip ${scene.id} does not preserve its sealed no-extra-people cast contract: ` +
          `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const nextScene = scenePlan.scenes[index + 1];
    if (nextScene) {
      const transition = rendered.transitionToNextReview;
      if (!transition) {
        throw new Error(`cinematic clip ${index + 1} is missing the reviewed transition into ${nextScene.id}`);
      }
      if (
        transition.fromSceneId !== scene.id ||
        transition.toSceneId !== nextScene.id ||
        transition.cutReason !== editDecisionList.edits[index + 1]?.cutReason ||
        transition.tensionState !== editDecisionList.edits[index + 1]?.tensionState
      ) {
        throw new Error(`cinematic transition after ${scene.id} is not bound to the approved incoming cut rationale`);
      }
    }
  });
  return { scenePlan, editDecisionList, footageManifest };
}
