import assert from "node:assert/strict";
import {
  RUN_EXECUTION_LEASE_MS,
  RUN_QUEUE_LEASE_MS,
  assertRunExecutionWriteFence,
  assertRunLeaseClaimable,
  effectiveRunLeaseExpiry,
  expiredRunRecoveryDisposition,
  isRunLeaseExpired,
  requiresRunExecutionWriteFence,
} from "@/lib/runLease";

const NOW = 2_000_000_000_000;

assert.equal(
  effectiveRunLeaseExpiry({ status: "queued", startedAt: NOW }),
  NOW + RUN_QUEUE_LEASE_MS,
);
assert.equal(
  effectiveRunLeaseExpiry({ status: "running", heartbeatAt: NOW }),
  NOW + RUN_EXECUTION_LEASE_MS,
);
assert.equal(
  effectiveRunLeaseExpiry({ status: "running", startedAt: 1, leaseExpiresAt: 123 }),
  123,
  "an explicit durable lease wins over the legacy fallback",
);

assert.equal(
  isRunLeaseExpired(
    { status: "queued", startedAt: NOW - RUN_QUEUE_LEASE_MS - 1 },
    NOW,
  ),
  true,
  "a worker that never claims a queued run is bounded",
);
assert.equal(
  isRunLeaseExpired(
    { status: "running", heartbeatAt: NOW - RUN_EXECUTION_LEASE_MS + 1 },
    NOW,
  ),
  false,
  "a live execution heartbeat keeps the run active",
);
assert.equal(isRunLeaseExpired({ status: "failed", startedAt: 1 }, NOW), false);

assert.doesNotThrow(() =>
  assertRunLeaseClaimable(
    { status: "running", leaseOwner: "trigger-a", leaseExpiresAt: NOW + 1 },
    "trigger-a",
    NOW,
  ),
);

assert.equal(
  expiredRunRecoveryDisposition({ status: "queued", startedAt: 1 }),
  "replace",
);
assert.equal(
  expiredRunRecoveryDisposition({
    status: "running",
    pipelineInvocationSnapshot: { entries: [] },
    pipelineInvocationSha256: "b".repeat(64),
  }),
  "resume",
);
assert.equal(
  expiredRunRecoveryDisposition({
    status: "queued",
    pipelineInvocationSnapshot: { entries: [] },
    pipelineInvocationSha256: "b".repeat(64),
  }),
  "resume",
  "a lost serialized retry dispatch must preserve the exact queued frozen invocation",
);
assert.equal(
  expiredRunRecoveryDisposition({
    status: "running",
    pipelineInvocationSnapshot: { entries: [] },
    pipelineInvocationSha256: "malformed",
  }),
  "replace",
  "a corrupt invocation hash can never be resumed",
);
assert.throws(
  () =>
    assertRunLeaseClaimable(
      { status: "running", leaseOwner: "trigger-a", leaseExpiresAt: NOW + 1 },
      "trigger-b",
      NOW,
    ),
  /another live worker/,
);
assert.doesNotThrow(() =>
  assertRunLeaseClaimable(
    { status: "running", leaseOwner: "dead-trigger", leaseExpiresAt: NOW - 1 },
    "recovery-trigger",
    NOW,
  ),
);

const activeExecution = {
  status: "running",
  leaseOwner: "trigger-current",
  executionAttempts: 7,
  leaseExpiresAt: NOW + 1,
};
assert.doesNotThrow(() =>
  assertRunExecutionWriteFence(
    activeExecution,
    { leaseOwner: "trigger-current", executionLeaseToken: 7 },
    NOW,
  ),
);
assert.throws(
  () =>
    assertRunExecutionWriteFence(
      activeExecution,
      { leaseOwner: "trigger-current", executionLeaseToken: 6 },
      NOW,
    ),
  /stale/,
  "a pre-recovery worker cannot write through a newer execution generation",
);
assert.throws(
  () =>
    assertRunExecutionWriteFence(
      { ...activeExecution, leaseExpiresAt: NOW - 1 },
      { leaseOwner: "trigger-current", executionLeaseToken: 7 },
      NOW,
    ),
  /expired/,
  "a worker cannot write in the gap after its lease elapsed",
);

assert.equal(
  requiresRunExecutionWriteFence({ status: "running" }),
  true,
  "a still-running legacy execution cannot bypass the rollout fence by omitting its generation",
);
assert.equal(
  requiresRunExecutionWriteFence({
    status: "failed",
    executionAttempts: 1,
    leaseRecoveryPending: true,
  }),
  true,
  "a reaped worker cannot write terminal state without its stale generation being rejected",
);
assert.equal(
  requiresRunExecutionWriteFence({ status: "failed" }),
  false,
  "a genuinely pre-lease historical terminal record remains readable by legacy/operator maintenance",
);

console.log("RUN LEASE TESTS PASS");
