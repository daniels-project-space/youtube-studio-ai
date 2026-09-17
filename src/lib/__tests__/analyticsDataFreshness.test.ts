import assert from "node:assert/strict";

import { analyticsDataFreshness } from "@/lib/analyticsDataFreshness";
import { ANALYTICS_REFRESH_STALE_AFTER_MS } from "@/lib/analyticsRefreshPresentation";

const now = 2_000_000_000_000;
const healthy = { status: "active", scopeHealth: "healthy" } as const;
const current = {
  activeState: null,
  activeMode: null,
  videoRequestStatus: null,
  channelRequestStatus: null,
  lastCompletedAt: now,
} as const;

assert.deepEqual(analyticsDataFreshness([{ connection: healthy, refresh: current }], now), {
  state: "current",
  currentCount: 1,
  channelCount: 1,
  label: "Live analytics",
  detail: "1 of 1 channel current.",
});

assert.deepEqual(analyticsDataFreshness([
  { connection: healthy, refresh: current },
  { connection: healthy, refresh: { ...current, lastCompletedAt: now - ANALYTICS_REFRESH_STALE_AFTER_MS - 1 } },
  { connection: null, refresh: null },
], now), {
  state: "recorded",
  currentCount: 1,
  channelCount: 3,
  label: "Recorded snapshots",
  detail: "1 of 3 channels current; values may include earlier snapshots.",
});

assert.deepEqual(analyticsDataFreshness([], now), {
  state: "recorded",
  currentCount: 0,
  channelCount: 0,
  label: "Recorded snapshots",
  detail: "0 of 0 channels current; values may include earlier snapshots.",
});

console.log("analytics data freshness presentation passed");
