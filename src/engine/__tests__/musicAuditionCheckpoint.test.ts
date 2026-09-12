import assert from "node:assert/strict";

import { createChannelMusicProgram } from "@/engine/channelMusicProgram";
import {
  createMusicAuditionApproval,
  createMusicAuditionCheckpoint,
  MusicAuditionApprovalSchema,
  MusicAuditionCheckpointSchema,
} from "@/engine/musicAuditionCheckpoint";

const program = createChannelMusicProgram({
  channelId: "channel-a",
  channelIdentityFingerprint: "a".repeat(64),
  family: "music_loop",
  contentLaneKey: "music_loop",
  topic: "Rain behind a neon window",
  providerPreference: "minimax_music3",
  durationSec: 20,
});
const digest = "b".repeat(64);
const checkpoint = createMusicAuditionCheckpoint({
  ownerId: "owner-a",
  channelId: "channel-a",
  runId: "run-a",
  invocationSha256: "c".repeat(64),
  channelMusicProgramKey: "owner/owner-a/runs/run-a/audio/channel-music-program.json",
  musicRuntimeReceiptKey: "owner/owner-a/runs/run-a/audio/minimax-music3-runtime.json",
  musicNativeWavKey: `owner/owner-a/runs/run-a/audio/minimax-music3-native-${digest}.wav`,
  program,
  runtimeReceipt: {
    programFingerprint: program.fingerprint,
    durationSec: 20,
    output: { contentSha256: digest, byteLength: 2_560_044, sampleRateHz: 32_000, channels: 2, codec: "pcm_s16le" },
  },
});
assert.equal(checkpoint.programFingerprint, program.fingerprint);
assert.throws(() => MusicAuditionCheckpointSchema.parse({ ...checkpoint, musicNativeWavKey: "owner/owner-a/runs/run-a/audio/not-the-native.wav" }), /content-addressed/);
const runtimeOutput = {
  contentSha256: checkpoint.nativeOutput.contentSha256,
  byteLength: checkpoint.nativeOutput.byteLength,
  sampleRateHz: checkpoint.nativeOutput.sampleRateHz,
  channels: checkpoint.nativeOutput.channels,
  codec: checkpoint.nativeOutput.codec,
};
assert.throws(() => createMusicAuditionCheckpoint({
  ...checkpoint,
  program,
  runtimeReceipt: {
    programFingerprint: "d".repeat(64),
    durationSec: 20,
    output: runtimeOutput,
  },
}), /different channel music program/);
const approval = createMusicAuditionApproval({
  version: "music-audition-approval/v1",
  checkpointFingerprint: checkpoint.checkpointFingerprint,
  qualityReceiptFingerprint: "e".repeat(64),
  reviewerId: "owner-a",
  approvedAt: 1_700_000_000_000,
});
assert.equal(MusicAuditionApprovalSchema.parse(approval).approvalFingerprint, approval.approvalFingerprint);
assert.throws(
  () => MusicAuditionApprovalSchema.parse({ ...approval, qualityReceiptFingerprint: "f".repeat(64) }),
  /approval fingerprint is invalid/,
);
console.log("MUSIC AUDITION CHECKPOINT PASS — owner/run/native-WAV and approval receipt identities are immutable and content-bound");
