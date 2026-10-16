import assert from "node:assert/strict";

import { createChannelMusicProgram } from "@/engine/channelMusicProgram";
import {
  assertMusicAuditionNativeBytes,
  createMusicAuditionCheckpointV2,
  createMusicAuditionApproval,
  createMusicAuditionCheckpoint,
  createMusicProviderAuditionSource,
  AnyMusicAuditionCheckpointSchema,
  MusicAuditionApprovalSchema,
  MusicAuditionCheckpointSchema,
} from "@/engine/musicAuditionCheckpoint";
import { sha256BytesHex } from "@/lib/sha256";
import { getApprovedMusicAuditionResume, reject as rejectMusicAudition } from "../../../convex/musicAuditionCheckpoints";
import type { QueryCtx } from "../../../convex/_generated/server";
import {
  assertMusicAuditionReviewReceiptForCheckpoint,
  createMusicAuditionReviewReceipt,
} from "@/engine/musicAuditionReview";

const retainedWavBytes = new TextEncoder().encode("RIFF-native-music3-wav-fixture".repeat(3));
const retainedWavIntegrity = {
  contentSha256: sha256BytesHex(retainedWavBytes),
  byteLength: retainedWavBytes.byteLength,
};
assert.deepEqual(
  assertMusicAuditionNativeBytes({ expected: retainedWavIntegrity, bytes: retainedWavBytes }),
  retainedWavIntegrity,
);
assert.deepEqual(
  assertMusicAuditionNativeBytes({
    expected: { ...retainedWavIntegrity, durationSec: 12, sampleRateHz: 32_000, channels: 2, codec: "pcm_s16le" },
    bytes: retainedWavBytes,
  }),
  retainedWavIntegrity,
  "provider receipts may include format metadata while byte admission remains hash-and-length exact",
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
const rejectedReview = createMusicAuditionReviewReceipt({
  checkpoint, program, reviewerId: "owner-a", reviewedAt: 1_700_000_000_000,
  sectionReviews: program.generation.sections.map((section) => ({ sectionId: section.id, score: 0.2, evidence: "melody repeats without development" })),
  audition: { emotionalDepthScore: 0.2, arrangementDepthScore: 0.3, hollowOrGeneric: true, verdict: "fail", notes: "No meaningful lift in the second half." },
});
assert.equal(assertMusicAuditionReviewReceiptForCheckpoint(rejectedReview, checkpoint, "owner-a").fingerprint, rejectedReview.fingerprint);
assert.throws(() => assertMusicAuditionReviewReceiptForCheckpoint(rejectedReview, checkpoint, "owner-b"), /reviewer/u);
assert.throws(() => createMusicAuditionReviewReceipt({
  checkpoint, program, reviewerId: "owner-a", reviewedAt: 1,
  sectionReviews: program.generation.sections.map((section) => ({ sectionId: section.id, score: 2, evidence: "invalid score" })),
  audition: { emotionalDepthScore: 0, arrangementDepthScore: 0, hollowOrGeneric: true, verdict: "fail", notes: "invalid" },
}));
assert.throws(() => MusicAuditionCheckpointSchema.parse({ ...checkpoint, musicNativeWavKey: "owner/owner-a/runs/run-a/audio/not-the-native.wav" }), /content-addressed/);
const providerProgram = createChannelMusicProgram({
  channelId: "channel-a", channelIdentityFingerprint: "a".repeat(64), family: "music_loop",
  contentLaneKey: "music_loop", topic: "Rain behind a neon window", providerPreference: "mureka", durationSec: 20,
});
const sourceMusicBytes = new Uint8Array(2_000).fill(7);
const providerWavBytes = new Uint8Array(44 + 64_000).fill(8);
const providerWavDigest = sha256BytesHex(providerWavBytes);
const providerSource = createMusicProviderAuditionSource({
  ownerId: "owner-a", channelId: "channel-a", runId: "run-provider", provider: "mureka", program: providerProgram,
  sourceMusicKey: "owner/owner-a/runs/run-provider/audio/music.mp3", sourceBytes: sourceMusicBytes,
  durationSec: 10, auditionWavKey: `owner/owner-a/runs/run-provider/audio/music-audition-${providerWavDigest}.wav`,
  auditionWavBytes: providerWavBytes,
});
const providerCheckpoint = createMusicAuditionCheckpointV2({
  ownerId: "owner-a", channelId: "channel-a", runId: "run-provider", invocationSha256: "d".repeat(64),
  channelMusicProgramKey: "owner/owner-a/runs/run-provider/audio/channel-music-program.json",
  musicProviderAuditionSourceKey: `owner/owner-a/runs/run-provider/audio/music-provider-audition-${providerSource.fingerprint}.json`,
  expectedMusicKey: providerSource.sourceMusicKey, source: providerSource, program: providerProgram,
});
assert.equal(providerCheckpoint.provider, "mureka");
assert.equal(AnyMusicAuditionCheckpointSchema.parse(providerCheckpoint).checkpointFingerprint, providerCheckpoint.checkpointFingerprint);
assert.throws(() => createMusicAuditionCheckpointV2({
  ownerId: "owner-a", channelId: "channel-a", runId: "run-provider", invocationSha256: "d".repeat(64),
  channelMusicProgramKey: "owner/owner-a/runs/run-provider/audio/channel-music-program.json",
  musicProviderAuditionSourceKey: `owner/owner-a/runs/run-provider/audio/music-provider-audition-${providerSource.fingerprint}.json`,
  expectedMusicKey: "owner/owner-a/runs/run-provider/audio/substituted.mp3", source: providerSource, program: providerProgram,
}), /frozen run\/program/u);
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

async function testRegisteredRejectionMutation() {
  const checkpointRow = {
    _id: "checkpoint-a", ownerId: "owner-a", channelId: "channel-a", runId: "run-a",
    checkpoint, checkpointFingerprint: checkpoint.checkpointFingerprint, decision: "awaiting",
  } as Record<string, unknown>;
  const runRow = {
    _id: "run-a", ownerId: "owner-a", channelId: "channel-a", status: "awaiting_music_audition",
    musicAuditionCheckpointId: "checkpoint-a", musicAuditionCheckpointFingerprint: checkpoint.checkpointFingerprint,
  } as Record<string, unknown>;
  const rows: Record<string, Record<string, unknown>> = { "checkpoint-a": checkpointRow, "run-a": runRow };
  const ctx = {
    auth: { getUserIdentity: async () => ({ role: "service", owner_id: "owner-a", subject: "owner-a" }) },
    db: {
      get: async (id: string) => rows[id] ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => { Object.assign(rows[id], patch); },
    },
  } as never;
  const registered = rejectMusicAudition as unknown as {
    isMutation: boolean;
    _handler: (context: never, input: Record<string, unknown>) => Promise<unknown>;
  };
  assert.equal(registered.isMutation, true);
  const args = {
    ownerId: "owner-a", checkpointId: "checkpoint-a", reviewerId: "owner-a",
    reviewReceipt: rejectedReview, now: rejectedReview.reviewedAt,
  };
  assert.deepEqual(await registered._handler(ctx, args), {
    kind: "rejected", reused: false, reviewFingerprint: rejectedReview.fingerprint,
  });
  assert.equal(checkpointRow.reviewFingerprint, rejectedReview.fingerprint);
  assert.equal(runRow.status, "music_audition_rejected");
  assert.deepEqual(await registered._handler(ctx, args), {
    kind: "rejected", reused: true, reviewFingerprint: rejectedReview.fingerprint,
  });
  const changedReview = createMusicAuditionReviewReceipt({
    checkpoint, program, reviewerId: "owner-a", reviewedAt: rejectedReview.reviewedAt,
    sectionReviews: rejectedReview.sectionReviews,
    audition: { ...rejectedReview.audition, notes: "Different findings." },
  });
  await assert.rejects(registered._handler(ctx, { ...args, reviewReceipt: changedReview }), /replay changed its immutable review/u);
  console.log("MUSIC AUDITION REGISTERED MUTATION PASS: rejection receipt persists, replay is idempotent, changed feedback is refused");
}

Promise.all([testRegisteredResumeQuery(), testRegisteredRejectionMutation()]).catch((error) => { console.error(error); process.exitCode = 1; });
