import { z } from "zod";

import { ChannelMusicProgramSchema } from "@/engine/channelMusicProgram";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";

export const MUSIC_AUDITION_CHECKPOINT_VERSION = "music-audition-checkpoint/v1" as const;
export const MUSIC_PROVIDER_AUDITION_SOURCE_VERSION = "music-provider-audition-source/v1" as const;
export const MUSIC_AUDITION_CHECKPOINT_V2_VERSION = "music-audition-checkpoint/v2" as const;

const FingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const NativeOutputIntegritySchema = z.object({
  contentSha256: FingerprintSchema,
  byteLength: z.number().int().min(44).max(50_000_000),
}).strict();

/**
 * A content-addressed key and a worker receipt alone do not prove that R2
 * still holds the exact WAV the owner heard. Recheck the actual retained bytes
 * at every authority boundary that turns a review into an approval/release.
 * This deliberately verifies only byte identity: auditory/editorial judgement
 * remains the owner review represented by the separate quality receipt.
 */
export function assertMusicAuditionNativeBytes(input: {
  readonly expected: unknown;
  readonly bytes: Uint8Array;
}): Readonly<{ contentSha256: string; byteLength: number }> {
  const expected = NativeOutputIntegritySchema.parse(input.expected);
  const actual = {
    contentSha256: sha256BytesHex(input.bytes),
    byteLength: input.bytes.byteLength,
  };
  if (actual.contentSha256 !== expected.contentSha256 || actual.byteLength !== expected.byteLength) {
    throw new Error(
      `retained native Music3 WAV does not match its immutable receipt (expected ${expected.contentSha256.slice(0, 12)}/${expected.byteLength}, ` +
      `got ${actual.contentSha256.slice(0, 12)}/${actual.byteLength})`,
    );
  }
  return Object.freeze(actual);
}

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

const ProviderAuditionOutputSchema = z.object({
  contentSha256: FingerprintSchema,
  byteLength: z.number().int().min(44).max(50_000_000),
  durationSec: z.number().positive().max(300),
  sampleRateHz: z.literal(32_000),
  channels: z.literal(2),
  codec: z.literal("pcm_s16le"),
}).strict();

const MusicProviderAuditionSourceBodySchema = z.object({
  version: z.literal(MUSIC_PROVIDER_AUDITION_SOURCE_VERSION),
  ownerId: text(320),
  channelId: text(320),
  runId: text(320),
  provider: z.enum(["mureka", "suno"]),
  programFingerprint: FingerprintSchema,
  sourceMusicKey: text(1_200),
  sourceOutput: z.object({
    contentSha256: FingerprintSchema,
    byteLength: z.number().int().positive().max(250_000_000),
    durationSec: z.number().positive().max(300),
    codec: z.literal("mp3"),
  }).strict(),
  auditionWavKey: text(1_200),
  auditionOutput: ProviderAuditionOutputSchema,
}).strict();

type MusicProviderAuditionSourceBody = z.infer<typeof MusicProviderAuditionSourceBodySchema>;

function providerSourceFingerprint(body: MusicProviderAuditionSourceBody): string {
  return sha256Hex(canonicalJson(body));
}

export const MusicProviderAuditionSourceSchema = MusicProviderAuditionSourceBodySchema.extend({
  fingerprint: FingerprintSchema,
}).strict().superRefine((value, issue) => {
  const { fingerprint: sourceFingerprint, ...body } = value;
  if (sourceFingerprint !== providerSourceFingerprint(body)) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "music provider audition source fingerprint is invalid" });
  }
  const runAudioPrefix = `owner/${body.ownerId}/runs/${body.runId}/audio/`;
  if (!body.sourceMusicKey.startsWith(runAudioPrefix) || body.sourceMusicKey.includes("..")) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "music source is outside the exact owner/run audio namespace" });
  }
  if (!body.auditionWavKey.startsWith(runAudioPrefix) || body.auditionWavKey.includes("..") ||
      !body.auditionWavKey.endsWith(`music-audition-${body.auditionOutput.contentSha256}.wav`)) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "music audition WAV is not content-addressed inside the exact owner/run namespace" });
  }
});

export type MusicProviderAuditionSource = z.infer<typeof MusicProviderAuditionSourceSchema>;

