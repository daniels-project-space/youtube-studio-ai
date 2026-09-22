import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const sourceFields = {
  approvalFingerprint: digest,
  candidateSha256: digest, arrangementFingerprint: digest,
  listeningAudioSha256: digest, preparedAudioSha256: digest,
  nativeFrames: z.number().int().positive(), preparedFrames: z.number().int().positive(), preparedAudioBytes: z.number().int().positive(),
  sampleRateHz: z.literal(48000), channels: z.literal(2), publishingApproved: z.literal(false),
};
export const YuE2AssemblySourceSchema = z.union([
  z.object({ ...sourceFields, version: z.literal("yue2-assembly-source/v1"),
    crossfadeSec: z.number().finite().min(0.5).max(4), playback: z.literal("repeat"),
  }).strict().refine(value => value.preparedFrames === value.nativeFrames - Math.round(value.crossfadeSec * 48000), "Loop frame clock mismatch"),
  z.object({ ...sourceFields, version: z.literal("yue2-assembly-source/v2"),
    crossfadeSec: z.literal(0), playback: z.literal("once"),
  }).strict().refine(value => value.preparedFrames === value.nativeFrames &&
    value.preparedAudioSha256 === value.listeningAudioSha256, "Play-once source must preserve the approved bytes and frame clock"),
]);

export type YuE2AssemblySource = z.infer<typeof YuE2AssemblySourceSchema>;
