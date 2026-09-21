import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const YuE2AssemblySourceSchema = z.object({
  version: z.literal("yue2-assembly-source/v1"),
  approvalFingerprint: digest,
  candidateSha256: digest, arrangementFingerprint: digest,
  listeningAudioSha256: digest, preparedAudioSha256: digest,
  nativeFrames: z.number().int().positive(), preparedFrames: z.number().int().positive(), preparedAudioBytes: z.number().int().positive(),
  crossfadeSec: z.number().finite().min(0.5).max(4), sampleRateHz: z.literal(48000), channels: z.literal(2),
  playback: z.literal("repeat"), publishingApproved: z.literal(false),
}).strict().refine(value => value.preparedFrames === value.nativeFrames - Math.round(value.crossfadeSec * 48000), "Loop frame clock mismatch");

export type YuE2AssemblySource = z.infer<typeof YuE2AssemblySourceSchema>;
