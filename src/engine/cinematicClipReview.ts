import { z } from "zod";

export const CINEMATIC_CLIP_REVIEW_VERSION = "cinematic-clip-review/v2" as const;
export const CINEMATIC_CLIP_MIN_SCORE = 0.84;

const score = z.number().finite().min(0).max(1);
const mannequinId = z.string().regex(/^mannequin-[a-z0-9-]+$/);

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
  /** Exact sealed cast permitted across the moving take; empty means no people. */
  expectedCastIds: z.array(mannequinId).max(4),
  /** No bystanders, background people, extra mannequins, or human stand-ins. */
  forbidAdditionalPeople: z.literal(true),
  /** Independent reviewer explicitly confirmed every sample contains only the sealed cast. */
  onlyExpectedCastVisible: z.literal(true),
  semanticAlignment: score,
  motionIntegrity: score,
  continuity: score,
  endBeat: score,
  artifactFree: score,
  /** Present only when LTX was conditioned against a reviewed terminal still. */
  terminalStillKey: z.string().trim().min(1).optional(),
  terminalFrameAlignment: score.optional(),
  textWatermarkFree: z.literal(true),
  pass: z.literal(true),
  notes: z.array(z.string().trim().min(1).max(280)).max(8),
}).strict();

export type CinematicClipReview = z.infer<typeof CinematicClipReviewSchema>;

export function assertCinematicClipReview(value: unknown, expected: {
  sceneId: string;
  sampleOffsetsSec: readonly number[];
  terminalStillKey?: string;
  expectedCastIds: readonly string[];
  forbidAdditionalPeople: true;
}): CinematicClipReview {
  const review = CinematicClipReviewSchema.parse(value);
  if (review.sceneId !== expected.sceneId) {
    throw new Error(`cinematic clip review belongs to ${review.sceneId}, not ${expected.sceneId}`);
  }
  if (JSON.stringify(review.sampleOffsetsSec) !== JSON.stringify([...expected.sampleOffsetsSec])) {
    throw new Error(`cinematic clip review sample lineage does not match ${expected.sceneId}`);
  }
  const expectedCastIds = [...expected.expectedCastIds];
  if (JSON.stringify(review.expectedCastIds) !== JSON.stringify(expectedCastIds)) {
    throw new Error(`cinematic clip review cast contract does not match ${expected.sceneId}`);
  }
  if (review.forbidAdditionalPeople !== expected.forbidAdditionalPeople || !review.onlyExpectedCastVisible) {
    throw new Error(`cinematic clip review did not affirm the no-extra-people contract for ${expected.sceneId}`);
  }
  if (expected.terminalStillKey) {
    if (review.terminalStillKey !== expected.terminalStillKey) {
      throw new Error(`cinematic clip review terminal reference does not match ${expected.sceneId}`);
    }
    if (review.terminalFrameAlignment === undefined) {
      throw new Error(`cinematic clip review is missing terminal-frame evidence for ${expected.sceneId}`);
    }
  } else if (review.terminalStillKey !== undefined || review.terminalFrameAlignment !== undefined) {
    throw new Error(`cinematic clip review has an unexpected terminal-frame reference for ${expected.sceneId}`);
  }
  const failing = ([
    ["semantic alignment", review.semanticAlignment],
    ["motion integrity", review.motionIntegrity],
    ["continuity", review.continuity],
    ["end beat", review.endBeat],
    ["artifact freedom", review.artifactFree],
    ...(expected.terminalStillKey
      ? [["terminal-frame alignment", review.terminalFrameAlignment!] as const]
      : []),
  ] as const).filter(([, value]) => value < CINEMATIC_CLIP_MIN_SCORE);
  if (failing.length) {
    throw new Error(
      `cinematic clip review failed ${expected.sceneId}: ` +
        failing.map(([label, value]) => `${label} ${value.toFixed(2)} < ${CINEMATIC_CLIP_MIN_SCORE}`).join(", "),
    );
  }
  return review;
}