export function createMusicProviderAuditionSource(input: {
  readonly ownerId: string;
  readonly channelId: string;
  readonly runId: string;
  readonly provider: "mureka" | "suno";
  readonly program: unknown;
  readonly sourceMusicKey: string;
  readonly sourceBytes: Uint8Array;
  readonly durationSec: number;
  readonly auditionWavKey: string;
  readonly auditionWavBytes: Uint8Array;
}): MusicProviderAuditionSource {
  const program = ChannelMusicProgramSchema.parse(input.program);
  if (program.channelId !== input.channelId || program.generation.providerPreference !== input.provider) {
    throw new Error("music provider audition source does not match the sealed provider route");
  }
  if (input.sourceBytes.byteLength < 1_000 || input.sourceBytes.byteLength > 250_000_000 ||
      !Number.isFinite(input.durationSec) || input.durationSec < 6 || input.durationSec > 300) {
    throw new Error("music provider audition source is outside its byte or duration bounds");
  }
  const auditionOutput = {
    contentSha256: sha256BytesHex(input.auditionWavBytes),
    byteLength: input.auditionWavBytes.byteLength,
    durationSec: input.durationSec,
    sampleRateHz: 32_000 as const,
    channels: 2 as const,
    codec: "pcm_s16le" as const,
  };
  assertMusicAuditionNativeBytes({
    expected: { contentSha256: auditionOutput.contentSha256, byteLength: auditionOutput.byteLength },
    bytes: input.auditionWavBytes,
  });
  const body: MusicProviderAuditionSourceBody = {
    version: MUSIC_PROVIDER_AUDITION_SOURCE_VERSION,
    ownerId: input.ownerId,
    channelId: input.channelId,
    runId: input.runId,
    provider: input.provider,
    programFingerprint: program.fingerprint,
    sourceMusicKey: input.sourceMusicKey,
    sourceOutput: {
      contentSha256: sha256BytesHex(input.sourceBytes),
      byteLength: input.sourceBytes.byteLength,
      durationSec: input.durationSec,
      codec: "mp3",
    },
    auditionWavKey: input.auditionWavKey,
    auditionOutput,
  };
  return Object.freeze(MusicProviderAuditionSourceSchema.parse({
    ...body,
    fingerprint: providerSourceFingerprint(body),
  }));
}

const MusicAuditionCheckpointV2BodySchema = z.object({
  version: z.literal(MUSIC_AUDITION_CHECKPOINT_V2_VERSION),
  ownerId: text(320),
  channelId: text(320),
  runId: text(320),
  invocationSha256: FingerprintSchema,
  provider: z.enum(["mureka", "suno"]),
  programFingerprint: FingerprintSchema,
  channelMusicProgramKey: text(1_200),
  musicProviderAuditionSourceKey: text(1_200),
  musicProviderAuditionSourceFingerprint: FingerprintSchema,
  sourceMusicKey: text(1_200),
  auditionWavKey: text(1_200),
  sourceOutput: MusicProviderAuditionSourceBodySchema.shape.sourceOutput,
  auditionOutput: ProviderAuditionOutputSchema,
}).strict();

type MusicAuditionCheckpointV2Body = z.infer<typeof MusicAuditionCheckpointV2BodySchema>;

function checkpointV2Fingerprint(body: MusicAuditionCheckpointV2Body): string {
  return sha256Hex(canonicalJson(body));
}

