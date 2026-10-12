import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u);

/** A retained source for audition, never a release-ready music artifact. */
const LegacyMusicCandidateSchema = z.object({
  version: z.literal("shared-yue2-music-candidate/v1"),
  ownerId: id, channelId: id, runId: id,
  arrangementFingerprint: hash,
  jobId: z.string().regex(/^yue2-eval-[a-f0-9]{64}$/u),
  candidateSha256: hash,
  candidateKey: z.string().min(1),
  listeningAudioKey: z.string().min(1),
  listeningAudioSha256: hash,
  nativeFrames: z.number().int().positive(),
  sampleRateHz: z.literal(48000), channels: z.literal(2),
  technicalStatus: z.enum(["needs_audition", "blocked"]),
  allocatedCostUsdMicros: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  costBasis: z.literal("supervised_dispatch_wall_time"),
  providerBilledCostUsdMicros: z.null(),
  productionApproved: z.literal(false),
}).strict().superRefine((value, ctx) => {
  const root = `owner/${value.ownerId}/runs/${value.runId}/music/yue2-evaluation/`;
  if (value.candidateKey !== `${root}candidate.json` ||
    ![`${root}audio-native-${value.listeningAudioSha256}.wav`,
      `${root}audio-headroom-${value.listeningAudioSha256}.wav`].includes(value.listeningAudioKey)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Candidate references must match the exact private run namespace and audio digest" });
  }
});
const EngineMusicCandidateSchema = z.object({
  version: z.literal("shared-yue2-music-candidate/v2"), ownerId: id, channelId: id, runId: id,
  arrangementFingerprint: hash, jobId: z.string().regex(/^[a-z0-9]{32}$/),
  candidateSha256: hash, candidateKey: z.string(), listeningAudioKey: z.string(), listeningAudioSha256: hash,
  nativeFrames: z.number().int().positive(), sampleRateHz: z.literal(48000), channels: z.literal(2),
  technicalStatus: z.enum(["needs_audition", "blocked"]),
  costUsd: z.number().finite().nonnegative(), gpuSeconds: z.number().finite().nonnegative(),
  costBasis: z.enum(["engine-reported-usage", "engine-reservation-debit"]), providerInvoiceVerified: z.literal(false), productionApproved: z.literal(false),
}).strict().superRefine((value, ctx) => {
  const root = `owner/${value.ownerId}/runs/${value.runId}/music/yue2-engine/`;
  if (value.candidateKey !== `${root}candidate.json` ||
      ![`${root}audio-native-${value.listeningAudioSha256}.wav`, `${root}audio-headroom-${value.listeningAudioSha256}.wav`].includes(value.listeningAudioKey)) {
    ctx.addIssue({ code: "custom", message: "Engine music references must retain their exact private source identity" });
  }
});
export const YuE2MusicCandidateSchema = z.union([LegacyMusicCandidateSchema, EngineMusicCandidateSchema]);
