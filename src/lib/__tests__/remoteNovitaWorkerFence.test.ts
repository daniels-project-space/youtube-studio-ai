import assert from "node:assert/strict";

import {
  bindInstance,
  claimExecution,
  claimCreate,
  heartbeat,
  markDeletedVerified,
  markDeletionUnverified,
  markFailed,
  markCreateDispatched,
  requestDeletion,
  reserve,
} from "../../../convex/novitaWorkerLeases";

type Row = Record<string, unknown> & { _id: string };

function invoke<T>(definition: unknown, ctx: unknown, args: unknown): Promise<T> {
  return (definition as { _handler: (ctx: unknown, args: unknown) => Promise<T> })._handler(ctx, args);
}

async function main(): Promise<void> {
  const priorSecret = process.env.INTERNAL_QUERY_SECRET;
  process.env.INTERNAL_QUERY_SECRET = "remote-novita-fence-test-secret";
  try {
    const now = Date.now();
    const run: Row = {
      _id: "runs:remote-novita-fence",
      ownerId: "owner-test",
      channelId: "channels:remote-novita-fence",
      status: "running",
      // The reaper already gave recovery generation five to a new parent.
      leaseOwner: "trigger-recovered",
      executionAttempts: 5,
      heartbeatAt: now,
      leaseExpiresAt: now + 20 * 60_000,
      remoteChildWaitLeaseOwner: "trigger-recovered",
      remoteChildWaitExecutionLeaseToken: 5,
      remoteChildWaitBlockId: "novita_render_video",
      remoteChildWaitDispatchKey: "runs:remote-novita-fence:novita_render_video:h0",
      remoteChildWaitUntil: now + 20 * 60_000,
      remoteChildWaitDeadline: now + 3 * 60 * 60_000,
    };
    const channel: Row = {
      _id: "channels:remote-novita-fence",
      ownerId: "owner-test",
    };
    const workers: Row[] = [];
    let workerInserts = 0;
    let workerPatches = 0;
    let createDispatchPatches = 0;

    const ctx = {
      db: {
        normalizeId: (_table: string, id: string) => id,
        get: async (id: string) => {
          if (id === run._id) return run;
          if (id === channel._id) return channel;
          return workers.find((worker) => worker._id === id) ?? null;
        },
        query: (table: string) => ({
          withIndex: (_index: string, predicate: (q: { eq: (...args: unknown[]) => unknown }) => unknown) => {
            const q = { eq: () => q };
            predicate(q);
            return {
              unique: async () => table === "novitaWorkerLeases" ? workers[0] ?? null : null,
              take: async () => [],
              collect: async () => [],
            };
          },
        }),
        insert: async (table: string, row: Record<string, unknown>) => {
          assert.equal(table, "novitaWorkerLeases");
          workerInserts += 1;
          const inserted: Row = { _id: `novitaWorkerLeases:${workerInserts}`, ...row };
          workers.push(inserted);
          return inserted._id;
        },
        patch: async (id: string, patch: Record<string, unknown>) => {
          const target = id === run._id ? run : workers.find((worker) => worker._id === id);
          assert.ok(target, `unknown patched row ${id}`);
          if (id !== run._id) workerPatches += 1;
          if (patch.status === "create_dispatched") createDispatchPatches += 1;
          Object.assign(target, patch);
        },
      },
      auth: {
        getUserIdentity: async () => ({
          subject: "trigger-service",
          issuer: "https://studio.test",
          tokenIdentifier: "test|owner-test",
          role: "service",
          owner_id: "owner-test",
        }),
      },
    };

    const staleFence = {
      leaseOwner: "trigger-stale",
      executionLeaseToken: 4,
      dispatchKey: "runs:remote-novita-fence:novita_render_video:h0",
    };
    const recoveredFence = {
      leaseOwner: "trigger-recovered",
      executionLeaseToken: 5,
      dispatchKey: "runs:remote-novita-fence:novita_render_video:h0",
    };
    const reservation = (remoteChildFence: typeof staleFence | typeof recoveredFence) => ({
      secret: "remote-novita-fence-test-secret",
      ownerId: "owner-test",
      channelId: channel._id as never,
      runId: run._id as never,
      blockId: "novita_render_video",
      phase: "video" as const,
      manifestId: "manifest-remote-novita-fence",
      manifestSha256: "a".repeat(64),
      workerName: "yt-render-4090-remote-fence-test",
      productId: "rtx4090-spot",
      gpuSku: "RTX 4090" as const,
      gpuCount: 1 as const,
      clusterId: "cluster-test",
      storageId: "storage-test",
      imageDigest: `registry.test/novita-worker@sha256:${"b".repeat(64)}`,
      maximumCostUsd: 4,
      verifiedGpuQuota: 1,
      requestedAt: now,
      bootDeadlineAt: now + 20 * 60_000,
      absoluteDeadlineAt: now + 2 * 60 * 60_000,
      remoteChildFence,
    });

    await assert.rejects(
      invoke(reserve, ctx, reservation(staleFence)),
      /stale|remote child|no longer owns/i,
      "a child paused before reserve cannot create a worker lease after the reaper changes generation",
    );
    assert.equal(workerInserts, 0, "the stale child writes zero worker reservations");

    // Model a stale invocation that had already claimed a create token before
    // it paused. The durable dispatch transition must reject it too, so no
    // caller reaches the external Novita POST after recovery.
    workers.push({
      _id: "novitaWorkerLeases:stale-claim",
      ownerId: "owner-test",
      channelId: channel._id,
      runId: run._id,
      blockId: "novita_render_video",
      workerName: "yt-render-4090-remote-fence-test",
      status: "create_claimed",
      createAttemptToken: "123e4567-e89b-12d3-a456-426614174000",
      remoteChildFenceRequired: true,
      requestedAt: now - 1_000,
      lastHeartbeatAt: now - 1_000,
    });
    await assert.rejects(
      invoke(markCreateDispatched, ctx, {
        secret: "remote-novita-fence-test-secret",
        workerName: "yt-render-4090-remote-fence-test",
        attemptToken: "123e4567-e89b-12d3-a456-426614174000",
        now,
        remoteChildFence: staleFence,
      }),
      /stale|remote child|no longer owns/i,
      "a stale child cannot durably authorize a create after its parent generation changes",
    );
    assert.equal(createDispatchPatches, 0, "the stale child writes zero create-dispatch records");

    // The recovered parent has the same immutable h0 child identity but a new
    // execution token. It may safely reuse the same worker reservation once
    // its current remote-child receipt is live.
    workers.length = 0;
    const first = await invoke<{ reused: boolean }>(reserve, ctx, reservation(recoveredFence));
    assert.equal(first.reused, false);
    assert.equal(workers[0]?.remoteChildFenceRequired, true);
    const reused = await invoke<{ reused: boolean }>(reserve, ctx, reservation(recoveredFence));
    assert.equal(reused.reused, true, "the valid recovered child reuses its immutable worker lease");

    const attemptToken = "123e4567-e89b-12d3-a456-426614174001";
    const claimed = await invoke<{ claimed: boolean }>(claimCreate, ctx, {
      secret: "remote-novita-fence-test-secret",
      workerName: "yt-render-4090-remote-fence-test",
      attemptToken,
      now: now + 1,
      remoteChildFence: recoveredFence,
    });
    assert.equal(claimed.claimed, true);
    await invoke(markCreateDispatched, ctx, {
      secret: "remote-novita-fence-test-secret",
      workerName: "yt-render-4090-remote-fence-test",
      attemptToken,
      now: now + 2,
      remoteChildFence: recoveredFence,
    });
    assert.equal(createDispatchPatches, 1, "the valid recovered child may authorize its one create");

    // Once recovery changes the parent execution token, stale A must not be
    // able to seize the controller slot, fail the lease, or tear down the
    // instance that recovered B is allowed to reuse. B may atomically take
    // over A's old controller token without allocating another worker.
    workers.length = 0;
    const lifecycleWorker: Row = {
      _id: "novitaWorkerLeases:lifecycle-fence",
      ownerId: "owner-test",
      channelId: channel._id,
      runId: run._id,
      blockId: "novita_render_video",
      workerName: "yt-render-4090-remote-fence-test",
      status: "provisioning",
      instanceId: "instance-remote-fence",
      remoteChildFenceRequired: true,
      executionAttemptToken: "123e4567-e89b-12d3-a456-4266141740aa",
      executionClaimedAt: now - 1_000,
      remoteChildExecutionLeaseOwner: staleFence.leaseOwner,
      remoteChildExecutionLeaseToken: staleFence.executionLeaseToken,
      remoteChildExecutionDispatchKey: staleFence.dispatchKey,
      requestedAt: now - 2_000,
      lastHeartbeatAt: now - 1_000,
      lastWorkAt: now - 1_000,
      bootDeadlineAt: now + 20 * 60_000,
      absoluteDeadlineAt: now + 2 * 60 * 60_000,
    };
    workers.push(lifecycleWorker);
    const recoveredExecutionToken = "123e4567-e89b-12d3-a456-4266141740bb";
    const recoveredExecution = await invoke<{ claimed: boolean }>(claimExecution, ctx, {
      secret: "remote-novita-fence-test-secret",
      workerName: lifecycleWorker.workerName,
      attemptToken: recoveredExecutionToken,
      now: now + 3,
      remoteChildFence: recoveredFence,
    });
    assert.equal(recoveredExecution.claimed, true, "recovered B can take over stale A's worker observer");
    assert.equal(lifecycleWorker.executionAttemptToken, recoveredExecutionToken);
    assert.equal(lifecycleWorker.remoteChildExecutionLeaseToken, recoveredFence.executionLeaseToken);
    const patchesBeforeStaleA = workerPatches;

    const staleLifecycleCalls = [
      () => invoke(claimExecution, ctx, {
        secret: "remote-novita-fence-test-secret",
        workerName: lifecycleWorker.workerName,
        attemptToken: "123e4567-e89b-12d3-a456-4266141740cc",
        now: now + 4,
        remoteChildFence: staleFence,
      }),
      () => invoke(bindInstance, ctx, {
        secret: "remote-novita-fence-test-secret",
        workerName: lifecycleWorker.workerName,
        instanceId: "instance-remote-fence",
        attemptToken: "123e4567-e89b-12d3-a456-4266141740cc",
        now: now + 4,
        remoteChildFence: staleFence,
      }),
      () => invoke(heartbeat, ctx, {
        secret: "remote-novita-fence-test-secret",
        workerName: lifecycleWorker.workerName,
        status: "rendering",
        now: now + 4,
        remoteChildFence: staleFence,
      }),
      () => invoke(markFailed, ctx, {
        secret: "remote-novita-fence-test-secret",
        workerName: lifecycleWorker.workerName,
        now: now + 4,
        error: "stale A must not fail B's worker",
        remoteChildFence: staleFence,
      }),
      () => invoke(requestDeletion, ctx, {
        secret: "remote-novita-fence-test-secret",
        workerName: lifecycleWorker.workerName,
        now: now + 4,
        reason: "stale A must not delete B's worker",
        remoteChildFence: staleFence,
      }),
      () => invoke(markDeletionUnverified, ctx, {
        secret: "remote-novita-fence-test-secret",
        workerName: lifecycleWorker.workerName,
        now: now + 4,
        error: "stale A must not poison B's teardown state",
        remoteChildFence: staleFence,
      }),
      () => invoke(markDeletedVerified, ctx, {
        secret: "remote-novita-fence-test-secret",
        workerName: lifecycleWorker.workerName,
        now: now + 4,
        billingReceipt: { source: "stale-A" },
        remoteChildFence: staleFence,
      }),
      // An older paused child cannot bypass the new field by omitting it, and
      // it cannot impersonate the reaper while recovered B's parent lease is
      // still live.
      () => invoke(markFailed, ctx, {
        secret: "remote-novita-fence-test-secret",
        workerName: lifecycleWorker.workerName,
        now: now + 4,
        error: "missing fence must be rejected",
      }),
      () => invoke(requestDeletion, ctx, {
        secret: "remote-novita-fence-test-secret",
        workerName: lifecycleWorker.workerName,
        now: now + 4,
        reason: "live recovered parent blocks reaper bypass",
        reaper: true,
      }),
    ];
    for (const staleLifecycleCall of staleLifecycleCalls) {
      await assert.rejects(
        staleLifecycleCall(),
        /stale|remote child|live remote parent|no longer owns/i,
        "a stale child cannot alter the recovered worker lifecycle",
      );
    }
    assert.equal(workerPatches, patchesBeforeStaleA, "stale A commits no lifecycle mutation after recovery");
    assert.equal(lifecycleWorker.status, "provisioning");
    assert.equal(lifecycleWorker.instanceId, "instance-remote-fence");

    // Direct/local workers deliberately remain fence-free: the new remote
    // guard must not change their one-controller lifecycle behavior.
    workers.length = 0;
    workers.push({
      _id: "novitaWorkerLeases:local-lifecycle",
      ownerId: "owner-test",
      channelId: channel._id,
      runId: run._id,
      blockId: "novita_render_video",
      workerName: "yt-render-4090-local-fence-test",
      status: "requested",
      requestedAt: now - 1_000,
      lastHeartbeatAt: now - 1_000,
      lastWorkAt: now - 1_000,
      bootDeadlineAt: now + 20 * 60_000,
      absoluteDeadlineAt: now + 2 * 60 * 60_000,
    });
    const localExecution = await invoke<{ claimed: boolean }>(claimExecution, ctx, {
      secret: "remote-novita-fence-test-secret",
      workerName: "yt-render-4090-local-fence-test",
      attemptToken: "123e4567-e89b-12d3-a456-4266141740dd",
      now: now + 5,
    });
    assert.equal(localExecution.claimed, true, "local/direct lease behavior remains fence-free");

    console.log("REMOTE NOVITA WORKER FENCE TESTS PASS");
  } finally {
    if (priorSecret === undefined) delete process.env.INTERNAL_QUERY_SECRET;
    else process.env.INTERNAL_QUERY_SECRET = priorSecret;
  }
}

void main();
