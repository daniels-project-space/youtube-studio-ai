import assert from "node:assert/strict";
import { assertPlanWeekPreparedImagesArgs } from "@/trigger/planWeekPreparedImages";
import { planWeekPreparationKey } from "@/lib/planWeekPreparation";

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
console.log("weekly prepared image producer contract passed");

