import assert from "node:assert/strict";
import { makeConvexSink } from "@/engine/convexSink";
import { manifestFromBlock } from "@/engine/moduleManifest";
import { sealStageReuseReceipt, stageInvocationHash } from "@/engine/stageReuse";
import { listRunStages, upsertRunStage } from "../../../convex/runStages";

type Handler = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };
const scope = { ownerId: "receipt-owner", runId: "receipt-run", channelId: "receipt-channel", keyPrefix: "owners/receipt/" };
const fence = { leaseOwner: "receipt-worker", executionLeaseToken: 1 };
const run = { _id: scope.runId, ownerId: scope.ownerId, channelId: scope.channelId, status: "running",
  leaseOwner: fence.leaseOwner, executionAttempts: 1, leaseExpiresAt: Date.now() + 60_000 };
let row: Record<string, unknown> | undefined;
let progress: Record<string, unknown> | undefined;
let reads = 0;
const ctx = {
  auth: { getUserIdentity: async () => ({ subject: "receipt-service", role: "service", owner_id: scope.ownerId }) },
  db: {
    normalizeId: (_table: string, id: string) => id,
    get: async (id: string) => id === scope.runId ? run : { _id: scope.channelId, ownerId: scope.ownerId },
    query: (table: string) => ({ withIndex: () => ({
      unique: async () => (table === "runStageProgress" ? progress : row) ?? null,
      collect: async () => row ? [row] : [], take: async () => row ? [row] : [],
    }) }),
    insert: async (table: string, value: Record<string, unknown>) => {
      if (table === "runStageProgress") { progress = { _id: "progress-receipt", ...structuredClone(value) }; return progress._id; }
      row = { _id: "stage-receipt", ...structuredClone(value) }; return row._id;
    },
    patch: async (id: string, patch: Record<string, unknown>) => {
      const target = id === "progress-receipt" ? progress! : row!;
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete target[key]; else target[key] = structuredClone(value);
      }
    },
  },
};
const invoke = (args: unknown) => (upsertRunStage as unknown as Handler)._handler(ctx, args);
const client = {
  mutation: async (_ref: unknown, args: unknown) => invoke(JSON.parse(JSON.stringify(args))),
  query: async (_ref: unknown, args: unknown) => {
    reads++; return (listRunStages as unknown as Handler)._handler(ctx, args);
  },
};

async function main() {
  const sink = makeConvexSink(client as never, scope.ownerId, fence);
  const manifest = manifestFromBlock({ id: "receipt-stage", consumes: [], produces: [], run: async () => ({}) });
  const outputs = { savedText: "Original reviewed text" };
  const receipt = sealStageReuseReceipt(stageInvocationHash({ ...scope, manifest, params: {}, store: {}, inputRefs: {} }), outputs, []);
  const write = { ownerId: scope.ownerId, runId: scope.runId, block: manifest.id };
  await sink.upsert({ ...write, status: "ok", outputs, reuseReceipt: receipt, cost: 0.3 });
  assert.deepEqual(row?.reuseReceipt, receipt, "actual mutation stores the receipt with its output");
  const resumed = await sink.getResumeState!(scope.runId);
  assert.deepEqual(resumed[0]?.reuseReceipt, receipt);
  assert.equal(reads, 1, "receipt comes from the existing single resume read");
  assert.deepEqual((await sink.getCompleted!(scope.runId))[0]?.reuseReceipt, receipt);
  const slim = await (listRunStages as unknown as Handler)._handler(ctx, { runId: scope.runId, slim: true }) as Record<string, unknown>[];
  assert.equal(slim[0]?.reuseReceipt, undefined, "browser subscriptions do not carry the extra receipt payload");
  await sink.upsert({ ...write, status: "ok", finishedAt: Date.now() });
  assert.deepEqual(row?.reuseReceipt, receipt, "pure cached status update preserves original proof");
  assert.deepEqual(row?.outputs, outputs);
  await sink.upsert({ ...write, status: "failed", error: "STAGE_REUSE_RECONCILIATION_REQUIRED" });
  assert.deepEqual(row?.reuseReceipt, receipt, "hold retains the evidence for reconciliation");
  assert.equal(row?.cost, 0.3);
  await sink.upsert({ ...write, status: "running" });
  assert.equal(row?.reuseReceipt, undefined, "a new execution cannot inherit the previous success receipt");
  await sink.upsert({ ...write, status: "ok", outputs, reuseReceipt: receipt });
  await sink.upsert({ ...write, status: "ok", outputs: { savedText: "unsealed replacement" } });
  assert.equal(row?.reuseReceipt, undefined, "legacy/external output replacement invalidates the old receipt");
  const before = structuredClone(row);
  await assert.rejects(sink.upsert({ ...write, status: "running", outputs, reuseReceipt: receipt }), /successful output write/);
  await assert.rejects(sink.upsert({ ...write, status: "ok", outputs, reuseReceipt: { ...receipt, fingerprint: "bad" } }), /Invalid/);
  assert.deepEqual(row, before, "invalid writes do not change saved data or spend");
  console.log("STAGE REUSE PERSISTENCE PASS — actual Convex handlers and sink, isolated database transport");
}

void main();
