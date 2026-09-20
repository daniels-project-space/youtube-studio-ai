import assert from "node:assert/strict";

import { createChannelMusicProgram } from "@/engine/channelMusicProgram";
import {
  assertMusicAuditionNativeBytes,
  createMusicAuditionApproval,
  createMusicAuditionCheckpoint,
  MusicAuditionApprovalSchema,
  MusicAuditionCheckpointSchema,
} from "@/engine/musicAuditionCheckpoint";
import { sha256BytesHex } from "@/lib/sha256";
import { getApprovedMusicAuditionResume } from "../../../convex/musicAuditionCheckpoints";
import type { QueryCtx } from "../../../convex/_generated/server";

const retainedWavBytes = new TextEncoder().encode("RIFF-native-music3-wav-fixture".repeat(3));
const retainedWavIntegrity = {
  contentSha256: sha256BytesHex(retainedWavBytes),
  byteLength: retainedWavBytes.byteLength,
};
assert.deepEqual(
  assertMusicAuditionNativeBytes({ expected: retainedWavIntegrity, bytes: retainedWavBytes }),
  retainedWavIntegrity,
);
assert.throws(
  () => assertMusicAuditionNativeBytes({ expected: retainedWavIntegrity, bytes: new Uint8Array([...retainedWavBytes, 0]) }),
  /retained native Music3 WAV does not match/u,
  "approval/release boundaries must reject a retained object with one changed byte",
);

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

async function testRegisteredResumeQuery() {
  const args = {
    ownerId: "owner-a", channelId: "channel-a", runId: "run-a", checkpointId: "checkpoint-a",
    checkpointFingerprint: checkpoint.checkpointFingerprint,
    invocationSha256: checkpoint.invocationSha256,
    qualityReceiptFingerprint: approval.qualityReceiptFingerprint,
    approvalFingerprint: approval.approvalFingerprint,
  };
  const qualityReceiptKey = "owner/owner-a/runs/run-a/audio/quality.json";
  const rows: Record<string, Record<string, unknown>> = {
    "channel-a": { ownerId: "owner-a" },
    "run-a": {
      ownerId: "owner-a", channelId: "channel-a",
      pipelineInvocationSha256: checkpoint.invocationSha256,
      musicAuditionCheckpointId: "checkpoint-a",
      musicAuditionCheckpointFingerprint: checkpoint.checkpointFingerprint,
      musicAuditionQualityReceiptFingerprint: approval.qualityReceiptFingerprint,
      musicAuditionQualityReceiptKey: qualityReceiptKey,
      musicAuditionApprovalFingerprint: approval.approvalFingerprint,
      musicAuditionResumeState: "pending",
    },
    "checkpoint-a": {
      _id: "checkpoint-a", ownerId: "owner-a", channelId: "channel-a", runId: "run-a",
      decision: "approved", checkpoint, qualityReceiptKey,
      qualityReceiptFingerprint: approval.qualityReceiptFingerprint,
      approvalFingerprint: approval.approvalFingerprint,
    },
  };
  let role = "service";
  let authenticated = true;
  const stage = { status: "ok", outputs: {
    musicProvider: "minimax_music3",
    channelMusicProgramKey: checkpoint.channelMusicProgramKey,
    musicRuntimeReceiptKey: checkpoint.musicRuntimeReceiptKey,
    musicNativeWavKey: checkpoint.musicNativeWavKey,
  } };
  const ctx = {
    auth: { getUserIdentity: async () => authenticated ? { role, owner_id: "owner-a", subject: "owner-a" } : null },
    db: {
      normalizeId: (_table: string, id: string) => id,
      get: async (id: string) => rows[id] ?? null,
      query: (table: string) => {
        assert.equal(table, "runStages");
        return { withIndex: (name: string, build: (range: unknown) => unknown) => {
          assert.equal(name, "by_run_block");
          const filters: unknown[] = [];
          const range = { eq: (key: string, value: unknown) => { filters.push([key, value]); return range; } };
          build(range);
          assert.deepEqual(filters, [["runId", "run-a"], ["block", "music"]]);
          return { take: async () => [stage] };
        } };
      },
    },
  } as unknown as QueryCtx;
  const registered = getApprovedMusicAuditionResume as unknown as {
    isQuery: boolean;
    _handler: (context: QueryCtx, input: typeof args) => Promise<unknown>;
  };
  assert.equal(registered.isQuery, true);
  const invoke = () => registered._handler(ctx, args);
  assert.deepEqual(await invoke(), { qualityReceiptKey });
  authenticated = false;
  await assert.rejects(invoke, /authentication required/);
  authenticated = true;
  role = "owner";
  await assert.rejects(invoke, /bound studio service identity/);
  role = "service";
  rows["channel-a"].ownerId = "other-owner";
  await assert.rejects(invoke, /resource access denied/);
  rows["channel-a"].ownerId = "owner-a";
  args.approvalFingerprint = "0".repeat(64);
  await assert.rejects(invoke, /immutable approval receipt/);
  args.approvalFingerprint = approval.approvalFingerprint;
  stage.outputs.musicNativeWavKey = "substituted.wav";
  await assert.rejects(invoke, /sealed music stage/);
  console.log("MUSIC AUDITION REGISTERED QUERY PASS: authenticated approval and rejected auth/owner/receipt/stage substitutions");
}

testRegisteredResumeQuery().catch((error) => { console.error(error); process.exitCode = 1; });
