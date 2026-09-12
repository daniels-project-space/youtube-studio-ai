import { z } from "zod";

import { ChannelMusicProgramSchema } from "@/engine/channelMusicProgram";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export const MUSIC_AUDITION_CHECKPOINT_VERSION = "music-audition-checkpoint/v1" as const;

const FingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const text = (maximum: number) => z.string().trim().min(1).max(maximum);

/**
 * Immutable identity for the future owner audition boundary. It intentionally
 * contains only persisted stage/R2 identity: the browser must never supply
 * a program, receipt, output digest, or storage key when approving audio.
 */
const MusicAuditionCheckpointBodySchema = z.object({
  version: z.literal(MUSIC_AUDITION_CHECKPOINT_VERSION),
  ownerId: text(320),
  channelId: text(320),
  runId: text(320),
  invocationSha256: FingerprintSchema,
  programFingerprint: FingerprintSchema,
  channelMusicProgramKey: text(1_200),
  musicRuntimeReceiptKey: text(1_200),
  musicNativeWavKey: text(1_200),
  nativeOutput: z.object({
    contentSha256: FingerprintSchema,
    byteLength: z.number().int().min(44).max(50_000_000),
    durationSec: z.number().positive().max(300),
    sampleRateHz: z.literal(32_000),
    channels: z.literal(2),
    codec: z.literal("pcm_s16le"),
  }).strict(),
}).strict();

type MusicAuditionCheckpointBody = z.infer<typeof MusicAuditionCheckpointBodySchema>;

function fingerprint(body: MusicAuditionCheckpointBody): string {
  return sha256Hex(canonicalJson(body));
}

export const MusicAuditionCheckpointSchema = MusicAuditionCheckpointBodySchema.extend({
  checkpointFingerprint: FingerprintSchema,
}).strict().superRefine((value, issue) => {
  const { checkpointFingerprint, ...body } = value;
  if (checkpointFingerprint !== fingerprint(body)) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "music audition checkpoint fingerprint is invalid" });
  }
  const prefix = `owner/${body.ownerId}/`;
  const runAudioPrefix = `${prefix}runs/${body.runId}/audio/`;
  for (const [label, key] of Object.entries({
    channelMusicProgramKey: body.channelMusicProgramKey,
    musicRuntimeReceiptKey: body.musicRuntimeReceiptKey,
    musicNativeWavKey: body.musicNativeWavKey,
  })) {
    if (!key.startsWith(runAudioPrefix) || key.includes("..")) {
      issue.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is outside the exact owner/run audio namespace` });
    }
  }
  if (!body.musicNativeWavKey.endsWith(`minimax-music3-native-${body.nativeOutput.contentSha256}.wav`)) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "native WAV key is not content-addressed by the bound worker output" });
  }
});

export type MusicAuditionCheckpoint = z.infer<typeof MusicAuditionCheckpointSchema>;

export function createMusicAuditionCheckpoint(input: Omit<MusicAuditionCheckpointBody, "version" | "programFingerprint" | "nativeOutput"> & {
  readonly program: unknown;
  readonly runtimeReceipt: unknown;
}): MusicAuditionCheckpoint {
  const program = ChannelMusicProgramSchema.parse(input.program);
  const runtime = z.object({
    programFingerprint: FingerprintSchema,
    durationSec: z.number().positive().max(300),
    output: z.object({
      contentSha256: FingerprintSchema,
      byteLength: z.number().int().min(44).max(50_000_000),
      sampleRateHz: z.literal(32_000),
      channels: z.literal(2),
      codec: z.literal("pcm_s16le"),
    }).strict(),
  }).passthrough().parse(input.runtimeReceipt);
  if (runtime.programFingerprint !== program.fingerprint) {
    throw new Error("music audition runtime receipt belongs to a different channel music program");
  }
  const body: MusicAuditionCheckpointBody = {
    version: MUSIC_AUDITION_CHECKPOINT_VERSION,
    ownerId: input.ownerId,
    channelId: input.channelId,
    runId: input.runId,
    invocationSha256: input.invocationSha256,
    programFingerprint: program.fingerprint,
    channelMusicProgramKey: input.channelMusicProgramKey,
    musicRuntimeReceiptKey: input.musicRuntimeReceiptKey,
    musicNativeWavKey: input.musicNativeWavKey,
    nativeOutput: { ...runtime.output, durationSec: runtime.durationSec },
  };
  return Object.freeze(MusicAuditionCheckpointSchema.parse({ ...body, checkpointFingerprint: fingerprint(body) }));
}
