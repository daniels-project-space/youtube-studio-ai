import { z } from "zod";
import { MUSIC_PROVIDER_MIX_MAX_SECONDS, MUSIC_PROVIDER_AUDITION_MAX_BYTES } from "./musicAuditionLimits";

import { ChannelMusicProgramSchema } from "@/engine/channelMusicProgram";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { AnyMusicAuditionCheckpointSchema } from "./musicAuditionCheckpoint";

const FingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export interface MusicAuditionApprovalReadinessInput {
  readonly sections: readonly { readonly id: string }[];
  readonly sectionReviews: Readonly<Record<string, { readonly score: string; readonly evidence: string }>>;
  readonly emotionalDepthScore: string;
  readonly arrangementDepthScore: string;
  readonly hollowOrGeneric: boolean;
  readonly notes: string;
  readonly thresholds?: {
    readonly minimumSectionScore: number;
    readonly minimumEmotionalDepthScore: number;
    readonly minimumArrangementDepthScore: number;
  };
  readonly technicalQualityPass?: boolean;
}

export interface MusicAuditionDraft {
  readonly checkpointId: string;
  readonly sectionReviews: Readonly<Record<string, { readonly score: string; readonly evidence: string }>>;
  readonly emotionalDepthScore: string;
  readonly arrangementDepthScore: string;
  readonly hollowOrGeneric: boolean;
  readonly notes: string;
}

export function musicAuditionDraftForCheckpoint(
  draft: MusicAuditionDraft | null,
  checkpointId: string,
  sections: readonly { readonly id: string }[],
): MusicAuditionDraft {
  if (draft?.checkpointId === checkpointId) return draft;
  return {
    checkpointId,
    sectionReviews: Object.fromEntries(sections.map(({ id }) => [id, { score: "", evidence: "" }])),
    emotionalDepthScore: "",
    arrangementDepthScore: "",
    hollowOrGeneric: false,
    notes: "",
  };
}

export function assessMusicAuditionApprovalReadiness(input: MusicAuditionApprovalReadinessInput) {
  const reviewComplete = input.sections.length >= 4 && input.sections.every((section) => {
    const review = input.sectionReviews[section.id];
    const score = Number(review?.score);
    return review?.score.trim() !== "" && Number.isFinite(score) && score >= 0 && score <= 1 && Boolean(review?.evidence.trim());
  }) && input.emotionalDepthScore.trim() !== "" && Number.isFinite(Number(input.emotionalDepthScore)) &&
    Number(input.emotionalDepthScore) >= 0 && Number(input.emotionalDepthScore) <= 1 &&
    input.arrangementDepthScore.trim() !== "" && Number.isFinite(Number(input.arrangementDepthScore)) &&
    Number(input.arrangementDepthScore) >= 0 && Number(input.arrangementDepthScore) <= 1 && Boolean(input.notes.trim());
  const humanReviewPasses = reviewComplete && input.thresholds !== undefined && !input.hollowOrGeneric &&
    input.sections.every((section) => Number(input.sectionReviews[section.id]?.score) >= input.thresholds!.minimumSectionScore) &&
    Number(input.emotionalDepthScore) >= input.thresholds.minimumEmotionalDepthScore &&
    Number(input.arrangementDepthScore) >= input.thresholds.minimumArrangementDepthScore;
  return {
    reviewComplete,
    humanReviewPasses,
    approvalReady: humanReviewPasses && input.technicalQualityPass === true,
  };
}

const SectionReviewSchema = z.object({
  sectionId: z.string().trim().min(1).max(80),
  score: z.number().finite().min(0).max(1),
  evidence: z.string().trim().min(1).max(600),
}).strict();

const RejectionAuditionSchema = z.object({
  emotionalDepthScore: z.number().finite().min(0).max(1),
  arrangementDepthScore: z.number().finite().min(0).max(1),
  hollowOrGeneric: z.boolean(),
  verdict: z.literal("fail"),
  notes: z.string().trim().min(1).max(1_600),
}).strict();

