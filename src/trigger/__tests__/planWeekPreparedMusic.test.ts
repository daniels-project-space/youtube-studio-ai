import assert from "node:assert/strict";
import { assertPlanWeekPreparedMusicArgs } from "@/trigger/planWeekPreparedMusic";
import { planWeekPreparationKey } from "@/lib/planWeekPreparation";

const base = {
  ownerId: "owner-1",
  channelId: "channel-1",
  channelSlug: "history",
  batchId: "batch-1",
  itemId: "item-1",
  manifestSha256: "a".repeat(64),
  maxCostUsd: 1,
  provider: "mureka" as const,
  trackCount: 2,
};

const parsed = assertPlanWeekPreparedMusicArgs({ ...base, manifestKey: planWeekPreparationKey(base) });
assert.equal(parsed.provider, "mureka");
assert.equal(parsed.trackCount, 2);

assert.throws(
  () => assertPlanWeekPreparedMusicArgs({ ...base, manifestKey: "owner/foreign/not-a-manifest" }),
  /canonical/,
);
assert.throws(
  () => assertPlanWeekPreparedMusicArgs({ ...base, manifestKey: planWeekPreparationKey(base), maxCostUsd: 0 }),
  /maxCostUsd/,
);
assert.throws(
  () => assertPlanWeekPreparedMusicArgs({ ...base, manifestKey: planWeekPreparationKey(base), trackCount: 9 }),
  /trackCount/,
);
assert.throws(
  () => assertPlanWeekPreparedMusicArgs({ ...base, manifestKey: planWeekPreparationKey(base), provider: "unknown" }),
  /provider/,
);

console.log("weekly prepared music producer contract passed");
