import assert from "node:assert/strict";
import { begin, finish, getForDispatch } from "../../../convex/remoteChildCosts";
import { executeRemoteCostTrackedBlock, type RemoteChildCostTransport } from "@/trigger/remoteChildCostTransport";
import { remoteChildFailureWithEvidence, type RemoteChildCostAttempt, type RemoteChildCostSummary } from "@/lib/remoteChildCostEvidence";
import { observeCheckpointCostReceipt } from "@/lib/checkpointCostAccounting";
import { recordImageUsage } from "@/lib/imageUsage";

const binding = {
  ownerId: "owner_a", channelId: "channel_a", runId: "run_a", leaseOwner: "parent_a",
  executionLeaseToken: 1, blockId: "novita_render_images", dispatchKey: "run_a:images:h0",
  taskRunId: "trigger_child_a", attemptNumber: 1,
};
type Receipt = { id: string; costUsd: number };
type Stage = {
  _id: string; ownerId: string; runId: string; block: string; status: string;
  cost: number; costBeforeExecution: number; remoteChildCostAttempts: RemoteChildCostAttempt[];
  checkpointCostReceipts: Receipt[];
};

function harness() {
  const run = {
    _id: binding.runId, ownerId: binding.ownerId, channelId: binding.channelId, status: "running",
    leaseOwner: binding.leaseOwner, executionAttempts: 1, leaseExpiresAt: Date.now() + 120_000,
    remoteChildWaitLeaseOwner: binding.leaseOwner, remoteChildWaitExecutionLeaseToken: 1,
    remoteChildWaitBlockId: binding.blockId, remoteChildWaitDispatchKey: binding.dispatchKey,
    remoteChildWaitUntil: Date.now() + 120_000,
  };
  const stage: Stage = {
    _id: "stage_a", ownerId: binding.ownerId, runId: binding.runId, block: binding.blockId,
    status: "running", cost: 0.3, costBeforeExecution: 0.3, remoteChildCostAttempts: [], checkpointCostReceipts: [],
  };
  let role = "service";
  const ctx = {
    auth: { getUserIdentity: async () => ({
      subject: role === "service" ? "service:youtube-studio-ai" : binding.ownerId,
      role, owner_id: binding.ownerId,
    }) },
    db: {
      normalizeId: (_table: string, id: string) => id,
      get: async (id: string) => id === binding.runId ? run : id === binding.channelId
        ? { _id: binding.channelId, ownerId: binding.ownerId } : id === stage._id ? stage : null,
      query: () => ({ withIndex: (_index: string, set: (q: { eq: (key: string, value: string) => unknown }) => unknown) => {
        const keys: Record<string, string> = {};
        const q = { eq(key: string, value: string) { keys[key] = value; return q; } };
        set(q);
        return { unique: async () => keys.runId === stage.runId && keys.block === stage.block ? structuredClone(stage) : null };
      } }),
      patch: async (id: string, patch: Partial<Stage>) => {
        assert.equal(id, stage._id);
        Object.assign(stage, structuredClone(patch));
      },
    },
  };
  const invoke = async <T>(definition: unknown, args: unknown): Promise<T> =>
    await (definition as { _handler: (context: unknown, input: unknown) => Promise<T> })._handler(ctx, args);
  const summary = () => invoke<RemoteChildCostSummary>(getForDispatch, binding);
  const transport = (attemptNumber: number): RemoteChildCostTransport => ({
    begin: () => invoke(begin, { ...binding, attemptNumber }),
    finish: (result) => invoke(finish, { ...binding, attemptNumber, ...result }),
  });
  const execute = (attemptNumber: number, block: () => Promise<Record<string, unknown>>, override?: RemoteChildCostTransport) =>
    executeRemoteCostTrackedBlock({
      paid: true, priorCostUsd: stage.cost, checkpointCostReceipts: stage.checkpointCostReceipts,
      transport: override ?? transport(attemptNumber), execute: block,
    });
  return { run, stage, invoke, summary, transport, execute, setRole: (value: string) => { role = value; } };
}

