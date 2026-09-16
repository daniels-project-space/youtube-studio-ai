import assert from "node:assert/strict";
import {
  assertMiniMaxH3WeeklyBatchArgs,
  createMiniMaxH3WeeklyRequestPacket,
  miniMaxH3WeeklyJobReceiptKey,
} from "@/trigger/minimaxH3WeeklyBatch";
import { miniMaxH3WeeklyRequestPacketKey } from "@/lib/minimaxH3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const weeklySource = readFileSync(resolve(process.cwd(), "src/trigger/minimaxH3WeeklyBatch.ts"), "utf8");

const valid = {
  orderKey: "week-20260913-owner-a",
  receiptKey: "owner/a/plan-batches/week-20260913/h3/receipt.json",
  jobs: [{
    prompt: "A readable action, no words.", seed: 3,
    firstFrame: { r2Key: "owner/a/frames/001.png", sha256: "a".repeat(64) },
    output: { r2Key: "owner/a/plan-batches/week-20260913/items/001/preparation/footage/clip-0001.mp4" },
    maxCostUsd: 0.5,
  }],
};
assert.equal(assertMiniMaxH3WeeklyBatchArgs(valid).orderKey, valid.orderKey);
assert.equal(
  miniMaxH3WeeklyRequestPacketKey(valid.receiptKey),
  "owner/a/plan-batches/week-20260913/h3/receipt.request.json",
  "the pre-spend packet must have a deterministic sibling key",
);
assert.equal(
  miniMaxH3WeeklyJobReceiptKey(valid.receiptKey, "a".repeat(64)),
  "owner/a/plan-batches/week-20260913/h3/receipt.job-" + "a".repeat(64) + ".json",
  "each shot claim must have a deterministic sibling key",
);
assert.throws(() => miniMaxH3WeeklyJobReceiptKey(valid.receiptKey, "not-a-request"), /request key/);
assert.deepEqual(
  createMiniMaxH3WeeklyRequestPacket({ ...valid, requestKeys: ["request-1"], createdAt: 1234 }),
  { schema: "minimax-h3-weekly-request/v1", orderKey: valid.orderKey, requestKeys: ["request-1"], jobs: valid.jobs, createdAt: 1234 },
  "the frozen packet must retain the exact ordered jobs and request identities",
);
assert.throws(() => assertMiniMaxH3WeeklyBatchArgs({ ...valid, receiptKey: "../receipt.json" }), /receipt key/);
assert.throws(() => assertMiniMaxH3WeeklyBatchArgs({ ...valid, jobs: [{ ...valid.jobs[0], output: { r2Key: "other/path.mp4" } }] }), /owner-scoped/);
assert.throws(() => assertMiniMaxH3WeeklyBatchArgs({ ...valid, jobs: [{ ...valid.jobs[0], firstFrame: { ...valid.jobs[0].firstFrame, r2Key: "owner/../frame.png" } }] }), /first-frame/);
assert.throws(() => assertMiniMaxH3WeeklyBatchArgs({ ...valid, jobs: [{ ...valid.jobs[0], prompt: "" }] }), /job 1 is invalid.*prompt/);
assert.throws(() => assertMiniMaxH3WeeklyBatchArgs({ ...valid, jobs: [{ ...valid.jobs[0], firstFrame: { ...valid.jobs[0].firstFrame, sha256: "bad" } }] }), /job 1 is invalid.*digest/);
assert.throws(() => assertMiniMaxH3WeeklyBatchArgs({ ...valid, jobs: [valid.jobs[0], valid.jobs[0]] }), /duplicate (request identity|output key)/);
const prepared = assertMiniMaxH3WeeklyBatchArgs({
  ...valid,
  jobs: [{
    ...valid.jobs[0],
    firstFrame: {
      ...valid.jobs[0].firstFrame,
      r2Key: "owner/a/channel/frozen-history/plan-batches/batch-1/items/item-1/preparation/h3/first-frame-0001.png",
    },
    output: {
      r2Key: "owner/a/channel/frozen-history/plan-batches/batch-1/items/item-1/preparation/footage/clip-0001.mp4",
    },
  }],
  preparedFootage: {
    ownerId: "a",
    channelSlug: "frozen-history",
    batchId: "batch-1",
    itemId: "item-1",
    manifestKey: "owner/a/channel/frozen-history/plan-batches/batch-1/items/item-1/preparation/inputs.json",
    manifestSha256: "c".repeat(64),
    sceneIds: ["shot-1"],
  },
});
assert.equal(prepared.preparedFootage?.sceneIds[0], "shot-1");
assert.throws(
  () => assertMiniMaxH3WeeklyBatchArgs({
    ...valid,
    preparedFootage: { ...prepared.preparedFootage!, manifestKey: "owner/a/other/manifest.json" },
  }),
  /manifest key is not canonical/,
);
assert.match(
  weeklySource,
  /providerReceipts: result\.map\(\(item\) => item\.receipt\)/,
  "weekly receipt must retain full per-shot H3 provenance for prepared-footage reconciliation",
);
assert.match(
  weeklySource,
  /persistWeeklyJobReceipt\([\s\S]*onJobComplete/,
  "each verified shot must be persisted before the aggregate batch receipt",
);
assert.match(
  weeklySource,
  /createMiniMaxH3WeeklyJobReceipt\(args\)/,
  "shot claims must use one canonical receipt constructor",
);
assert.match(
  weeklySource,
  /readPersistedJobReceipts\([\s\S]*pendingJobs/,
  "replays must restore completed shot claims and render only missing jobs",
);
assert.match(
  weeklySource,
  /assertMiniMaxH3SaladCapacity\(payload\.jobs\.length,\s*\{/,
  "weekly paid dispatch must be gated by a current Salad capacity admission",
);
const admissionIndex = weeklySource.indexOf("assertMiniMaxH3SaladCapacity(payload.jobs.length");
const upgradeIndex = weeklySource.indexOf("api.saladFleetReservations.upgradePriority");
const providerStartIndex = weeklySource.indexOf("providerStarted = true;");
assert(admissionIndex >= 0 && upgradeIndex > admissionIndex && providerStartIndex > upgradeIndex,
  "high fallback must upgrade the durable Salad lease after admission and before any provider request");
assert.match(weeklySource, /priority:\s*"high"/, "the high-priority lease upgrade must be explicit");
console.log("weekly MiniMax H3 batch task contracts passed");
