import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cancelUnsealedManualPrivateRun, createProbeRun, failUnstartedManualPrivateRun } from "../../../convex/runs";

const rows = new Map<string, Record<string, unknown>>();
let identity = { role: "service", owner_id: "owner-a", subject: "service:test" };
const ctx = {
  auth: { getUserIdentity: async () => identity },
  db: {
    normalizeId: (_table: string, id: string) => id,
    get: async (id: string) => id === "channel-a" ? { ownerId: "owner-a" } : rows.get(id),
    query: () => ({ withIndex: (_name: string, build: (q: { eq: (key: string, value: string) => unknown }) => unknown) => {
      const filters: Record<string, string> = {};
      const q = { eq: (key: string, value: string) => { filters[key] = value; return q; } };
      build(q);
      return { unique: async () => [...rows.values()].find(row => row.channelId === filters.channelId && row.probeDispatchKey === filters.probeDispatchKey) ?? null, take: async () => [] };
    } }),
    insert: async (_table: string, row: Record<string, unknown>) => { const id = `run-${rows.size + 1}`; rows.set(id, { ...row, _id: id }); return id; },
    patch: async (id: string, patch: Record<string, unknown>) => { Object.assign(rows.get(id)!, patch); },
  },
};
const handler = (createProbeRun as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<string> })._handler;
const input = { ownerId: "owner-a", channelId: "channel-a", dispatchKey: "manual-private-video:request-a", manualRequestFingerprint: "a".repeat(64), manualMaximumCostUsd: 25 };
async function main() {
  identity = { role: "owner", owner_id: "owner-a", subject: "owner-a" };
  await assert.rejects(handler(ctx, input), /requires the bound studio service identity/);
  assert.equal(rows.size, 0);
  identity = { role: "service", owner_id: "owner-a", subject: "service:test" };
  const id = await handler(ctx, input);
  assert.equal(await handler(ctx, input), id);
  await assert.rejects(handler(ctx, { ...input, manualRequestFingerprint: "b".repeat(64) }), /changed before its snapshot/);
  rows.get(id)!.probeDispatchEnvelope = { sealed: true };
  assert.equal(await handler(ctx, { ...input, manualRequestFingerprint: "b".repeat(64) }), id, "a sealed retry reuses the frozen request after a channel edit");
  await assert.rejects(handler(ctx, { ...input, manualMaximumCostUsd: 26 }), /changed before its snapshot/);
  assert.equal(rows.size, 1);
  const other = await handler(ctx, { ...input, dispatchKey: "manual-private-video:request-b" });
  const cancel = (cancelUnsealedManualPrivateRun as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<boolean> })._handler;
  const recovery = { ownerId: "owner-a", channelId: "channel-a", runId: other, currentFingerprint: "b".repeat(64) };
  assert.equal(await cancel(ctx, { ...recovery, currentFingerprint: "a".repeat(64) }), false);
  assert.equal(await cancel(ctx, recovery), true);
  assert.equal(rows.get(other)?.status, "canceled");
  assert.equal(await cancel(ctx, recovery), true, "lost cancellation responses remain safely retryable");
  assert.equal(await cancel(ctx, { ...recovery, runId: id }), false, "a sealed request cannot be canceled by this recovery path");
  const pending = await handler(ctx, { ...input, dispatchKey: "manual-private-video:request-c" });
  Object.assign(rows.get(pending)!, { probeDispatchEnvelope: { input: { invocationContext: { invocationKind: "manual_private_video" } } }, probeDispatchEnvelopeFingerprint: "c".repeat(64) });
  const fail = (failUnstartedManualPrivateRun as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<boolean> })._handler;
  const failure = { ownerId: "owner-a", channelId: "channel-a", runId: pending, envelopeFingerprint: "c".repeat(64) };
  assert.equal(await fail(ctx, { ...failure, envelopeFingerprint: "d".repeat(64) }), false);
  rows.get(pending)!.leaseOwner = "active-worker";
  assert.equal(await fail(ctx, failure), false, "a running lease must never be overwritten by failure reconciliation");
  delete rows.get(pending)!.leaseOwner;
  assert.equal(await fail(ctx, failure), true);
  assert.equal(rows.get(pending)?.status, "failed");
  assert.equal(await fail(ctx, failure), false);
  const runner = readFileSync("src/trigger/runPipeline.ts", "utf8");
  assert.match(runner, /onFailure:[\s\S]*manual_private_video[\s\S]*failUnstartedManualPrivateRun[\s\S]*run: async/,
    "the final task-failure hook reconciles only the manual private path");
  console.log("Manual private run shell binds owner, budget and pre-seal channel snapshot");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
