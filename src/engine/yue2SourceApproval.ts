import { z } from "zod";
import { canonicalJson } from "../lib/canonicalJson";
import { sha256Hex } from "../lib/sha256";
import { validateYuE2Audition } from "./yue2Audition";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u);
export const YuE2SourceApprovalBasisSchema = z.object({
  ownerId: id, channelId: id, runId: id, invocationSha256: hash,
  candidateSha256: hash, arrangementFingerprint: hash,
  jobId: z.string().regex(/^yue2-eval-[a-f0-9]{64}$/u),
  listeningAudioKey: z.string(), listeningAudioSha256: hash,
  nativeFrames: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sampleRateHz: z.literal(48000), channels: z.literal(2),
  sectionIds: z.array(z.string().min(1).max(80)).min(1).max(16),
  technicalStatus: z.literal("needs_audition"), contextRetained: z.literal(true),
}).strict().superRefine((value, ctx) => {
  const root = `owner/${value.ownerId}/runs/${value.runId}/music/yue2-evaluation/`;
  if (![`${root}audio-native-${value.listeningAudioSha256}.wav`,
    `${root}audio-headroom-${value.listeningAudioSha256}.wav`].includes(value.listeningAudioKey) ||
    new Set(value.sectionIds).size !== value.sectionIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid source approval identity or section coverage" });
  }
});
const bodySchema = z.object({
  version: z.literal("yue2-source-approval/v1"), basis: YuE2SourceApprovalBasisSchema,
  auditionSha256: hash, reviewerId: id, reviewedAt: z.number().int().positive(), revision: z.number().int().positive(),
  assemblyApproved: z.literal(true), publishingApproved: z.literal(false),
}).strict();
export const YuE2SourceApprovalSchema = bodySchema.extend({ fingerprint: hash }).superRefine((value, ctx) => {
  const { fingerprint, ...body } = value;
  if (value.reviewerId !== value.basis.ownerId || fingerprint !== sha256Hex(canonicalJson(body))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Source approval fingerprint or reviewer mismatch" });
  }
});
export type YuE2SourceApproval = z.infer<typeof YuE2SourceApprovalSchema>;

export function createYuE2SourceApproval(input: { basis: unknown; submission: unknown; reviewedAt: number; revision: number }): YuE2SourceApproval {
  const basis = YuE2SourceApprovalBasisSchema.parse(input.basis);
  const audition = validateYuE2Audition(input.submission, { candidateSha256: basis.candidateSha256,
    sectionIds: basis.sectionIds, technicallyBlocked: false, contextRetained: basis.contextRetained });
  if (audition.verdict !== "approved_for_assembly") throw new Error("Explicit source approval required");
  const body = bodySchema.parse({ version: "yue2-source-approval/v1", basis,
    auditionSha256: sha256Hex(canonicalJson(audition)), reviewerId: basis.ownerId,
    reviewedAt: input.reviewedAt, revision: input.revision, assemblyApproved: true, publishingApproved: false });
  return YuE2SourceApprovalSchema.parse({ ...body, fingerprint: sha256Hex(canonicalJson(body)) });
}
