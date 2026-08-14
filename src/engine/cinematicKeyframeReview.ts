import { z } from "zod";

export const CINEMATIC_KEYFRAME_REVIEW_VERSION = "cinematic-keyframe-review/v1" as const;
export const CINEMATIC_KEYFRAME_MIN_SCORE = 0.84;

const score = z.number().finite().min(0).max(1);

/**
 * A durable, independent review receipt for the Z-Image keyframe that becomes
 * an LTX shot's first frame. It is intentionally factual: the rendered still,
 * its prior same-cast reference(s), and the non-Google reviewer verdict—not a
 * claim that a text prompt was followed.
 */
export const CinematicKeyframeReviewSchema = z.object({
  version: z.literal(CINEMATIC_KEYFRAME_REVIEW_VERSION),
  reviewer: z.literal("non_google_vision"),
  sceneId: z.string().regex(/^cinematic-shot-[a-z0-9-]+$/),
  /** Earlier accepted shots of the same mannequin cast, if this shot has any. */
  reviewedAgainstSceneIds: z.array(z.string().regex(/^cinematic-shot-[a-z0-9-]+$/)).max(2),
  semanticAlignment: score,
  composition: score,
  continuity: score,
  artifactFree: score,
  textWatermarkFree: z.literal(true),
  pass: z.literal(true),
  notes: z.array(z.string().trim().min(1).max(280)).max(8),
}).strict();

export type CinematicKeyframeReview = z.infer<typeof CinematicKeyframeReviewSchema>;

export function assertCinematicKeyframeReview(value: unknown, expected: {
  sceneId: string;
  reviewedAgainstSceneIds: readonly string[];
}): CinematicKeyframeReview {
  const review = CinematicKeyframeReviewSchema.parse(value);
  if (review.sceneId !== expected.sceneId) {
    throw new Error(`cinematic keyframe review belongs to ${review.sceneId}, not ${expected.sceneId}`);
  }
  const expectedIds = [...expected.reviewedAgainstSceneIds];
  if (JSON.stringify(review.reviewedAgainstSceneIds) !== JSON.stringify(expectedIds)) {
    throw new Error(`cinematic keyframe review reference lineage does not match ${expected.sceneId}`);
  }
  const failing = ([
    ["semantic alignment", review.semanticAlignment],
    ["composition", review.composition],
    ["continuity", review.continuity],
    ["artifact freedom", review.artifactFree],
  ] as const).filter(([, value]) => value < CINEMATIC_KEYFRAME_MIN_SCORE);
  if (failing.length) {
    throw new Error(
      `cinematic keyframe review failed ${expected.sceneId}: ` +
        failing.map(([label, value]) => `${label} ${value.toFixed(2)} < ${CINEMATIC_KEYFRAME_MIN_SCORE}`).join(", "),
    );
  }
  return review;
}
