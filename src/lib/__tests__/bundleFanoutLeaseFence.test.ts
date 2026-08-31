import assert from "node:assert/strict";

import {
  claimBundleFanoutDispatch,
  claimExecutionLease,
  deferBundleFanoutDispatch,
  markBundleFanoutDispatchEnqueued,
  reapExpiredRunLeases,
} from "../../../convex/runs";
import {
  BUNDLE_FANOUT_QUEUE_WAIT_MAX_MS,
  bundleFanoutEnvelope,
} from "@/lib/bundleFanout";
import { RUN_QUEUE_LEASE_MS } from "@/lib/runLease";

type Row = Record<string, unknown> & { _id: string };

function invoke<T>(definition: unknown, ctx: unknown, args: unknown): Promise<T> {
  return (definition as { _handler: (ctx: unknown, args: unknown) => Promise<T> })._handler(ctx, args);
}

function fanoutContext() {
  const ownerId = "owner-fanout";
  const baseChannel: Row = {
    _id: "channels:base",
    ownerId,
    groupId: "group:fanout",
    groupRole: "base",
    status: "active",
  };
  const sibling: Row = {
    _id: "channels:sibling",
    ownerId,
    groupId: "group:fanout",
    groupRole: "sibling",
    status: "active",
  };
  const baseRun: Row = {
    _id: "runs:base",
    ownerId,
    channelId: baseChannel._id,
    status: "ok",
    startedAt: Date.now(),
    heartbeatAt: Date.now(),
    costTotal: 0,
  };
  const rows = new Map<string, Row>([
    [baseChannel._id, baseChannel],
    [sibling._id, sibling],
    [baseRun._id, baseRun],
  ]);
  const db = {
    normalizeId: (_table: string, id: string) => id,
    get: async (id: string) => rows.get(id) ?? null,
    patch: async (id: string, patch: Record<string, unknown>) => {
      const row = rows.get(id);
      assert.ok(row, `unknown patch target ${id}`);
      Object.assign(row, patch);
    },
    query: (table: string) => ({
      withIndex: (_index: string, predicate: (q: {
        eq: (...args: unknown[]) => unknown;
        gt: (...args: unknown[]) => unknown;
        lte: (...args: unknown[]) => unknown;
      }) => unknown) => {
        const q = {
          eq: () => q,
          gt: () => q,
          lte: () => q,
        };
        predicate(q);
        return {
          take: async () => table === "runs" ? [...rows.values()].filter((row) => row._id.startsWith("runs:")) : [],
          collect: async () => [],
          unique: async () => null,
        };
      },
    }),
  };
  const ctx = {
    db,
    auth: {
      getUserIdentity: async () => ({
        subject: "trigger-service",
        issuer: "https://studio.test",
        tokenIdentifier: "test|owner-fanout",
        role: "service",
        owner_id: ownerId,
      }),
    },
  };

  function child(id: string, input: {
    state?: "pending" | "dispatching" | "enqueued";
    dispatchLeaseExpiresAt?: number;
    nextAttemptAt?: number;
    queueDeadlineAt?: number;
    queueEnqueuedAt?: number;
  } = {}): Row {
    const now = Date.now();
    const envelope = bundleFanoutEnvelope({
      ownerId,
      baseRunId: baseRun._id,
      baseChannelId: baseChannel._id,
      siblingChannelId: sibling._id,
      reuse: { language: "es", footageKeys: [] },
    });
    const row: Row = {
      _id: id,
      ownerId,
      channelId: sibling._id,
      status: "queued",
      startedAt: now,
      heartbeatAt: now,
      costTotal: 0,
      leaseExpiresAt: now + RUN_QUEUE_LEASE_MS,
      selfHealGeneration: 0,
      bundleParentRunId: baseRun._id,
      bundleParentChannelId: baseChannel._id,
      bundleDispatchKey: envelope.dispatchKey,
      bundleDispatchEnvelope: envelope,
      bundleDispatchEnvelopeFingerprint: envelope.dispatchEnvelopeFingerprint,
      bundleDispatchState: input.state ?? "dispatching",
      bundleDispatchAttempts: 1,
      bundleDispatchNextAttemptAt: input.nextAttemptAt,
      bundleDispatchDeadlineAt: now + 30 * 60_000,
      bundleDispatchLeaseToken: "dispatch-token",
      bundleDispatchLeaseExpiresAt: input.dispatchLeaseExpiresAt ?? now + 60_000,
      bundleDispatchQueueDeadlineAt: input.queueDeadlineAt,
      bundleDispatchEnqueuedAt: input.queueEnqueuedAt,
    };
    rows.set(row._id, row);
    return row;
  }

  return { ownerId, baseChannel, sibling, baseRun, child, ctx };
}

