import assert from "node:assert/strict";
import { assertPlanWeekPreparedScriptArgs } from "@/trigger/planWeekPreparedScript";
import { planWeekPreparationKey } from "@/lib/planWeekPreparation";

const scope = { ownerId: "owner1", channelSlug: "history", batchId: "week-1", itemId: "item-1" };
const base = {
  ...scope,
  channelId: "channel1",
  manifestKey: planWeekPreparationKey(scope),
  manifestSha256: "a".repeat(64),
  maxSeconds: 240,
  maxCostUsd: 2,
};
const parsed = assertPlanWeekPreparedScriptArgs(base);
assert.equal(parsed.maxSeconds, 240);
assert.equal(parsed.maxCostUsd, 2);
assert.throws(() => assertPlanWeekPreparedScriptArgs({ ...base, maxSeconds: 29 }), /between 30 and 1800/);
assert.throws(() => assertPlanWeekPreparedScriptArgs({ ...base, maxCostUsd: 0 }), /greater than zero/);
assert.throws(() => assertPlanWeekPreparedScriptArgs({ ...base, manifestKey: "owner/other/inputs.json" }), /not canonical/);
console.log("weekly prepared script producer contract passed");

