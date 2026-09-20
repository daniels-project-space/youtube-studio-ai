import assert from "node:assert/strict";
import { test } from "node:test";
import { listDueSerializedProgramEpisodeRetries } from "../../../convex/runs";
import { reapExpiredQueuedResumes } from "../../../convex/musicAuditionCheckpoints";
import { pipelineInvocationSha256 } from "../pipelineInvocationHash";
import type { PipelineInvocationSnapshot } from "../pipelineInvocationSnapshot";
import { RUN_QUEUE_LEASE_MS } from "../runLease";

type Row = Record<string, unknown> & { _id: string };
const ownerId = "owner-bounds";
const now = RUN_QUEUE_LEASE_MS + 2_000_000;

// Model Convex's optional-number index ordering, notably undefined < every number.
function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  assert.equal(typeof a, "number");
  assert.equal(typeof b, "number");
  return (a as number) < (b as number) ? -1 : 1;
}

function fixture(rows: Row[], role = "service") {
  const readIds: string[] = [], patchedIds: string[] = [];
  const db = {
    get: async (id: string) => rows.find(row => row._id === id) ?? null,
    patch: async (id: string, patch: Row) => {
      patchedIds.push(id);
      const row = rows.find(row => row._id === id);
      assert(row);
      Object.assign(row, patch);
    },
    query: (table: string) => {
      assert.equal(table, "runs");
      let selected = rows.slice();
      const range = {
        eq: (key: string, value: unknown) => { selected = selected.filter(row => row[key] === value); return range; },
        gt: (key: string, value: unknown) => { selected = selected.filter(row => compare(row[key], value) > 0); return range; },
        lte: (key: string, value: unknown) => { selected = selected.filter(row => compare(row[key], value) <= 0); return range; },
      };
      const query = {
        withIndex: (index: string, build: (builder: typeof range) => unknown) => {
          const key = index === "by_owner_serialized_program_episode_retry"
            ? "serializedProgramEpisodeRetryAt" : "musicAuditionResumeQueueDeadlineAt";
          assert.ok(["by_owner_serialized_program_episode_retry", "by_owner_music_audition_resume_queue_deadline"].includes(index));
          selected.sort((a, b) => compare(a[key], b[key]));
          build(range);
          return query;
        },
        take: async (limit: number) => {
          const result = selected.slice(0, limit);
          readIds.push(...result.map(row => row._id));
          return result;
        },
      };
      return query;
    },
  };
  const ctx = { db, auth: { getUserIdentity: async () => ({
    subject: role === "service" ? "service:youtube-studio-ai" : ownerId, role, owner_id: ownerId,
  }) } };
  return {
    readIds, patchedIds,
    invoke: <T>(definition: unknown, args = { ownerId, now, limit: 2 }): Promise<T> =>
      (definition as { _handler: (ctx: unknown, args: unknown) => Promise<T> })._handler(ctx, args),
  };
}

function retry(id: string, status: string): Row {
  const invocation: PipelineInvocationSnapshot = {
    version: 1, ownerId, channelId: "channel-bounds", runId: id, source: "channel",
    entries: [{ block: "music" }], seedStore: {}, budgetUsd: 10,
    keyPrefix: `owner/${ownerId}/runs/${id}/`, remoteBlocks: [], defaultRetries: 2,
    compilationFingerprint: "a".repeat(64), compilationPolicyId: "production-contract",
    compilationPolicyVersion: "2", compilationModules: [{ id: "music", version: "1.0.0" }],
    compilationCapabilities: [], reservedMaxCostUsd: 5,
  };
  return { _id: id, ownerId, channelId: invocation.channelId, status,
    pipelineInvocationSnapshot: invocation, pipelineInvocationSha256: pipelineInvocationSha256(invocation),
    serializedProgramEpisodeRetryAt: now, serializedProgramEpisodeRetryAttempts: 1,
    ...(status === "failed" ? { leaseRecoveryPending: true } : {}),
  };
}

test("ordinary queued/failed runs cannot starve due serialized retries or consume read batches", async () => {
  const ordinary = ["queued", "failed"].flatMap(status => Array.from({ length: 100 }, (_, i) => ({
    _id: `${status}-${i}`, ownerId, status,
  })));
  const future = { ...retry("future", "queued"), serializedProgramEpisodeRetryAt: now + 1 };
  const f = fixture([...ordinary, retry("due-queued", "queued"), retry("due-failed", "failed"), future]);
  const receipts = await f.invoke<Array<{ runId: string }>>(listDueSerializedProgramEpisodeRetries);
  assert.deepEqual(receipts.map(row => row.runId), ["due-queued", "due-failed"]);
  assert.deepEqual(f.readIds, ["due-queued", "due-failed"]);
  assert.deepEqual(f.patchedIds, []);
});

test("music due slice is independent of legacy backlog and does not read future deadlines", async () => {
  const base = { ownerId, status: "awaiting_music_audition", musicAuditionState: "approved", musicAuditionResumeState: "queued" };
  const legacy = Array.from({ length: 100 }, (_, i) => ({ ...base, _id: `legacy-${i}`, musicAuditionResumeQueuedAt: now }));
  // Invalid due receipt deliberately exercises fail-closed recovery, not fabricated approval.
  const due = { ...base, _id: "due", musicAuditionResumeQueueDeadlineAt: now };
  const future = { ...base, _id: "future", musicAuditionResumeQueueDeadlineAt: now + 1 };
  const f = fixture([...legacy, due, future]);
  assert.deepEqual(await f.invoke(reapExpiredQueuedResumes), { requeued: 0, blocked: 1 });
  assert.deepEqual(f.readIds, ["due", "legacy-0", "legacy-1"]);
  assert.deepEqual(f.patchedIds, ["due"]);
  assert.equal(future.musicAuditionResumeState, "queued");
});

test("legacy music recovery remains bounded and inspects receipts without explicit deadlines", async () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    _id: `legacy-${i}`, ownerId, musicAuditionResumeState: "queued", musicAuditionResumeQueuedAt: 0,
  }));
  const f = fixture(rows);
  assert.deepEqual(await f.invoke(reapExpiredQueuedResumes), { requeued: 0, blocked: 2 });
  assert.deepEqual(f.readIds, ["legacy-0", "legacy-1"]);
});

test("owner requests cannot read either service outbox", async () => {
  for (const definition of [reapExpiredQueuedResumes, listDueSerializedProgramEpisodeRetries]) {
    const f = fixture([], "owner");
    await assert.rejects(f.invoke(definition), /service identity/);
    assert.deepEqual(f.readIds, []);
  }
});
