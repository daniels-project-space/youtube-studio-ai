import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createMiniMaxH3WeeklyFallbackReceipt,
} from "../minimaxH3WeeklyBatch";
import { MINIMAX_H3_MANIFEST_SHA256 } from "@/lib/minimaxH3";
import { MINIMAX_H3_OPENRELAY_RUNTIME_ID } from "@/lib/minimaxH3";

const root = join(process.cwd(), "src/trigger");
const retrySource = readFileSync(join(root, "minimaxH3WeeklyCapacityRetry.ts"), "utf8");
const fallbackSource = readFileSync(join(root, "minimaxH3WeeklyOpenRelayFallback.ts"), "utf8");
const weeklySource = readFileSync(join(root, "minimaxH3WeeklyBatch.ts"), "utf8");

assert.match(retrySource, /assertMiniMaxH3SaladCapacity\(payload\.jobs\.length/);
assert.match(retrySource, /MINIMAX_H3_WEEKLY_CAPACITY_FALLBACK_MS/);
assert.match(retrySource, /queueMiniMaxH3WeeklyCapacityRetry\(\{ payload, now \}\)/);
assert.match(retrySource, /minimax-h3-weekly-openrelay-fallback/);
assert.match(retrySource, /state: "fallback_queued"/);
assert.match(fallbackSource, /ensureOpenRelayH3Ready\(\)/);
assert.match(fallbackSource, /provider: "openrelay"/);
assert.match(fallbackSource, /execution: "weekly-fallback"/);
assert.match(fallbackSource, /ifNoneMatch: "\*"/);
assert.match(fallbackSource, /h3-fallback-provider.*openrelay/);
assert.match(weeklySource, /automatic weekly capacity retry could not be scheduled/);
assert.match(weeklySource, /capacityHoldStartedAt: payload\.capacityHoldStartedAt/);

const fakeReceipt = {
  schema: "minimax-h3-worker/v1" as const,
  requestKey: "a".repeat(64),
  jobId: "job",
  execution: "weekly-fallback" as const,
  profile: {
    id: "official-turbo8-native-768p" as const,
    width: 1344 as const,
    height: 768 as const,
    fps: 24 as const,
    frames: 124 as const,
    steps: 8 as const,
  },
  promptSha256: "b".repeat(64),
  seed: 1,
  firstFrame: { r2Key: "owner/test/frame.png", sha256: "c".repeat(64) },
  output: { r2Key: "owner/test/out.mp4", contentSha256: "d".repeat(64), byteLength: 1024, contentType: "video/mp4" as const },
  runtime: {
    provider: "openrelay" as const,
    gpuModel: "A100" as const,
    runtimeId: MINIMAX_H3_OPENRELAY_RUNTIME_ID,
    modelManifestSha256: MINIMAX_H3_MANIFEST_SHA256,
    capacityMode: "persistent-disk-auto-stop" as const,
    costUsd: 0.1,
  },
};
const result = [{ requestKey: fakeReceipt.requestKey, receipt: fakeReceipt, outputBytes: new Uint8Array(1024) }];
const receipt = createMiniMaxH3WeeklyFallbackReceipt({
  orderKey: "weekly-test",
  sourceRequestKeys: ["f".repeat(64)],
  result,
  waitedMs: 86_400_000,
  createdAt: 1,
});
assert.equal(receipt.schema, "minimax-h3-weekly-batch/v2");
assert.deepEqual(receipt.sourceRequestKeys, ["f".repeat(64)]);
assert.deepEqual(receipt.fallback, { provider: "openrelay", reason: "salad-capacity-timeout", waitedMs: 86_400_000 });
assert.equal(receipt.providerReceipts?.[0]?.runtime.capacityMode, "persistent-disk-auto-stop");
console.log("MiniMax H3 weekly capacity retry/fallback contracts passed");
