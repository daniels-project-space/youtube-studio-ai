import assert from "node:assert/strict";
import Module from "node:module";
import { createChannelMusicProgram } from "@/engine/channelMusicProgram";
import type { StageContext } from "@/engine/types";

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

const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (id, ...args) {
  if (id === "@/lib/storage") {
    return {
      getObjectBytes: async (key: string) => {
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
  console.log("MUSIC RELEASE GATE IDENTITY PASS: foreign MiniMax program receipts fail before native audio reads");
}

void main().finally(() => {
  loader._load = originalLoad;
});
