import { z } from "zod";

export const CINEMATIC_CLIP_REVIEW_VERSION = "cinematic-clip-review/v1" as const;
export const CINEMATIC_CLIP_MIN_SCORE = 0.84;

const score = z.number().finite().min(0).max(1);

/**
 * Independent evidence that the three sampled frames of the actual LTX clip
 * preserve its admitted first frame and deliver the planned action. A strong
 * keyframe is not enough: this receipt gates the moving take that is edited.
 */
export const CinematicClipReviewSchema = z.object({
  version: z.literal(CINEMATIC_CLIP_REVIEW_VERSION),
  reviewer: z.literal("non_google_vision"),
  sceneId: z.string().regex(/^cinematic-shot-[a-z0-9-]+$/),
  sampleOffsetsSec: z.array(z.number().finite().nonnegative()).length(3),
  semanticAlignment: score,
  motionIntegrity: score,
  continuity: score,
  endBeat: score,
  artifactFree: score,
  textWatermarkFree: z.literal(true),
  pass: z.literal(true),
  notes: z.array(z.string().trim().min(1).max(280)).max(8),
}).strict();

export type CinematicClipReview = z.infer<typeof CinematicClipReviewSchema>;

export function assertCinematicClipReview(value: unknown, expected: {
  sceneId: string;
  sampleOffsetsSec: readonly number[];
}): CinematicClipReview {
  const review = CinematicClipReviewSchema.parse(value);
  if (review.sceneId !== expected.sceneId) {
    throw new Error(`cinematic clip review belongs to ${review.sceneId}, not ${expected.sceneId}`);
  }
  if (JSON.stringify(review.sampleOffsetsSec) !== JSON.stringify([...expected.sampleOffsetsSec])) {
    throw new Error(`cinematic clip review sample lineage does not match ${expected.sceneId}`);
  }
  const failing = ([
    ["semantic alignment", review.semanticAlignment],
    ["motion integrity", review.motionIntegrity],
    ["continuity", review.continuity],
    ["end beat", review.endBeat],
    ["artifact freedom", review.artifactFree],
  ] as const).filter(([, value]) => value < CINEMATIC_CLIP_MIN_SCORE);
  if (failing.length) {
    throw new Error(
      `cinematic clip review failed ${expected.sceneId}: ` +
        failing.map(([label, value]) => `${label} ${value.toFixed(2)} < ${CINEMATIC_CLIP_MIN_SCORE}`).join(", "),
    );
  }
  return review;
}
