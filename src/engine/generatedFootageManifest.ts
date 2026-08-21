import { z } from "zod";
import {
  assertCinematicKeyframeReview,
  CinematicKeyframeReviewSchema,
} from "@/engine/cinematicKeyframeReview";
import {
  assertCinematicClipReview,
  CinematicClipReviewSchema,
} from "@/engine/cinematicClipReview";
import {
  assertCinematicTransitionReview,
  CinematicTransitionReviewSchema,
} from "@/engine/cinematicTransitionReview";
import {
  assertCurrentSourceProofMediaReceipt,
  SourceProofMediaReceiptSchema,
} from "@/engine/sourceProofMedia";

/**
 * Durable, ordered binding between a generated-scene plan and the clips that
 * actually came back from the renderer.  Paths are intentionally excluded:
 * they disappear on worker resume, whereas R2 keys make an edit reproducible.
 */
export const GENERATED_FOOTAGE_SCENE_MANIFEST_VERSION =
  "generated-footage-scene-manifest/v1" as const;

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/, "expected sha256 fingerprint");
const sceneId = z.string().trim().min(1).max(160);

export const GeneratedFootageSceneManifestSchema = z
  .object({
    version: z.literal(GENERATED_FOOTAGE_SCENE_MANIFEST_VERSION),
    source: z.enum(["story_spine", "scene_manifest", "cinematic_case_sequence"]),
    /** Present only when the upstream plan is a reviewed cinematic sequence. */
    sequenceFingerprint: fingerprint.optional(),
    exactOrder: z.literal(true),
    durationSec: z.number().finite().positive(),
    items: z.array(z.object({
      sceneId,
      clipKey: z.string().trim().min(1),
      t0: z.number().finite().nonnegative().optional(),
      t1: z.number().finite().positive().optional(),
      /** Exact deterministic still-generation prior for a reviewed cinematic shot. */
      continuitySeed: z.number().int().min(1).max(2_147_483_647).optional(),
      /** Exact approved evidence asset used instead of any LTX output for this scene. */
      sourceProofMediaReceipt: SourceProofMediaReceiptSchema.optional(),
      /** Required before LTX for every source-bound cinematic shot. */
      keyframeReview: CinematicKeyframeReviewSchema.optional(),
      /** Reviewed endpoint image that conditioned LTX's final frame, when used. */
      terminalStillKey: z.string().trim().min(1).optional(),
      terminalKeyframeReview: CinematicKeyframeReviewSchema.optional(),
      /** Required after LTX before a source-bound cinematic clip can be cut. */
      clipReview: CinematicClipReviewSchema.optional(),
      /** Required for each outgoing source-bound cinematic cut before assembly. */
      transitionToNextReview: CinematicTransitionReviewSchema.optional(),
    }).strict()).min(1).max(2_000),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    value.items.forEach((item, index) => {
      if (ids.has(item.sceneId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index, "sceneId"], message: "scene ids must be unique" });
      }
      ids.add(item.sceneId);
      if ((item.t0 === undefined) !== (item.t1 === undefined)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index], message: "t0 and t1 must be supplied together" });
      }
      if (item.t0 !== undefined && item.t1 !== undefined && item.t1 <= item.t0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index], message: "item t1 must follow t0" });
      }
    });
    if (value.source === "cinematic_case_sequence") {
      if (!value.sequenceFingerprint) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sequenceFingerprint"], message: "cinematic manifest requires its sequence fingerprint" });
      }
      value.items.forEach((item, index) => {
        if (item.t0 === undefined || item.t1 === undefined) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index], message: "cinematic manifest requires exact t0/t1 for every clip" });
        }
        if (item.continuitySeed === undefined) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index, "continuitySeed"], message: "cinematic manifest requires the exact approved continuity seed for every clip" });
        }
        if (item.sourceProofMediaReceipt) {
          try {
            assertCurrentSourceProofMediaReceipt({
              receipt: item.sourceProofMediaReceipt,
              sceneId: item.sceneId,
              sequenceFingerprint: value.sequenceFingerprint!,
            });
          } catch (error) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["items", index, "sourceProofMediaReceipt"],
              message: error instanceof Error ? error.message : "source-proof media receipt is invalid",
            });
          }
          if (item.sourceProofMediaReceipt.clipKey !== item.clipKey) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["items", index, "sourceProofMediaReceipt", "clipKey"],
              message: "source-proof media receipt must bind the exact clip key persisted in this footage manifest",
            });
          }
          if (
            item.keyframeReview ||
            item.terminalStillKey ||
            item.terminalKeyframeReview ||
            item.clipReview
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["items", index],
              message: "source-proof media must bypass LTX completely and cannot carry generated-keyframe or clip-review evidence",
            });
          }
        }
        if (!item.sourceProofMediaReceipt && !item.keyframeReview) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index], message: "cinematic manifest requires an independent keyframe review before LTX" });
        } else if (!item.sourceProofMediaReceipt && item.keyframeReview!.sceneId !== item.sceneId) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index, "keyframeReview"], message: "keyframe review must bind this exact cinematic scene" });
        } else if (!item.sourceProofMediaReceipt) {
          const keyframeReview = item.keyframeReview!;
          try {
            assertCinematicKeyframeReview(keyframeReview, {
              sceneId: item.sceneId,
              reviewedAgainstSceneIds: keyframeReview.reviewedAgainstSceneIds,
              expectedCastIds: keyframeReview.expectedCastIds,
              forbidAdditionalPeople: keyframeReview.forbidAdditionalPeople,
            });
          } catch (error) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["items", index, "keyframeReview"],
              message: error instanceof Error ? error.message : "cinematic keyframe review did not pass its quality floor",
            });
          }
        }
        if (!item.sourceProofMediaReceipt && (item.terminalStillKey === undefined) !== (item.terminalKeyframeReview === undefined)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["items", index],
            message: "terminal LTX conditioning requires both its reviewed still and review receipt",
          });
        } else if (item.terminalKeyframeReview) {
          const terminalSceneId = `${item.sceneId}-terminal`;
          if (item.terminalKeyframeReview.sceneId !== terminalSceneId) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["items", index, "terminalKeyframeReview"],
              message: "terminal keyframe review must bind this exact cinematic endpoint",
            });
          } else {
            try {
              assertCinematicKeyframeReview(item.terminalKeyframeReview, {
                sceneId: terminalSceneId,
                reviewedAgainstSceneIds: item.terminalKeyframeReview.reviewedAgainstSceneIds,
                expectedCastIds: item.terminalKeyframeReview.expectedCastIds,
                forbidAdditionalPeople: item.terminalKeyframeReview.forbidAdditionalPeople,
              });
            } catch (error) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["items", index, "terminalKeyframeReview"],
                message: error instanceof Error ? error.message : "terminal keyframe review did not pass its quality floor",
              });
            }
          }
        }
        if (!item.sourceProofMediaReceipt && !item.clipReview) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index], message: "cinematic manifest requires an independent moving-clip review before assembly" });
        } else if (!item.sourceProofMediaReceipt && item.clipReview!.sceneId !== item.sceneId) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index, "clipReview"], message: "clip review must bind this exact cinematic scene" });
        } else if (!item.sourceProofMediaReceipt) {
          const clipReview = item.clipReview!;
          try {
            assertCinematicClipReview(clipReview, {
              sceneId: item.sceneId,
              sampleOffsetsSec: clipReview.sampleOffsetsSec,
              expectedCastIds: clipReview.expectedCastIds,
              forbidAdditionalPeople: clipReview.forbidAdditionalPeople,
              ...(item.terminalStillKey ? { terminalStillKey: item.terminalStillKey } : {}),
            });
          } catch (error) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["items", index, "clipReview"],
              message: error instanceof Error ? error.message : "cinematic clip review did not pass its quality floor",
            });
          }
        }
        const next = value.items[index + 1];
        if (next) {
          if (!item.transitionToNextReview) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index], message: "cinematic manifest requires an independent transition review before the next cut" });
          } else {
            try {
              assertCinematicTransitionReview(item.transitionToNextReview, {
                fromSceneId: item.sceneId,
                toSceneId: next.sceneId,
                // The detailed causal/tension binding is checked against the
                // reviewed EDL in cinematicSequenceRenderBinding.
                cutReason: item.transitionToNextReview.cutReason,
                tensionState: item.transitionToNextReview.tensionState,
              });
            } catch (error) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["items", index, "transitionToNextReview"],
                message: error instanceof Error ? error.message : "cinematic transition review did not pass its quality floor",
              });
            }
          }
        } else if (item.transitionToNextReview) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index, "transitionToNextReview"], message: "final cinematic clip cannot claim a transition to a nonexistent next scene" });
        }
      });
    }
  });

export type GeneratedFootageSceneManifest = z.infer<typeof GeneratedFootageSceneManifestSchema>;
