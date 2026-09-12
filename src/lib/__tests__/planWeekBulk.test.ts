import assert from "node:assert/strict";
import {
  assertPlanWeekBulkOrder,
  buildPlanWeekBulkOrder,
} from "@/lib/planWeekBulk";

const base = {
  ownerId: "owner-test",
  channelIds: ["channel:z", "channel:a"],
  count: 3,
  requestKey: "week-2026-09-12",
};

const order = buildPlanWeekBulkOrder(base);
assert.deepEqual(order.channels.map((channel) => channel.channelId), ["channel:a", "channel:z"]);
assert.equal(order.totalItems, 6);
assert.equal(order.reservedCostUsd, Number((order.channels[0].reservation.totalUsd * 2).toFixed(6)));
assert.equal(assertPlanWeekBulkOrder(order).fingerprint, order.fingerprint);

const reordered = buildPlanWeekBulkOrder({ ...base, channelIds: [...base.channelIds].reverse() });
assert.equal(reordered.fingerprint, order.fingerprint, "caller order cannot change the weekly order identity");
assert.deepEqual(reordered.channels, order.channels);

assert.throws(
  () => buildPlanWeekBulkOrder({ ...base, channelIds: ["channel:a", "channel:a"] }),
  /unique/,
);
assert.throws(
  () => buildPlanWeekBulkOrder({ ...base, channelIds: ["channel/a"] }),
  /safe identifiers/,
);
assert.throws(
  () => buildPlanWeekBulkOrder({ ...base, channelIds: ["channel:a"], requestKey: "" }),
  /request key is required/,
);
assert.throws(
  () => buildPlanWeekBulkOrder({ ...base, count: 0 }),
  /count must be an integer/,
);
assert.throws(
  () => buildPlanWeekBulkOrder({ ...base, budgetCapUsd: order.reservedCostUsd - 0.0001 }),
  /exceeds caller cap/,
);
assert.throws(
  () => buildPlanWeekBulkOrder({
    ...base,
    channelIds: Array.from({ length: 12 }, (_, index) => `channel-${index}`),
    count: 6,
  }),
  /cannot exceed/,
);

console.log("plan-week bulk order contracts passed");
