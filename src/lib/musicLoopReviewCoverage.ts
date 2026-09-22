import { z } from "zod";

export const MUSIC_LOOP_REVIEW_SECONDS = 90;
export const MUSIC_LOOP_REVIEW_JOIN_TIMES = [29.9, 30, 30.1, 59.9, 60, 60.1, 89.9] as const;
const integer = z.number().int().safe().positive();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
export const MusicLoopReviewCoverageSchema = z.object({
  version: z.literal("music-loop-review-coverage/v1"),
  sampledDurationSec: z.literal(90),
  maxGapSec: z.number().finite().nonnegative(),
  maxAllowedGapSec: z.literal(6),
  repetition: z.object({
    version: z.literal("music-loop-video-repetition/v1"),
    masterSha256: sha256, masterBytes: integer, durationSec: integer.max(28800).min(90).multipleOf(30),
    width: integer, height: integer, fps: z.literal(30), unitSeconds: z.literal(30),
    packetCount: integer, bodyUnitCount: integer, comparedBodyPackets: integer,
    uniqueVideoSeconds: z.literal(60), orderedVideoPacketSha256: sha256, bodyPacketTemplateSha256: sha256,
    independentIdrBoundariesVerified: z.literal(true),
    stableDecoderParametersVerified: z.literal(true),
    scope: z.literal("all video packets and clocks; not decoded visual quality, audio continuity, source approval or release authority"),
  }).strict(),
}).strict();
export type MusicLoopReviewCoverage = z.infer<typeof MusicLoopReviewCoverageSchema>;

export function musicLoopReviewGap(times: readonly number[]): number {
  const sorted = [...new Set([0, MUSIC_LOOP_REVIEW_SECONDS, ...times.filter(t =>
    Number.isFinite(t) && t >= 0 && t <= MUSIC_LOOP_REVIEW_SECONDS)])].sort((a, b) => a - b);
  return Math.max(...sorted.slice(1).map((time, index) => time - sorted[index]));
}

/** An integrity/coverage check, never a visual-quality or musical verdict. */
export function assertMusicLoopReviewCoverage(input: {
  coverage: unknown;
  source: { sha256: string; durationSec: number; byteLength?: number };
  frameTimes: readonly number[];
}): MusicLoopReviewCoverage {
  const coverage = MusicLoopReviewCoverageSchema.parse(input.coverage);
  const proof = coverage.repetition;
  if (proof.masterSha256 !== input.source.sha256 || proof.durationSec !== input.source.durationSec ||
    (input.source.byteLength !== undefined && proof.masterBytes !== input.source.byteLength) ||
    proof.packetCount !== proof.durationSec * 30 || proof.bodyUnitCount !== proof.durationSec / 30 - 1 ||
    proof.comparedBodyPackets !== proof.packetCount - 1800) {
    throw new Error("music-loop review repetition evidence does not match its exact master or packet layout");
  }
  const gap = musicLoopReviewGap(input.frameTimes);
  if (Math.abs(coverage.maxGapSec - gap) > 0.000001 || gap > 6.01 ||
    MUSIC_LOOP_REVIEW_JOIN_TIMES.some(time => !input.frameTimes.some(frame => Math.abs(frame - time) < 0.01))) {
    throw new Error("music-loop review lacks complete sampled material or loop-boundary evidence");
  }
  return coverage;
}
