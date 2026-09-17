import assert from "node:assert/strict";
import { assertPlanWeekPreparedNarrationArgs } from "@/trigger/planWeekPreparedNarration";
import { planWeekPreparationKey } from "@/lib/planWeekPreparation";

const base = {
  ownerId: "owner-1",
  channelId: "channel-1",
  channelSlug: "history",
  batchId: "batch-1",
  itemId: "item-1",
  manifestSha256: "a".repeat(64),
  maxCostUsd: 2,
  provider: "qwen3" as const,
  speaker: "Ryan",
  language: "en",
  speed: 0.96,
  baseGapSec: 0.9,
  jitterSec: 0.15,
};

const parsed = assertPlanWeekPreparedNarrationArgs({
  ...base,
  manifestKey: planWeekPreparationKey(base),
});
assert.equal(parsed.provider, "qwen3");
assert.equal(parsed.speed, 0.96);
assert.equal(parsed.baseGapSec, 0.9);

assert.throws(
  () => assertPlanWeekPreparedNarrationArgs({ ...base, manifestKey: "owner/foreign/not-a-manifest" }),
  /canonical/,
);
assert.throws(
  () => assertPlanWeekPreparedNarrationArgs({ ...base, manifestKey: planWeekPreparationKey(base), maxCostUsd: 0 }),
  /maxCostUsd/,
);
assert.throws(
  () => assertPlanWeekPreparedNarrationArgs({ ...base, manifestKey: planWeekPreparationKey(base), speed: 1.4 }),
  /speed/,
);
assert.throws(
  () => assertPlanWeekPreparedNarrationArgs({ ...base, manifestKey: planWeekPreparationKey(base), provider: "unknown" }),
  /provider/,
);

console.log("weekly prepared narration producer contract passed");
