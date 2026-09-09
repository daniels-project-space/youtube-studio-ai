import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import type { RunExecutionLeaseFence } from "@/lib/runLease";
import { ExecutionError } from "@/engine/executionErrors";

/** Bind once to this worker generation. Neither success nor an in-flight check is memoized. */
export function createInlinePaidExecutionLeaseCheck(
  convex: Pick<StudioConvexHttpClient, "query">,
  identity: { ownerId: string; channelId: string; runId: string } & RunExecutionLeaseFence,
): () => Promise<void> {
  const binding = {
    ownerId: identity.ownerId, channelId: identity.channelId as Id<"channels">,
    runId: identity.runId as Id<"runs">, leaseOwner: identity.leaseOwner,
    executionLeaseToken: identity.executionLeaseToken,
  };
  return async () => {
    const requestId = randomUUID();
    const started = performance.now();
    try {
      const result = await convex.query(api.runExecutionAdmission.assertInlineLease, { ...binding, requestId });
      const elapsed = performance.now() - started;
      // Use server expiry and monotonic round-trip time, not the worker's wall
      // clock. A grant that expired while in transit must not reach a provider.
      if (!result || result.requestId !== requestId || !Number.isFinite(result.checkedAt) ||
        !Number.isFinite(result.leaseExpiresAt) || !Number.isFinite(elapsed) || elapsed < 0 ||
        result.leaseExpiresAt - result.checkedAt <= elapsed) {
        throw new Error("inline execution lease check is stale or invalid");
      }
    } catch (error) {
      throw new ExecutionError("INLINE_PAID_EXECUTION_LEASE_REQUIRED: " + (error instanceof Error ? error.message : String(error)), {
        code: "INLINE_PAID_EXECUTION_LEASE_REQUIRED", retryable: false,
      });
    }
  };
}