type FanoutFixture = ReturnType<typeof fanoutContext>;

async function claimRunning(ctx: unknown, ownerId: string, row: Row, now: number) {
  const lease = await invoke<{
    executionLeaseToken: number;
    leaseExpiresAt: number;
  }>(claimExecutionLease, ctx, {
    ownerId,
    channelId: row.channelId,
    runId: row._id,
    leaseOwner: `trigger-${row._id}`,
    now,
  });
  Object.assign(row, {
    remoteChildWaitLeaseOwner: `trigger-${row._id}`,
    remoteChildWaitExecutionLeaseToken: lease.executionLeaseToken,
    remoteChildWaitBlockId: "novita_render_video",
    remoteChildWaitDispatchKey: `${row._id}:remote-child`,
    remoteChildWaitUntil: lease.leaseExpiresAt,
    remoteChildWaitDeadline: lease.leaseExpiresAt + 60_000,
  });
  return lease;
}

async function main() {
  // Trigger accepted, its child begins execution, and only then the caller
  // records success. The receipt must not overwrite the fenced remote lease.
  {
    const { ctx, ownerId, child } = fanoutContext();
    const row = child("runs:late-mark");
    const now = Date.now();
    const lease = await claimRunning(ctx, ownerId, row, now);
    await invoke<null>(markBundleFanoutDispatchEnqueued, ctx, {
      ownerId,
      runId: row._id,
      leaseToken: "dispatch-token",
      now: now + 1,
    });
    assert.equal(row.status, "running");
    assert.equal(row.leaseExpiresAt, lease.leaseExpiresAt);
    assert.equal(row.remoteChildWaitUntil, lease.leaseExpiresAt);
    assert.equal(row.bundleDispatchState, "enqueued");
    assert.equal(row.bundleDispatchQueueDeadlineAt, undefined);
  }

  // An ambiguous Trigger failure after the child has started is acknowledgement,
  // not a retry. Deferral preserves the active execution/remote-child lease.
  {
    const { ctx, ownerId, child } = fanoutContext();
    const row = child("runs:late-defer");
    const now = Date.now();
    const lease = await claimRunning(ctx, ownerId, row, now);
    const result = await invoke<{ kind: string }>(deferBundleFanoutDispatch, ctx, {
      ownerId,
      runId: row._id,
      leaseToken: "dispatch-token",
      now: now + 1,
      error: "Trigger response lost after acceptance",
    });
    assert.equal(result.kind, "enqueued");
    assert.equal(row.status, "running");
    assert.equal(row.leaseExpiresAt, lease.leaseExpiresAt);
    assert.equal(row.remoteChildWaitUntil, lease.leaseExpiresAt);
    assert.equal(row.bundleDispatchState, "enqueued");
  }

  // A dispatcher token expires exactly at its deadline; neither acknowledgement
  // nor deferral may revive or mutate that stale receipt.
  {
    const { ctx, ownerId, child } = fanoutContext();
    const now = Date.now();
    const row = child("runs:expired-dispatcher", { dispatchLeaseExpiresAt: now });
    await assert.rejects(
      invoke<null>(markBundleFanoutDispatchEnqueued, ctx, {
        ownerId,
        runId: row._id,
        leaseToken: "dispatch-token",
        now,
      }),
      /lost its claim lease/,
    );
    await assert.rejects(
      invoke(deferBundleFanoutDispatch, ctx, {
        ownerId,
        runId: row._id,
        leaseToken: "dispatch-token",
        now,
        error: "stale dispatcher",
      }),
      /lost its claim lease/,
    );
    assert.equal(row.bundleDispatchState, "dispatching");
    assert.equal(row.bundleDispatchLeaseToken, "dispatch-token");
  }

  // A child can terminalize before Trigger returns acceptance. The receipt must
  // fail the base stage rather than turning that terminal child into emitted.
  {
    const { ctx, ownerId, child } = fanoutContext();
    const row = child("runs:terminal-before-mark");
    const leaseExpiresAt = row.leaseExpiresAt;
    row.status = "failed";
    row.error = "child failed immediately";
    await assert.rejects(
      invoke<null>(markBundleFanoutDispatchEnqueued, ctx, {
        ownerId,
        runId: row._id,
        leaseToken: "dispatch-token",
        now: Date.now(),
      }),
      /became terminal before enqueue acknowledgement/,
    );
    assert.equal(row.status, "failed");
    assert.equal(row.bundleDispatchState, "dispatching");
    assert.equal(row.leaseExpiresAt, leaseExpiresAt);
  }

  // A lost enqueue must be re-authorized against live group membership before
  // recovery. A disabled or moved sibling is terminalized before any Trigger call.
  for (const [label, mutateSibling] of [
    ["disabled", (sibling: Row) => { sibling.status = "disabled"; }],
    ["moved", (sibling: Row) => { sibling.groupId = "group:other"; }],
  ] as const) {
    const { ctx, ownerId, sibling, child } = fanoutContext();
    const row = child(`runs:lost-${label}`, {
      state: "dispatching",
      dispatchLeaseExpiresAt: Date.now() - 1,
    });
    mutateSibling(sibling);
    const result = await invoke<{ kind: string }>(claimBundleFanoutDispatch, ctx, {
      ownerId,
      runId: row._id,
      now: Date.now(),
    });
    assert.equal(result.kind, "failed");
    assert.equal(row.status, "failed");
    assert.equal(row.bundleDispatchState, "failed");
    assert.match(String(row.bundleDispatchLastError), /eligibility changed before dispatch/);
  }

  // Dispatch-time admission is not enough: a child can wait behind another
  // same-channel remote render. Its own execution claim re-checks every
  // durable base/sibling binding before a delayed worker can reach a provider.
  const executionEligibilityMutations: Array<
    readonly [string, (fixture: FanoutFixture) => void, "terminal" | "auth_denied"]
  > = [
    ["base run owner", ({ baseRun }) => { baseRun.ownerId = "owner-other"; }, "terminal"],
    ["base run channel", ({ baseRun }) => { baseRun.channelId = "channels:other"; }, "terminal"],
    ["base channel owner", ({ baseChannel }) => { baseChannel.ownerId = "owner-other"; }, "terminal"],
    ["base channel role", ({ baseChannel }) => { baseChannel.groupRole = "sibling"; }, "terminal"],
    ["base channel status", ({ baseChannel }) => { baseChannel.status = "disabled"; }, "terminal"],
    ["base channel group", ({ baseChannel }) => { baseChannel.groupId = "group:other"; }, "terminal"],
    ["sibling owner", ({ sibling }) => { sibling.ownerId = "owner-other"; }, "auth_denied"],
    ["sibling role", ({ sibling }) => { sibling.groupRole = "base"; }, "terminal"],
    ["sibling status", ({ sibling }) => { sibling.status = "disabled"; }, "terminal"],
    ["sibling group", ({ sibling }) => { sibling.groupId = "group:other"; }, "terminal"],
  ];
  for (const [label, mutate, outcome] of executionEligibilityMutations) {
    const fixture = fanoutContext();
    const { ctx, ownerId, child } = fixture;
    const row = child("runs:execution-" + label);
    const acknowledgedAt = Date.now();
    await invoke<null>(markBundleFanoutDispatchEnqueued, ctx, {
      ownerId,
      runId: row._id,
      leaseToken: "dispatch-token",
      now: acknowledgedAt,
    });
    mutate(fixture);
    if (outcome === "auth_denied") {
      await assert.rejects(
        invoke(claimExecutionLease, ctx, {
          ownerId,
          channelId: row.channelId,
          runId: row._id,
          leaseOwner: "trigger-execution-" + label,
          now: acknowledgedAt + 1,
        }),
        /Studio resource access denied/,
      );
      assert.equal(row.status, "queued");
      assert.equal(row.executionAttempts, undefined);
      continue;
    }
    const result = await invoke<{ kind: string; error?: string }>(claimExecutionLease, ctx, {
      ownerId,
      channelId: row.channelId,
      runId: row._id,
      leaseOwner: "trigger-execution-" + label,
      now: acknowledgedAt + 1,
    });
    assert.equal(result.kind, "fanout_ineligible");
    assert.match(String(result.error), /eligibility changed before execution/);
    assert.equal(row.status, "failed");
    assert.equal(row.bundleDispatchState, "failed");
    assert.equal(row.bundleDispatchQueueDeadlineAt, undefined);
    assert.equal(row.executionAttempts, undefined);
    assert.equal(row.leaseOwner, undefined);
  }

  // A delayed retry of a terminal receipt cannot use claimExecutionLease's
  // generic failed-run recovery path to reopen a paid fanout child.
  {
    const { ctx, ownerId, child } = fanoutContext();
    const row = child("runs:terminal-fanout-retry", { state: "enqueued" });
    row.status = "failed";
    row.bundleDispatchState = "failed";
    row.bundleDispatchQueueDeadlineAt = Date.now() + BUNDLE_FANOUT_QUEUE_WAIT_MAX_MS;
    const result = await invoke<{ kind: string; error?: string }>(claimExecutionLease, ctx, {
      ownerId,
      channelId: row.channelId,
      runId: row._id,
      leaseOwner: "trigger-terminal-fanout-retry",
      now: Date.now(),
    });
    assert.equal(result.kind, "fanout_ineligible");
    assert.match(String(result.error), /receipt is terminal before execution/);
    assert.equal(row.status, "failed");
    assert.equal(row.bundleDispatchState, "failed");
    assert.equal(row.bundleDispatchQueueDeadlineAt, undefined);
    assert.equal(row.executionAttempts, undefined);
    assert.equal(row.leaseOwner, undefined);
  }

  // Any partial fanout provenance is fail-closed rather than falling through
  // to generic execution-lease recovery.
  {
    const { ctx, ownerId, child } = fanoutContext();
    const row = child("runs:incomplete-fanout-receipt");
    row.bundleDispatchState = undefined;
    const result = await invoke<{ kind: string; error?: string }>(claimExecutionLease, ctx, {
      ownerId,
      channelId: row.channelId,
      runId: row._id,
      leaseOwner: "trigger-incomplete-fanout-receipt",
      now: Date.now(),
    });
    assert.equal(result.kind, "fanout_ineligible");
    assert.match(String(result.error), /identity is incomplete before execution/);
    assert.equal(row.status, "failed");
    assert.equal(row.executionAttempts, undefined);
  }

  // A stale Trigger task never gets to cancel a different live worker merely
  // because current sibling membership changed after that worker started.
  {
    const { ctx, ownerId, sibling, child } = fanoutContext();
    const row = child("runs:live-fanout-peer");
    const now = Date.now();
    const lease = await claimRunning(ctx, ownerId, row, now);
    sibling.status = "disabled";
    await assert.rejects(
      invoke(claimExecutionLease, ctx, {
        ownerId,
        channelId: row.channelId,
        runId: row._id,
        leaseOwner: "trigger-stale-fanout-peer",
        now: now + 1,
      }),
      /already leased by another live worker/,
    );
    assert.equal(row.status, "running");
    assert.equal(row.leaseOwner, "trigger-" + row._id);
    assert.equal(row.leaseExpiresAt, lease.leaseExpiresAt);
    assert.equal(row.remoteChildWaitUntil, lease.leaseExpiresAt);
  }

  // An accepted child can survive one documented long same-channel wait, then
  // claim execution and freeze normally. The same exception remains bounded:
  // once its fanout deadline is gone, the ordinary reaper still fails it.
  {
    const { ctx, ownerId, child } = fanoutContext();
    const row = child("runs:queued-behind-remote");
    const acknowledgedAt = Date.now();
    await invoke<null>(markBundleFanoutDispatchEnqueued, ctx, {
      ownerId,
      runId: row._id,
      leaseToken: "dispatch-token",
      now: acknowledgedAt,
    });
    const queueDeadline = row.bundleDispatchQueueDeadlineAt;
    assert.equal(queueDeadline, acknowledgedAt + BUNDLE_FANOUT_QUEUE_WAIT_MAX_MS);
    assert.equal(row.leaseExpiresAt, acknowledgedAt + RUN_QUEUE_LEASE_MS);

    row.leaseExpiresAt = Date.now() - 1;
    await invoke<{ reaped: number }>(reapExpiredRunLeases, ctx, {});
    assert.equal(row.status, "queued");
    assert.equal(row.leaseExpiresAt, queueDeadline);

    const result = await invoke<{ kind: string }>(claimExecutionLease, ctx, {
      ownerId,
      channelId: row.channelId,
      runId: row._id,
      leaseOwner: "trigger-queued-after-remote",
      now: Date.now(),
    });
    assert.equal(result.kind, "claimed");
    assert.equal(row.status, "running");
    assert.equal(row.bundleDispatchQueueDeadlineAt, undefined);
  }
  {
    const { ctx, ownerId, child } = fanoutContext();
    const row = child("runs:deadline-before-worker", {
      state: "enqueued",
      queueDeadlineAt: Date.now() - 1,
    });
    row.bundleDispatchLeaseToken = undefined;
    row.bundleDispatchLeaseExpiresAt = undefined;
    await assert.rejects(
      invoke(claimExecutionLease, ctx, {
        ownerId,
        channelId: row.channelId,
        runId: row._id,
        leaseOwner: "trigger-after-fanout-deadline",
        now: Date.now(),
      }),
      /queued dispatch deadline is invalid or elapsed/,
      "a delayed Trigger task cannot claim after the bounded fanout queue deadline",
    );
  }
  // A numeric but non-canonical far-future deadline cannot turn an accepted
  // receipt into an indefinite queue exception or start a late paid worker.
  {
    const { ctx, ownerId, child } = fanoutContext();
    const now = Date.now();
    const row = child("runs:malformed-queue-deadline", {
      state: "enqueued",
      queueEnqueuedAt: now,
      queueDeadlineAt: now + (BUNDLE_FANOUT_QUEUE_WAIT_MAX_MS * 10),
    });
    row.bundleDispatchLeaseToken = undefined;
    row.bundleDispatchLeaseExpiresAt = undefined;
    await assert.rejects(
      invoke(claimExecutionLease, ctx, {
        ownerId,
        channelId: row.channelId,
        runId: row._id,
        leaseOwner: "trigger-malformed-fanout-deadline",
        now,
      }),
      /queued dispatch deadline is invalid or elapsed/,
    );
    assert.equal(row.status, "queued");
    assert.equal(row.executionAttempts, undefined);

    row.leaseExpiresAt = now - 1;
    await invoke<{ reaped: number }>(reapExpiredRunLeases, ctx, {});
    assert.equal(row.status, "failed");
    assert.equal(row.bundleDispatchState, "failed");
    assert.equal(row.bundleDispatchQueueDeadlineAt, undefined);
  }
  {
    const { ctx, ownerId, child } = fanoutContext();
    const row = child("runs:abandoned-fanout", {
      state: "enqueued",
      queueDeadlineAt: Date.now() - 1,
    });
    row.bundleDispatchLeaseToken = undefined;
    row.bundleDispatchLeaseExpiresAt = undefined;
    row.leaseExpiresAt = Date.now() - 1;
    await invoke<{ reaped: number }>(reapExpiredRunLeases, ctx, {});
    assert.equal(row.status, "failed");
    assert.equal(row.bundleDispatchState, "failed");
    assert.equal(row.bundleDispatchQueueDeadlineAt, undefined);
    assert.match(String(row.error), /accepted queue wait elapsed; manual reconciliation/);
  }

  console.log("bundle fanout lease fence tests passed");
}

void main();