function close(actual: number, expected: number) { assert(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`); }

async function main() {
  // Exercise the production transport wrapper, actual authenticated Convex
  // handlers, durable stage projection, and parent failure reconstruction.
  const h = harness();
  await assert.rejects(h.execute(1, async () => {
    throw Object.assign(new Error("provider accepted images before quality rejection"), {
      observedCostUsd: 0.05, additionalObservedCostUsd: 0.15,
    });
  }), /quality rejection/);
  close(h.stage.cost, 0.5);
  const failure = remoteChildFailureWithEvidence("Trigger serializes only the error message", await h.summary());
  close((failure as Error & { observedCostUsd: number }).observedCostUsd, 0.2);
  assert.doesNotMatch(failure.message, /RECONCILIATION_REQUIRED/);
  const completed = await h.execute(2, async () => ({ imageKey: "accepted-image", __costUsd: 0.1 }));
  close(completed.__costUsd as number, 0.3);
  close(h.stage.cost, 0.6);
  let duplicateCalls = 0;
  await assert.rejects(h.execute(2, async () => { duplicateCalls++; return {}; }), /cannot replay/);
  assert.equal(duplicateCalls, 0);

  // Exact receipt replay is idempotent; altered result and stale fencing fail.
  const finishArgs = { ...binding, attemptNumber: 2, status: "succeeded", costUsd: 0.1, complete: true, checkpointCostReceipts: [] };
  await h.invoke(finish, finishArgs);
  close(h.stage.cost, 0.6);
  await assert.rejects(h.invoke(finish, { ...finishArgs, costUsd: 0.2 }), /immutable/);
  await assert.rejects(h.invoke(finish, { ...finishArgs, executionLeaseToken: 2 }), /stale/);
  await assert.rejects(h.invoke(begin, { ...binding, dispatchKey: "different-job" }), /stale dispatch/);
  h.setRole("owner");
  await assert.rejects(h.invoke(finish, finishArgs), /bound studio service identity/);

  // A failed child with no exact provider total preserves known lower-bound
  // costs and refuses both parent healing and a second paid child attempt.
  const unknown = harness();
  await assert.rejects(unknown.execute(1, async () => { throw new Error("connection lost after request"); }), /RECONCILIATION_REQUIRED/);
  assert.equal((await unknown.summary()).complete, false);
  await assert.rejects(unknown.execute(2, async () => { duplicateCalls++; return {}; }), /cannot replay/);
  const zero = harness();
  await assert.rejects(zero.execute(1, async () => { throw Object.assign(new Error("rejected before paid acceptance"), { observedCostUsd: 0 }); }), /rejected before/);
  assert.deepEqual(await zero.summary(), { costUsd: 0, complete: true, attempts: 1 });
  await zero.execute(2, async () => ({ imageKey: "output", __costUsd: 0.1 }));

  // A lost finish response does not lose or duplicate the committed charge.
  const lost = harness();
  const real = lost.transport(1);
  await assert.rejects(lost.execute(1, async () => ({ imageKey: "durable", __costUsd: 0.2 }), {
    begin: real.begin,
    finish: async (result) => { await real.finish(result); throw new Error("response connection dropped"); },
  }), /RECONCILIATION_REQUIRED/);
  close(lost.stage.cost, 0.5);
  assert.deepEqual(await lost.summary(), { costUsd: 0.2, complete: true, attempts: 1 });
  await real.finish({ status: "succeeded", costUsd: 0.2, complete: true, checkpointCostReceipts: [] });
  close(lost.stage.cost, 0.5);

  // Exact checkpoint charge identities avoid recharging a restored paid
  // asset when a later child attempt completes the remaining work.
  const cached = harness();
  cached.stage.cost = 0;
  cached.stage.costBeforeExecution = 0;
  const receipt = { id: "a".repeat(64), costUsd: 0.2 };
  await assert.rejects(cached.execute(1, async () => {
    observeCheckpointCostReceipt(receipt, false);
    throw Object.assign(new Error("QC unavailable after saved image"), { observedCostUsd: 0.2 });
  }), /QC unavailable/);
  const restored = await cached.execute(2, async () => {
    observeCheckpointCostReceipt(receipt, true);
    return { imageKey: "same-paid-checkpoint", __costUsd: 0.2 };
  });
  close(restored.__costUsd as number, 0.2);
  close(cached.stage.cost, 0.2);
  assert.equal(cached.stage.checkpointCostReceipts.length, 1);

  for (const scoped of [false, true]) {
    for (const cumulative of [false, true]) {
      for (const supplemental of [0, 0.04]) {
        const mixed = harness();
        mixed.stage.cost = 0.2;
        mixed.stage.costBeforeExecution = 0.2;
        mixed.stage.checkpointCostReceipts = [receipt];
        await assert.rejects(mixed.execute(1, async () => {
          observeCheckpointCostReceipt(receipt, true);
          if (scoped) recordImageUsage({ provider: "test", model: "test", route: "test", images: 1, costUsd: 0.1 });
          throw Object.assign(new Error("new image accepted before its checkpoint write failed"), {
            observedCostUsd: cumulative ? 0.3 : 0.1,
            observedCostIncludesCheckpointReceipts: cumulative,
            additionalObservedCostUsd: supplemental,
          });
        }), /checkpoint write failed/);
        close((await mixed.summary()).costUsd, 0.1 + supplemental);
        close(mixed.stage.cost, 0.3 + supplemental);
      }
    }
  }

  // No finish after a process loss: its begun receipt fences all replays.
  const crashed = harness();
  await crashed.transport(1).begin();
  await assert.rejects(crashed.execute(2, async () => { duplicateCalls++; return {}; }), /cannot replay/);
  assert.equal((await crashed.summary()).complete, false);
  const missingTotal = harness();
  await assert.rejects(missingTotal.execute(1, async () => ({ imageKey: "paid-output-without-price" })), /RECONCILIATION_REQUIRED/);
  assert.equal((await missingTotal.summary()).complete, false, "a paid successful result without a total cannot become a zero-cost success");
  console.log("REMOTE CHILD COST TRANSPORT PASS — real mutation handlers, cumulative failures, duplicate/lost responses, checkpoint reuse, stale fences, unknown-cost holds");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