export const MusicAuditionCheckpointV2Schema = MusicAuditionCheckpointV2BodySchema.extend({
  checkpointFingerprint: FingerprintSchema,
}).strict().superRefine((value, issue) => {
  const { checkpointFingerprint, ...body } = value;
  if (checkpointFingerprint !== checkpointV2Fingerprint(body)) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "music audition checkpoint fingerprint is invalid" });
  }
  const runAudioPrefix = `owner/${body.ownerId}/runs/${body.runId}/audio/`;
  for (const [label, key] of Object.entries({
    channelMusicProgramKey: body.channelMusicProgramKey,
    musicProviderAuditionSourceKey: body.musicProviderAuditionSourceKey,
    sourceMusicKey: body.sourceMusicKey,
    auditionWavKey: body.auditionWavKey,
  })) {
    if (!key.startsWith(runAudioPrefix) || key.includes("..")) {
      issue.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is outside the exact owner/run audio namespace` });
    }
  }
  if (!body.auditionWavKey.endsWith(`music-audition-${body.auditionOutput.contentSha256}.wav`)) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "music audition WAV key does not match the immutable output digest" });
  }
  if (!body.musicProviderAuditionSourceKey.endsWith(`music-provider-audition-${body.musicProviderAuditionSourceFingerprint}.json`)) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "music audition source receipt key does not match its immutable fingerprint" });
  }
});

export type MusicAuditionCheckpointV2 = z.infer<typeof MusicAuditionCheckpointV2Schema>;
export const AnyMusicAuditionCheckpointSchema = z.union([
  MusicAuditionCheckpointSchema,
  MusicAuditionCheckpointV2Schema,
]);
export type AnyMusicAuditionCheckpoint = z.infer<typeof AnyMusicAuditionCheckpointSchema>;

export function createMusicAuditionCheckpointV2(input: {
  readonly ownerId: string;
  readonly channelId: string;
  readonly runId: string;
  readonly invocationSha256: string;
  readonly channelMusicProgramKey: string;
  readonly musicProviderAuditionSourceKey: string;
  readonly expectedMusicKey: string;
  readonly source: unknown;
  readonly program: unknown;
}): MusicAuditionCheckpointV2 {
  const program = ChannelMusicProgramSchema.parse(input.program);
  const source = MusicProviderAuditionSourceSchema.parse(input.source);
  if (source.ownerId !== input.ownerId || source.channelId !== input.channelId || source.runId !== input.runId ||
      source.programFingerprint !== program.fingerprint || source.sourceMusicKey !== input.expectedMusicKey) {
    throw new Error("music provider audition source does not match its frozen run/program");
  }
  const body: MusicAuditionCheckpointV2Body = {
    version: MUSIC_AUDITION_CHECKPOINT_V2_VERSION,
    ownerId: input.ownerId,
    channelId: input.channelId,
    runId: input.runId,
    invocationSha256: input.invocationSha256,
    provider: source.provider,
    programFingerprint: program.fingerprint,
    channelMusicProgramKey: input.channelMusicProgramKey,
    musicProviderAuditionSourceKey: input.musicProviderAuditionSourceKey,
    musicProviderAuditionSourceFingerprint: source.fingerprint,
    sourceMusicKey: source.sourceMusicKey,
    auditionWavKey: source.auditionWavKey,
    sourceOutput: source.sourceOutput,
    auditionOutput: source.auditionOutput,
  };
  return Object.freeze(MusicAuditionCheckpointV2Schema.parse({
    ...body,
    checkpointFingerprint: checkpointV2Fingerprint(body),
  }));
}

export const MUSIC_AUDITION_APPROVAL_VERSION = "music-audition-approval/v1" as const;

const MusicAuditionApprovalBodySchema = z.object({
  version: z.literal(MUSIC_AUDITION_APPROVAL_VERSION),
  checkpointFingerprint: FingerprintSchema,
  qualityReceiptFingerprint: FingerprintSchema,
  reviewerId: text(320),
  approvedAt: z.number().int().nonnegative(),
}).strict();

type MusicAuditionApprovalBody = z.infer<typeof MusicAuditionApprovalBodySchema>;

export const MusicAuditionApprovalSchema = MusicAuditionApprovalBodySchema.extend({
  approvalFingerprint: FingerprintSchema,
}).strict().superRefine((value, issue) => {
  const { approvalFingerprint, ...body } = value;
  if (approvalFingerprint !== sha256Hex(canonicalJson(body))) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "music audition approval fingerprint is invalid" });
  }
});

export type MusicAuditionApproval = z.infer<typeof MusicAuditionApprovalSchema>;

/**
 * The approval receipt deliberately binds only immutable identities created
 * server-side: the selected checkpoint, the stored quality receipt, and the
 * authenticated reviewer. Browser requests never get to nominate an output,
 * program, storage key, or approval fingerprint.
 */
export function createMusicAuditionApproval(input: MusicAuditionApprovalBody): MusicAuditionApproval {
  const body = MusicAuditionApprovalBodySchema.parse(input);
  return Object.freeze(MusicAuditionApprovalSchema.parse({
    ...body,
    approvalFingerprint: sha256Hex(canonicalJson(body)),
  }));
}

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