const MusicAuditionReviewBodySchema = z.object({
  version: z.literal("music-audition-review/v1"),
  checkpointFingerprint: FingerprintSchema,
  programFingerprint: FingerprintSchema,
  output: z.object({
    contentSha256: FingerprintSchema,
    byteLength: z.number().int().min(44).max(MUSIC_PROVIDER_AUDITION_MAX_BYTES),
    durationSec: z.number().positive().max(MUSIC_PROVIDER_MIX_MAX_SECONDS),
    sampleRateHz: z.literal(32_000),
    channels: z.literal(2),
    codec: z.literal("pcm_s16le"),
  }).strict(),
  reviewerId: z.string().trim().min(1).max(320),
  sectionReviews: z.array(SectionReviewSchema).min(4).max(8),
  audition: RejectionAuditionSchema,
  reviewedAt: z.number().int().nonnegative(),
}).strict();

export const MusicAuditionReviewReceiptSchema = MusicAuditionReviewBodySchema.extend({
  fingerprint: FingerprintSchema,
}).strict().superRefine((value, issue) => {
  const { fingerprint, ...body } = value;
  if (fingerprint !== sha256Hex(canonicalJson(body))) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "music audition review fingerprint is invalid" });
  }
});

export type MusicAuditionReviewReceipt = z.infer<typeof MusicAuditionReviewReceiptSchema>;

export function musicAuditionReviewSummary(value: unknown) {
  const receipt = MusicAuditionReviewReceiptSchema.parse(value);
  return {
    reviewedAt: receipt.reviewedAt,
    sectionReviews: receipt.sectionReviews,
    audition: receipt.audition,
  };
}

export function createMusicAuditionReviewReceipt(input: {
  checkpoint: unknown;
  program: unknown;
  reviewerId: string;
  sectionReviews: readonly unknown[];
  audition: unknown;
  reviewedAt: number;
}): MusicAuditionReviewReceipt {
  const checkpoint = AnyMusicAuditionCheckpointSchema.parse(input.checkpoint);
  const program = ChannelMusicProgramSchema.parse(input.program);
  if (program.fingerprint !== checkpoint.programFingerprint || program.channelId !== checkpoint.channelId) {
    throw new Error("music audition review program does not match its checkpoint");
  }
  const expectedSections = program.generation.sections.map((section) => section.id);
  const sectionReviews = z.array(SectionReviewSchema).min(4).max(8).parse(input.sectionReviews);
  if (sectionReviews.map((section) => section.sectionId).join("|") !== expectedSections.join("|")) {
    throw new Error("music audition review must cover every sealed section exactly once and in order");
  }
  const output = checkpoint.version === "music-audition-checkpoint/v1"
    ? checkpoint.nativeOutput
    : checkpoint.auditionOutput;
  const body = MusicAuditionReviewBodySchema.parse({
    version: "music-audition-review/v1",
    checkpointFingerprint: checkpoint.checkpointFingerprint,
    programFingerprint: checkpoint.programFingerprint,
    output,
    reviewerId: input.reviewerId,
    sectionReviews,
    audition: input.audition,
    reviewedAt: input.reviewedAt,
  });
  return MusicAuditionReviewReceiptSchema.parse({
    ...body,
    fingerprint: sha256Hex(canonicalJson(body)),
  });
}

export function assertMusicAuditionReviewReceiptForCheckpoint(
  value: unknown,
  checkpointValue: unknown,
  reviewerId: string,
): MusicAuditionReviewReceipt {
  const receipt = MusicAuditionReviewReceiptSchema.parse(value);
  const checkpoint = AnyMusicAuditionCheckpointSchema.parse(checkpointValue);
  const output = checkpoint.version === "music-audition-checkpoint/v1"
    ? checkpoint.nativeOutput
    : checkpoint.auditionOutput;
  if (receipt.checkpointFingerprint !== checkpoint.checkpointFingerprint ||
    receipt.programFingerprint !== checkpoint.programFingerprint || receipt.reviewerId !== reviewerId ||
    receipt.output.contentSha256 !== output.contentSha256 || receipt.output.byteLength !== output.byteLength ||
    receipt.output.durationSec !== output.durationSec || receipt.output.sampleRateHz !== output.sampleRateHz ||
    receipt.output.channels !== output.channels || receipt.output.codec !== output.codec) {
    throw new Error("music audition review does not match the rejected checkpoint or reviewer");
  }
  return receipt;
}
