import assert from "node:assert/strict";
import {
  RUN_EXECUTION_LEASE_MS,
  RUN_QUEUE_LEASE_MS,
  assertRunLeaseClaimable,
  effectiveRunLeaseExpiry,
  expiredRunRecoveryDisposition,
  isRunLeaseExpired,
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

console.log("RUN LEASE TESTS PASS");
