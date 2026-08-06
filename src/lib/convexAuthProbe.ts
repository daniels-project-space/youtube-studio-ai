export const CONVEX_AUTH_PROBE_LIMIT = 1 as const;

const SAFE_RUN_STATUSES = new Set([
  "queued",
  "running",
  "ok",
  "failed",
  "canceled",
]);

export interface ConvexAuthProbeRun {
  status?: unknown;
  startedAt?: unknown;
  finishedAt?: unknown;
}

export interface ConvexAuthProbeEvidence {
  ok: true;
  authenticatedAs: "studio-service-jwt";
  query: "runs:listRecent";
  limit: typeof CONVEX_AUTH_PROBE_LIMIT;
  observedRows: 0 | 1;
  checkedAt: number;
  recentRun: {
    status: string;
    startedAt: number | null;
    finishedAt: number | null;
  } | null;
}

function safeTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : null;
}

function safeStatus(value: unknown): string {
  return typeof value === "string" && SAFE_RUN_STATUSES.has(value)
    ? value
    : "unknown";
}

/**
 * Redact the bounded query response before it leaves the worker. The underlying
 * row can contain channel names, identifiers, costs, provider ids, and errors;
 * none of those are rollout evidence and none are returned from this probe.
 */
export function buildConvexAuthProbeEvidence(
  rows: readonly ConvexAuthProbeRun[],
  checkedAt = Date.now(),
): ConvexAuthProbeEvidence {
  if (rows.length > CONVEX_AUTH_PROBE_LIMIT) {
    throw new Error("convex-auth-probe: bounded query returned more than one row");
  }

  const row = rows[0];
  return {
    ok: true,
    authenticatedAs: "studio-service-jwt",
    query: "runs:listRecent",
    limit: CONVEX_AUTH_PROBE_LIMIT,
    observedRows: row ? 1 : 0,
    checkedAt: safeTimestamp(checkedAt) ?? 0,
    recentRun: row
      ? {
          status: safeStatus(row.status),
          startedAt: safeTimestamp(row.startedAt),
          finishedAt: safeTimestamp(row.finishedAt),
        }
      : null,
  };
}
