import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  advanceSelfHealGeneration,
  assertRemoteChildWaitLease,
  beginRemoteChildWait,
  claimExecutionLease,
  heartbeatExecutionLease,
  reapExpiredRunLeases,
  renewRemoteChildWaitLease,
} from "../../../convex/runs";
import {
  renderChildWaitLeaseMs,
  renderChildWorkDeadlineMs,
} from "@/lib/renderChildLease";

type RunRow = Record<string, unknown> & { _id: string };
type StageRow = Record<string, unknown> & {
  _id: string;
  runId: string;
  block: string;
  status: string;
};

function invoke<T>(definition: unknown, ctx: unknown, args: unknown): Promise<T> {
  return (definition as { _handler: (ctx: unknown, args: unknown) => Promise<T> })._handler(ctx, args);
}

async function main() {
  const runPipelineSource = await readFile(
    resolve(process.cwd(), "src/trigger/runPipeline.ts"),
    "utf8",
  );
  const runsSource = await readFile(resolve(process.cwd(), "convex/runs.ts"), "utf8");
  assert.match(
    runsSource,
    /args\.now >= remoteChildWaitUntil/,
    "a queued remote child must not revive an expired sliding wait receipt",
  );
  assert.match(
    runPipelineSource,
    /idempotencyKeys\.create\(\s*`\$\{payload\.runId\}:\$\{blockId\}:h\$\{heals\}`,\s*\{\s*scope:\s*"global"\s*\},\s*\)/,
    "a recovered parent must reattach to the same durable child run instead of gaining a new parent-scoped dispatch key",
  );
  assert.match(
    runPipelineSource,
    /claimedSelfHealGeneration = lease\.selfHealGeneration/,
    "the execution-lease claim must carry the durable repair generation into a recovery",
  );
  assert.match(
    runPipelineSource,
    /let heals = initialSelfHealGeneration;/,
    "the parent must initialize child identity from the durable repair generation, not local h0",
  );
  assert.match(
    runPipelineSource,
    /api\.runs\.advanceSelfHealGeneration/,
    "a self-heal must advance through the durable transactional mutation",
  );
  const directNovitaSource = await readFile(
    resolve(process.cwd(), "src/lib/novitaDirectRender.ts"),
    "utf8",
  );
  const paidWaveFence = directNovitaSource.indexOf(
    'await cfg.beforeProviderSpend({ reason: "paid_wave" });',
  );
  const paidWaveDispatch = directNovitaSource.indexOf("const receipts = await renderNovitaWorkerWave({");
  assert.ok(
    paidWaveFence >= 0 && paidWaveFence < paidWaveDispatch,
    "every later direct-Novita wave reasserts the child generation before dispatch",
  );
  const renderWorkerStart = directNovitaSource.indexOf("async function startWorker(");
  const reserveLease = directNovitaSource.indexOf("const lease = await reserveLease", renderWorkerStart);
  const reserveFence = directNovitaSource.lastIndexOf(
    'await args.beforeProviderSpend?.({ reason: "worker_create" });',
    reserveLease,
  );
  assert.ok(
    reserveFence >= renderWorkerStart && reserveFence < reserveLease,
    "a stale child cannot reserve a durable worker lease before the recovered generation",
  );
  const observeWorkerStart = directNovitaSource.indexOf("async function renderNovitaWorkerWave(");
  const pollWait = directNovitaSource.indexOf("await waitForNovitaRenderPoll({", observeWorkerStart);
  const pollFence = directNovitaSource.lastIndexOf(
    'await args.beforeProviderSpend?.({ reason: "poll" });',
    pollWait,
  );
  assert.ok(
    pollFence >= observeWorkerStart && pollFence < pollWait,
    "the single checkpointed wave poll renews the short child receipt instead of leaving a static wait",
  );

  const run: RunRow = {
    _id: "runs:remote-child",
    ownerId: "owner-test",
    channelId: "channels:test",
    status: "running",
    leaseOwner: "trigger-parent",
    executionAttempts: 4,
    selfHealGeneration: 0,
    heartbeatAt: Date.now(),
    leaseExpiresAt: Date.now() + 60_000,
  };
  const stages: StageRow[] = [
    {
      _id: "runStages:h0-render",
      ownerId: "owner-test",
      runId: run._id,
      block: "novita_render_video",
      status: "ok",
      cost: 1,
      outputs: { videoKey: "runs/remote-child/h0.mp4" },
    },
    {
      _id: "runStages:h0-qa",
      ownerId: "owner-test",
      runId: run._id,
      block: "qa_visual",
      status: "failed",
      cost: 0,
      error: "visual defect requires render repair",
    },
  ];
  const ctx = {
    db: {
      normalizeId: (_table: string, id: string) => id,
      get: async (id: string) => {
        if (id === run._id) return run;
        if (id === "channels:test") return { _id: id, ownerId: "owner-test" };
        return null;
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        const target = id === run._id ? run : stages.find((stage) => stage._id === id);
        assert.ok(target, `unknown patch target ${id}`);
        Object.assign(target, patch);
      },
      insert: async (table: string, row: Record<string, unknown>) => {
        assert.equal(table, "runStages");
        const inserted: StageRow = {
          ...(row as Record<string, unknown>),
          _id: `runStages:inserted-${stages.length + 1}`,
          runId: String(row["runId"] ?? run._id),
          block: String(row["block"] ?? "unknown"),
          status: String(row["status"] ?? "queued"),
        };
        stages.push(inserted);
        return inserted._id;
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
            take: async () => table === "runs" ? [run] : [],
            collect: async () => table === "runStages" ? stages : [],
          };
        },
      }),
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
  const base = {
    ownerId: "owner-test",
    channelId: "channels:test" as never,
    runId: run._id as never,
    leaseOwner: "trigger-parent",
    executionLeaseToken: 4,
    blockId: "novita_render_video",
    dispatchKey: "runs:remote-child:novita_render_video:h0",
  };

  const waitStartedAt = Date.now();
  const waitUntil = waitStartedAt + renderChildWaitLeaseMs("offloaded");
  const deadline = waitStartedAt + renderChildWorkDeadlineMs("offloaded");
  await invoke<number>(beginRemoteChildWait, ctx, { ...base, waitUntil, deadline });
  assert.equal(run.leaseExpiresAt, waitUntil);
  assert.equal(run.remoteChildWaitExecutionLeaseToken, 4);
  assert.equal(run.remoteChildWaitDeadline, deadline);
  assert.ok(
    renderChildWaitLeaseMs("offloaded") < renderChildWorkDeadlineMs("offloaded"),
    "the offloaded child uses a short renewable liveness receipt rather than a six-hour static wait",
  );

  const reattached = await invoke<{
    executionAttempts: number;
    executionLeaseToken: number;
    selfHealGeneration: number;
  }>(claimExecutionLease, ctx, {
    ownerId: base.ownerId,
    channelId: base.channelId,
    runId: base.runId,
    leaseOwner: base.leaseOwner,
    now: Date.now(),
  });
  assert.equal(reattached.executionAttempts, 4);
  assert.equal(reattached.executionLeaseToken, 4);
  assert.equal(reattached.selfHealGeneration, 0);
  assert.equal(run.executionAttempts, 4);
  assert.equal(
    run.remoteChildWaitDispatchKey,
    base.dispatchKey,
    "a live parent retry reattaches to the same child receipt instead of minting another dispatch",
  );

  await assert.doesNotReject(
    invoke<number>(assertRemoteChildWaitLease, ctx, { ...base, now: Date.now() }),
    "the current child starts only while its exact parent wait receipt is live",
  );
  await assert.rejects(
    invoke<number>(assertRemoteChildWaitLease, ctx, {
      ...base,
      executionLeaseToken: 3,
      now: Date.now(),
    }),
    /stale|no longer owns/,
    "a child from the pre-recovery generation cannot reach provider work",
  );
  await assert.rejects(
    invoke<number>(renewRemoteChildWaitLease, ctx, {
      ...base,
      executionLeaseToken: 3,
      purpose: "provider",
      now: Date.now(),
    }),
    /stale|no longer owns/,
    "a stale/recovered child generation cannot renew before a later paid wave",
  );

  const renewedUntil = await invoke<number>(renewRemoteChildWaitLease, ctx, {
    ...base,
    purpose: "provider",
    now: Date.now(),
  });
  assert.equal(run.remoteChildWaitUntil, renewedUntil);
  assert.ok(renewedUntil <= deadline);
  await assert.rejects(
    invoke<number>(renewRemoteChildWaitLease, ctx, {
      ...base,
      purpose: "poll",
      now: renewedUntil + 1,
    }),
    /expired/,
    "an idle child cannot renew after its short sliding receipt expires",
  );

  await invoke<number>(heartbeatExecutionLease, ctx, { ...base, now: Date.now() });
  assert.equal(run.remoteChildWaitUntil, undefined);
  assert.equal(run.remoteChildWaitDispatchKey, undefined);
  assert.ok(
    typeof run.leaseExpiresAt === "number" && run.leaseExpiresAt > Date.now(),
    "the parent's finally heartbeat restores an ordinary live execution lease",
  );

  // h0 finished the render, then a downstream QA defect requests h1. The
  // durable mutation must advance the run and supersede every requested stage
  // together before a crash can hand the run to a recovery worker.
  const h1 = await invoke<{ generation: number }>(advanceSelfHealGeneration, ctx, {
    ownerId: base.ownerId,
    channelId: base.channelId,
    runId: base.runId,
    leaseOwner: base.leaseOwner,
    executionLeaseToken: base.executionLeaseToken,
    expectedGeneration: 0,
    rerunBlocks: [base.blockId, "qa_visual", "timeline_assemble"],
    reason: "visual defect requires a replacement render",
  });
  assert.equal(h1.generation, 1);
  assert.equal(run.selfHealGeneration, 1);
  for (const block of [base.blockId, "qa_visual", "timeline_assemble"]) {
    const stage = stages.find((candidate) => candidate.block === block);
    assert.equal(stage?.status, "superseded", `${block} must be invalidated with h1`);
    assert.match(String(stage?.error), /superseded by self-heal #1/);
  }
  await assert.rejects(
    invoke<{ generation: number }>(advanceSelfHealGeneration, ctx, {
      ownerId: base.ownerId,
      channelId: base.channelId,
      runId: base.runId,
      leaseOwner: base.leaseOwner,
      executionLeaseToken: base.executionLeaseToken,
      expectedGeneration: 0,
      rerunBlocks: [base.blockId],
      reason: "stale retry must not create another h1",
    }),
    /stale/,
    "a duplicate parent cannot advance the same durable repair generation twice",
  );

  // Model the crash after h1 commits but before the parent dispatches the
  // replacement child. A new execution lease must preserve h1, so the child
  // identity reattaches to h1 instead of the stale successful h0 child.
  run.leaseExpiresAt = Date.now() - 1;
  run.leaseOwner = "trigger-crashed";
  const recovered = await invoke<{
    executionAttempts: number;
    executionLeaseToken: number;
    selfHealGeneration: number;
  }>(claimExecutionLease, ctx, {
    ownerId: base.ownerId,
    channelId: base.channelId,
    runId: base.runId,
    leaseOwner: "trigger-recovered",
    now: Date.now(),
  });
  assert.equal(recovered.executionAttempts, 5);
  assert.equal(recovered.selfHealGeneration, 1);
  const recoveredH1DispatchKey = `${run._id}:${base.blockId}:h${recovered.selfHealGeneration}`;
  assert.equal(recoveredH1DispatchKey, "runs:remote-child:novita_render_video:h1");
  assert.notEqual(recoveredH1DispatchKey, base.dispatchKey);

  const recoveredBase = {
    ...base,
    leaseOwner: "trigger-recovered",
    executionLeaseToken: recovered.executionLeaseToken,
    dispatchKey: recoveredH1DispatchKey,
  };
  const h2 = await invoke<{ generation: number }>(advanceSelfHealGeneration, ctx, {
    ownerId: recoveredBase.ownerId,
    channelId: recoveredBase.channelId,
    runId: recoveredBase.runId,
    leaseOwner: recoveredBase.leaseOwner,
    executionLeaseToken: recoveredBase.executionLeaseToken,
    expectedGeneration: 1,
    rerunBlocks: ["qa_visual"],
    reason: "one final bounded repair",
  });
  assert.equal(h2.generation, 2);
  await assert.rejects(
    invoke<{ generation: number }>(advanceSelfHealGeneration, ctx, {
      ownerId: recoveredBase.ownerId,
      channelId: recoveredBase.channelId,
      runId: recoveredBase.runId,
      leaseOwner: recoveredBase.leaseOwner,
      executionLeaseToken: recoveredBase.executionLeaseToken,
      expectedGeneration: 2,
      rerunBlocks: ["qa_visual"],
      reason: "must reject h3",
    }),
    /invalid or exhausted/,
    "self-heal generation is capped at h2",
  );

  // Start a fresh short child receipt and make it idle. The ordinary indexed
  // reaper must recover it at the sliding expiry, not at its six-hour absolute
  // work deadline.
  const idleStartedAt = Date.now();
  const idleWaitUntil = idleStartedAt + renderChildWaitLeaseMs("offloaded");
  const idleDeadline = idleStartedAt + renderChildWorkDeadlineMs("offloaded");
  await invoke<number>(beginRemoteChildWait, ctx, {
    ...recoveredBase,
    waitUntil: idleWaitUntil,
    deadline: idleDeadline,
  });
  await assert.rejects(
    invoke<number>(assertRemoteChildWaitLease, ctx, {
      ...recoveredBase,
      now: idleWaitUntil + 1,
    }),
    /expired|stale/,
    "a late queued child cannot revive an expired short wait receipt before any provider work",
  );
  run.leaseExpiresAt = Date.now() - 1;
  run.remoteChildWaitUntil = run.leaseExpiresAt;
  await invoke<{ reaped: number }>(reapExpiredRunLeases, ctx, {});
  assert.equal(run.status, "failed");
  assert.equal(
    run.leaseRecoveryPending,
    undefined,
    "the minimal test row has no frozen invocation to resume, but it is promptly reaped",
  );

  console.log("REMOTE CHILD LEASE FENCE TESTS PASS");
}

void main();
