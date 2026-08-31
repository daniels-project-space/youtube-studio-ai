import assert from "node:assert/strict";

import {
  ANALYTICS_REFRESH_STALE_AFTER_MS,
  analyticsRefreshFleetHealth,
  analyticsRefreshHealth,
  type AnalyticsRefreshHealthInput,
} from "@/lib/analyticsRefreshPresentation";

const now = 2_000_000_000_000;
const healthyConnection = { status: "active", scopeHealth: "healthy" } as const;
const idleRefresh = (lastCompletedAt: number | null): NonNullable<AnalyticsRefreshHealthInput["refresh"]> => ({
  activeState: null,
  activeMode: null,
  videoRequestStatus: null,
  channelRequestStatus: null,
  lastCompletedAt,
});

assert.equal(analyticsRefreshHealth({ connection: null, refresh: null }, now).state, "not_connected");
assert.equal(analyticsRefreshHealth({
  connection: { status: "error", scopeHealth: "partial" },
  refresh: null,
}, now).state, "reconnect_required");
assert.equal(analyticsRefreshHealth({
  connection: healthyConnection,
  refresh: { ...idleRefresh(null), activeState: "active", activeMode: "history", videoRequestStatus: "request_started" },
}, now).state, "refreshing");
assert.equal(analyticsRefreshHealth({
  connection: healthyConnection,
  refresh: { ...idleRefresh(null), activeState: "manual_reconciliation_required", activeMode: "rollup" },
}, now).state, "manual_reconciliation_required");
assert.equal(analyticsRefreshHealth({ connection: healthyConnection, refresh: idleRefresh(null) }, now).state, "waiting_first_refresh");
assert.equal(analyticsRefreshHealth({
  connection: healthyConnection,
  refresh: idleRefresh(now - ANALYTICS_REFRESH_STALE_AFTER_MS),
}, now).state, "current", "the exact grace boundary remains current");
assert.equal(analyticsRefreshHealth({
  connection: healthyConnection,
  refresh: idleRefresh(now - ANALYTICS_REFRESH_STALE_AFTER_MS - 1),
}, now).state, "stale");

const fleet = analyticsRefreshFleetHealth([
  { connection: healthyConnection, refresh: idleRefresh(now) },
  { connection: healthyConnection, refresh: { ...idleRefresh(null), activeState: "active", activeMode: "freshness" } },
  { connection: { status: "revoked", scopeHealth: "unknown" }, refresh: null },
  { connection: null, refresh: null },
], now);
assert.equal(fleet.label, "1 of 4 current");
assert.equal(fleet.tone, "danger");
assert.equal(fleet.needsAttention, true);
assert.equal(fleet.detail, "1 current · 1 refreshing · 1 reconnect required · 1 not connected");

const readyFleet = analyticsRefreshFleetHealth([
  { connection: healthyConnection, refresh: idleRefresh(now) },
  { connection: healthyConnection, refresh: idleRefresh(now - 1) },
], now);
assert.deepEqual(readyFleet, {
  label: "2 of 2 current",
  detail: "2 current",
  tone: "ok",
  needsAttention: false,
});

console.log("analytics refresh presentation states passed");
