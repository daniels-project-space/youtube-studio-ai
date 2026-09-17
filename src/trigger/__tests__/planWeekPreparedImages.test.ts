import assert from "node:assert/strict";
import { assertPlanWeekPreparedImagesArgs, buildPreparedH3Batch, hasGeneratedFootageStage } from "@/trigger/planWeekPreparedImages";
import { planWeekPreparationKey, type PlanWeekPreparationManifest, type PlanWeekPreparedImages } from "@/lib/planWeekPreparation";
import { assertMiniMaxH3WeeklyBatchArgs } from "@/trigger/minimaxH3WeeklyBatch";

const scope = { ownerId: "owner1", channelSlug: "history", batchId: "week-1", itemId: "item-1" };
const base = {
  ...scope,
  channelId: "channel1",
  manifestKey: planWeekPreparationKey(scope),
  manifestSha256: "a".repeat(64),
  shots: [{ id: "shot-1", prompt: "A candlelit archive with a sealed battlefield map", seed: 7 }],
  maxCostUsd: 5,
};

const parsed = assertPlanWeekPreparedImagesArgs(base);
assert.equal(parsed.generationProfile, "production");
assert.equal(parsed.shots[0]?.candidateCount, undefined);
assert.equal(parsed.shots[0]?.prompt, base.shots[0].prompt);

assert.throws(
  () => assertPlanWeekPreparedImagesArgs({ ...base, shots: [{ id: "shot-1", prompt: "x", candidateCount: 5 }] }),
  /candidate count is invalid/,
);
assert.throws(
  () => assertPlanWeekPreparedImagesArgs({ ...base, shots: [{ id: "shot-1", prompt: "x" }, { id: "shot-1", prompt: "y" }] }),
  /shot ids must be unique/,
);
assert.throws(
  () => assertPlanWeekPreparedImagesArgs({ ...base, manifestKey: "owner/other/manifest.json" }),
  /manifest key is not canonical/,
);
assert.throws(
  () => assertPlanWeekPreparedImagesArgs({
    ...base,
    shots: Array.from({ length: 241 }, (_, index) => ({ id: `shot-${index}`, prompt: "x" })),
  }),
  /requires 1\.\.240 approved shots/,
);

const prepared = {
  items: [{ shotId: "shot-1", candidateIndex: 0, stillKey: "owner/owner1/still.png", sha256: "b".repeat(64), byteLength: 4 }],
} as unknown as PlanWeekPreparedImages;
const h3Batch = buildPreparedH3Batch({ payload: parsed, prepared, manifestSha256: base.manifestSha256, maxCostUsd: 0.4 });
assert.equal(h3Batch.jobs.length, 1);
assert.equal(h3Batch.sceneIds[0], "shot-1");
assert.match(h3Batch.jobs[0]!.output.r2Key, /prepared\/footage\/clip-0001\.mp4$/);
assert.match(h3Batch.jobs[0]!.firstFrame.r2Key, /prepared\/h3\/first-frame-0001\.png$/);
const h3Payload = assertMiniMaxH3WeeklyBatchArgs({
  ownerId: scope.ownerId,
  orderKey: h3Batch.orderKey,
  receiptKey: h3Batch.receiptKey,
  jobs: h3Batch.jobs,
  preparedFootage: {
    ownerId: scope.ownerId,
    channelSlug: scope.channelSlug,
    batchId: scope.batchId,
    itemId: scope.itemId,
    manifestKey: base.manifestKey,
    manifestSha256: base.manifestSha256,
    sceneIds: h3Batch.sceneIds,
  },
});
assert.equal(h3Payload.jobs.length, 1);
assert.equal(hasGeneratedFootageStage({ execution: { pipeline: [{ block: "gen_footage" }] } } as unknown as PlanWeekPreparationManifest), true);
assert.equal(hasGeneratedFootageStage({ execution: { pipeline: [{ block: "stock_footage" }] } } as unknown as PlanWeekPreparationManifest), false);
console.log("weekly prepared image producer contract passed");
