export type AnalyticsRefreshHealthInput = {
  readonly connection: null | {
    readonly status: "active" | "revoked" | "error";
    readonly scopeHealth: "healthy" | "partial" | "unknown";
  };
  readonly refresh: null | {
    readonly activeState: "active" | "manual_reconciliation_required" | null;
    readonly activeMode: "freshness" | "history" | "rollup" | null;
    readonly videoRequestStatus: "pending" | "request_started" | "fetched" | "manual_reconciliation_required" | null;
    readonly channelRequestStatus: "pending" | "request_started" | "fetched" | "manual_reconciliation_required" | null;
    readonly lastCompletedAt: number | null;
  };
};

export type AnalyticsRefreshHealth = {
  readonly state: "not_connected" | "reconnect_required" | "refreshing" | "manual_reconciliation_required" | "waiting_first_refresh" | "current" | "stale";
  readonly label: string;
  readonly detail: string;
  readonly tone: "quiet" | "ok" | "running" | "warning" | "danger";
};

export type AnalyticsRefreshFleetHealth = {
  readonly label: string;
  readonly detail: string;
  readonly tone: AnalyticsRefreshHealth["tone"];
  readonly needsAttention: boolean;
};

/** The 6-hour schedule gets a two-hour grace window before the UI calls it stale. */
export const ANALYTICS_REFRESH_STALE_AFTER_MS = 8 * 60 * 60 * 1_000;

export function analyticsRefreshHealth(
  input: AnalyticsRefreshHealthInput,
  now = Date.now(),
): AnalyticsRefreshHealth {
  if (!input.connection) {
    return {
      state: "not_connected",
      label: "YouTube not connected",
      detail: "Connect this channel to YouTube to start its six-hour analytics refresh.",
      tone: "quiet",
    };
  }
  if (input.connection.status !== "active" || input.connection.scopeHealth !== "healthy") {
    return {
      state: "reconnect_required",
      label: "Reconnect required",
      detail: "The YouTube connection is revoked, unhealthy, or missing the read scope required for analytics.",
      tone: "danger",
    };
  }
  if (input.refresh?.activeState === "manual_reconciliation_required") {
    return {
      state: "manual_reconciliation_required",
      label: "Review required",
      detail: "A YouTube response was ambiguous, so automatic replay is stopped until the batch is reconciled.",
      tone: "danger",
    };
  }
  if (input.refresh?.activeState === "active") {
    const mode = input.refresh.activeMode ?? "bounded";
    const providerStarted = input.refresh.videoRequestStatus === "request_started" ||
      input.refresh.channelRequestStatus === "request_started";
    return {
      state: "refreshing",
      label: "Refreshing now",
      detail: providerStarted
        ? `The ${mode} batch is waiting for or saving a YouTube response.`
        : `The ${mode} batch is preparing its bounded YouTube request.`,
      tone: "running",
    };
  }
  const lastCompletedAt = input.refresh?.lastCompletedAt;
  if (!lastCompletedAt) {
    return {
      state: "waiting_first_refresh",
      label: "Waiting for first refresh",
      detail: "The connection is ready; the scheduled stats task has not completed its first batch yet.",
      tone: "warning",
    };
  }
  if (now - lastCompletedAt > ANALYTICS_REFRESH_STALE_AFTER_MS) {
    return {
      state: "stale",
      label: "Refresh overdue",
      detail: "The latest completed analytics batch is older than the six-hour schedule plus its grace window.",
      tone: "warning",
    };
  }
  return {
    state: "current",
    label: "Analytics current",
    detail: "The latest scheduled YouTube stats batch completed within the expected refresh window.",
    tone: "ok",
  };
}

export function analyticsRefreshFleetHealth(
  inputs: readonly AnalyticsRefreshHealthInput[],
  now = Date.now(),
): AnalyticsRefreshFleetHealth {
  const counts = new Map<AnalyticsRefreshHealth["state"], number>();
  for (const input of inputs) {
    const state = analyticsRefreshHealth(input, now).state;
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  const count = (state: AnalyticsRefreshHealth["state"]) => counts.get(state) ?? 0;
  const current = count("current");
  const refreshing = count("refreshing");
  const manual = count("manual_reconciliation_required");
  const reconnect = count("reconnect_required");
  const stale = count("stale");
  const waiting = count("waiting_first_refresh");
  const notConnected = count("not_connected");
  const needsAttention = manual + reconnect + stale + notConnected > 0;
  const parts = [
    current ? `${current} current` : null,
    refreshing ? `${refreshing} refreshing` : null,
    waiting ? `${waiting} awaiting first refresh` : null,
    stale ? `${stale} overdue` : null,
    reconnect ? `${reconnect} reconnect required` : null,
    manual ? `${manual} reconciliation required` : null,
    notConnected ? `${notConnected} not connected` : null,
  ].filter((part): part is string => Boolean(part));

  return {
    label: `${current} of ${inputs.length} current`,
    detail: parts.join(" · ") || "No channels are available for analytics refresh yet.",
    tone: manual || reconnect
      ? "danger"
      : stale || waiting
        ? "warning"
        : refreshing
          ? "running"
          : current
            ? "ok"
            : "quiet",
    needsAttention,
  };
}
