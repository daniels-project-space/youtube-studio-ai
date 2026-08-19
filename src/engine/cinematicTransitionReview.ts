import { z } from "zod";

export const CINEMATIC_TRANSITION_REVIEW_VERSION = "cinematic-transition-review/v1" as const;
export const CINEMATIC_TRANSITION_MIN_SCORE = 0.84;

const score = z.number().finite().min(0).max(1);

/**
 * Pixel-level evidence for the edit between two actual LTX takes. Individual
 * clip QA cannot see a bad wardrobe jump, duplicated composition, or an
 * unmotivated reveal at the cut itself.
 */
export const CinematicTransitionReviewSchema = z.object({
  version: z.literal(CINEMATIC_TRANSITION_REVIEW_VERSION),
  reviewer: z.literal("non_google_vision"),
  fromSceneId: z.string().regex(/^cinematic-shot-[a-z0-9-]+$/),
  toSceneId: z.string().regex(/^cinematic-shot-[a-z0-9-]+$/),
  cutReason: z.string().trim().min(1).max(80),
  tensionState: z.string().trim().min(1).max(80),
  semanticContinuity: score,
  visualProgression: score,
  cutMotivation: score,
  artifactFree: score,
  textWatermarkFree: z.literal(true),
  pass: z.literal(true),
  notes: z.array(z.string().trim().min(1).max(280)).max(8),
}).strict();

export type CinematicTransitionReview = z.infer<typeof CinematicTransitionReviewSchema>;

export function assertCinematicTransitionReview(value: unknown, expected: {
  fromSceneId: string;
  toSceneId: string;
  cutReason: string;
  tensionState: string;
}): CinematicTransitionReview {
  const review = CinematicTransitionReviewSchema.parse(value);
  if (review.fromSceneId !== expected.fromSceneId || review.toSceneId !== expected.toSceneId) {
    throw new Error(
      `cinematic transition review belongs to ${review.fromSceneId} → ${review.toSceneId}, ` +
        `not ${expected.fromSceneId} → ${expected.toSceneId}`,
    );
  }
  if (review.cutReason !== expected.cutReason || review.tensionState !== expected.tensionState) {
    throw new Error(`cinematic transition review no longer matches the approved cut rationale for ${expected.toSceneId}`);
  }
  const failing = ([
    ["semantic continuity", review.semanticContinuity],
    ["visual progression", review.visualProgression],
    ["cut motivation", review.cutMotivation],
    ["artifact freedom", review.artifactFree],
  ] as const).filter(([, value]) => value < CINEMATIC_TRANSITION_MIN_SCORE);
  if (failing.length) {
    throw new Error(
      `cinematic transition review failed ${expected.fromSceneId} → ${expected.toSceneId}: ` +
        failing.map(([label, value]) => `${label} ${value.toFixed(2)} < ${CINEMATIC_TRANSITION_MIN_SCORE}`).join(", "),
    );
  }
  return review;
}
