import assert from "node:assert/strict";
import Module from "node:module";
import { createChannelMusicProgram } from "@/engine/channelMusicProgram";
import type { StageContext } from "@/engine/types";
import { sha256BytesHex } from "@/lib/sha256";
import { musicReuseTestReceipt, musicReuseTestStyleDNA } from "./musicReuseFixtures";

const ctx: StageContext = {
  ownerId: "owner-release-gate",
  channelId: "channel-release-gate",
  runId: "run-release-gate",
  keyPrefix: "owner/owner-release-gate/",
  params: {},
  store: {},
  budgetUsd: 0,
  log: () => {},
};
const program = createChannelMusicProgram({
  channelId: String(ctx.channelId),
  channelIdentityFingerprint: "a".repeat(64),
  family: "narrated_stock",
  contentLaneKey: "narrated_stock",
  topic: "Quiet evening",
  providerPreference: "minimax_music3",
});
const objects = new Map([
  ["program.json", Buffer.from(JSON.stringify(program))],
  ["runtime.json", Buffer.from("{}")],
  ["quality.json", Buffer.from("{}")],
]);
const objectReads: string[] = [];

const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (id, ...args) {
  if (id === "@/lib/storage") {
    return {
      getObjectBytes: async (key: string) => {
        objectReads.push(key);
        const bytes = objects.get(key);
        if (!bytes) throw new Error(`unexpected object read: ${key}`);
        return bytes;
      },
    };
  }
  if (id === "@/lib/minimaxMusic3") {
    return {
      assertPinnedMiniMaxMusic3Receipt: () => {
        throw new Error("runtime receipt validation must not run for a foreign program");
      },
    };
  }
  return originalLoad.call(this, id, ...args);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { assertMusicQualityForPublish } = require("../musicReleaseGate") as typeof import("../musicReleaseGate");

async function main() {
  const foreignProgramContext: StageContext = {
    ...ctx,
    store: {
      musicProvider: "minimax_music3",
      musicKey: "master.mp3",
      musicQualityReviewStatus: "awaiting-human-audition",
      channelMusicProgramKey: "program.json",
      channelMusicProgramFingerprint: "b".repeat(64),
      musicRuntimeReceiptKey: "runtime.json",
      musicQualityReceiptKey: "quality.json",
    },
  };
  await assert.rejects(
    assertMusicQualityForPublish(foreignProgramContext),
    /does not match this run's sealed fingerprint/u,
  );
  assert.deepEqual(objectReads, ["program.json", "runtime.json", "quality.json"],
    "a foreign MiniMax program must fail before any native audio bytes are read");

  const reusedAudio = Buffer.alloc(1_024, 9);
  objects.set("reused.mp3", reusedAudio);
  const reuseReceipt = {
    ...musicReuseTestReceipt({ ownerId: String(ctx.ownerId), baseRunId: "base-run", baseChannelId: "base-channel",
      siblingChannelId: String(ctx.channelId), family: "narrated_stock", contentLaneKey: "narrated_stock",
      provider: "mureka", musicKey: "reused.mp3" }),
    audioSha256: sha256BytesHex(reusedAudio),
    audioByteLength: reusedAudio.byteLength,
  };
  objectReads.length = 0;
  await assertMusicQualityForPublish({ ...ctx, store: {
    musicProvider: "reuse", musicKey: "reused.mp3", musicQualityReviewStatus: "not-required-reused-master",
    reuseMusicReceipt: reuseReceipt,
    styleDNA: musicReuseTestStyleDNA,
  } });
  assert.deepEqual(objectReads, ["reused.mp3"], "reuse release re-reads and hashes the exact durable audio");
  for (const receipt of [undefined, { ...reuseReceipt, siblingChannelId: "foreign-sibling" },
    { ...reuseReceipt, audioSha256: "b".repeat(64) },
    { ...reuseReceipt, soundProfileFingerprint: "c".repeat(64) }]) {
    objectReads.length = 0;
    await assert.rejects(assertMusicQualityForPublish({ ...ctx, store: {
      musicProvider: "reuse", musicKey: "reused.mp3", musicQualityReviewStatus: "not-required-reused-master",
      reuseMusicReceipt: receipt,
      styleDNA: musicReuseTestStyleDNA,
    } }), /music reuse receipt/u);
    assert.deepEqual(objectReads, ["reused.mp3"], "invalid or mismatched reuse proof cannot pass release");
  }
  objects.set("reused.mp3", Buffer.alloc(reusedAudio.byteLength, 8));
  await assert.rejects(assertMusicQualityForPublish({ ...ctx, store: {
    musicProvider: "reuse", musicKey: "reused.mp3", musicQualityReviewStatus: "not-required-reused-master",
    reuseMusicReceipt: reuseReceipt,
    styleDNA: musicReuseTestStyleDNA,
  } }), /exact audio bytes/u, "same-length replacement bytes cannot pass a previously valid receipt");

  for (const provider of ["mureka", "suno"] as const) {
    objectReads.length = 0;
    await assert.rejects(
      assertMusicQualityForPublish({
        ...ctx,
        store: {
          musicProvider: provider,
          musicKey: "master.mp3",
          musicQualityReviewStatus: "not-required-provider-route",
        },
      }),
      /review state is missing or invalid/u,
      `${provider} cannot claim that owner review is unnecessary`,
    );
    assert.deepEqual(objectReads, [], `${provider} invalid review state must stop before storage reads`);

    const requiredEvidenceKeys = [
      "program.json", "source.json", "quality.json", "master.mp3", "audition.wav",
    ];
    await assert.rejects(
      assertMusicQualityForPublish({
        ...ctx,
        store: {
          musicProvider: provider,
          musicKey: "master.mp3",
          musicQualityReviewStatus: "awaiting-human-audition",
          channelMusicProgramKey: "program.json",
          channelMusicProgramFingerprint: program.fingerprint,
          musicAuditionSourceKey: "source.json",
          musicQualityReceiptKey: "quality.json",
          musicAuditionWavKey: "audition.wav",
        },
      }),
      /unexpected object read/u,
      `${provider} with an awaiting status must still require its durable review objects`,
    );
    assert.deepEqual(objectReads, requiredEvidenceKeys,
      `${provider} release must load program, source, quality receipt, master, and audition bytes`);
  }
  console.log("MUSIC RELEASE GATE PASS: byte-bound reuse plus foreign MiniMax identity and missing provider audition evidence fail closed");
}

void main().finally(() => {
  loader._load = originalLoad;
});
