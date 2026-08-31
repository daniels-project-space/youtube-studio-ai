import assert from "node:assert/strict";

import {
  FACTUAL_REVIEW_CHECKPOINT_VERSION,
  FACTUAL_REVIEW_REQUIRED_ARTIFACTS,
  factualReviewApprovalFingerprint,
  factualReviewCheckpointFingerprint,
  factualReviewSourceAuthorityFromInvocation,
} from "@/engine/factualReviewCheckpoint";
import { canonicalJson } from "@/lib/canonicalJson";
import { pipelineInvocationSha256 } from "@/lib/pipelineInvocationHash";
import type { PipelineInvocationSnapshot } from "@/lib/pipelineInvocationSnapshot";
import { sha256Hex } from "@/lib/sha256";
import {
  claimExecutionLease,
  reapExpiredRunLeases,
} from "../../../convex/runs";
import {
  listPendingResumes,
  markResumeQueued,
  reapExpiredQueuedResumes,
} from "../../../convex/factualReviewCheckpoints";
import { RUN_QUEUE_LEASE_MS } from "@/lib/runLease";

type Row = Record<string, unknown> & { _id: string; _creationTime: number };
type Filter = { field: string; op: "eq" | "gt" | "lte"; value: unknown };

class MemoryQuery {
  private readonly filters: Filter[] = [];

  constructor(
    private readonly db: MemoryDb,
    private readonly table: string,
  ) {}

  withIndex(_name: string, build: (range: {
    eq: (field: string, value: unknown) => unknown;
    gt: (field: string, value: unknown) => unknown;
    lte: (field: string, value: unknown) => unknown;
  }) => unknown): this {
    const range = {
      eq: (field: string, value: unknown) => {
        this.filters.push({ field, op: "eq", value });
        return range;
      },
      gt: (field: string, value: unknown) => {
        this.filters.push({ field, op: "gt", value });
        return range;
      },
      lte: (field: string, value: unknown) => {
        this.filters.push({ field, op: "lte", value });
        return range;
      },
    };
    build(range);
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every(({ field, op, value }) => {
      const actual = row[field];
      if (op === "eq") return actual === value;
      if (op === "gt") {
        if (value === undefined) return actual !== undefined;
        return typeof actual === "number" && typeof value === "number" && actual > value;
      }
      return typeof actual === "number" && typeof value === "number" && actual <= value;
    });
  }

  async collect(): Promise<Row[]> {
    return this.db.rows(this.table).filter((row) => this.matches(row));
  }

  async take(limit: number): Promise<Row[]> {
    return (await this.collect()).slice(0, limit);
  }

  async first(): Promise<Row | null> {
    return (await this.collect())[0] ?? null;
  }

  async unique(): Promise<Row | null> {
    const rows = await this.collect();
    if (rows.length > 1) throw new Error("expected one row");
    return rows[0] ?? null;
  }
}

class MemoryDb {
  private counter = 0;
  private readonly tables = new Map<string, Map<string, Row>>();

  seed(table: string, data: Omit<Row, "_id" | "_creationTime">, id: string): Row {
    const row: Row = { ...data, _id: id, _creationTime: ++this.counter };
    const tableRows = this.tables.get(table) ?? new Map<string, Row>();
    tableRows.set(id, row);
    this.tables.set(table, tableRows);
    return row;
  }

  rows(table: string): Row[] {
    return [...(this.tables.get(table)?.values() ?? [])];
  }

  async get(id: string): Promise<Row | null> {
    for (const rows of this.tables.values()) {
      const row = rows.get(id);
      if (row) return row;
    }
    return null;
  }

  normalizeId(table: string, id: string): string | null {
    return this.tables.get(table)?.has(id) ? id : null;
  }

  query(table: string): MemoryQuery {
    return new MemoryQuery(this, table);
  }

  async patch(id: string, patch: Record<string, unknown>): Promise<void> {
    const row = await this.get(id);
    if (!row) throw new Error(`missing row ${id}`);
    Object.assign(row, patch);
  }
}

function serviceContext(db: MemoryDb) {
  return {
    auth: {
      getUserIdentity: async () => ({
        subject: "service:youtube-studio-ai",
        role: "service",
        owner_id: "owner_factual_recovery",
      }),
    },
    db,
  };
}

async function invoke<T>(definition: unknown, ctx: unknown, args: unknown): Promise<T> {
  return await (definition as {
    _handler: (handlerContext: unknown, handlerArgs: unknown) => Promise<T>;
  })._handler(ctx, args);
}

async function main(): Promise<void> {
  const db = new MemoryDb();
  const ownerId = "owner_factual_recovery";
  const channelId = "channels:factual-recovery";
  const runId = "runs:factual-recovery";
  const packId = "reviewedEvidencePacks:factual-recovery";
  const checkpointId = "factualReviewCheckpoints:factual-recovery";
  const fp = (value: string) => sha256Hex(value);
  const rawLedger = {
    version: "data-story-source-ledger/v1",
    rows: [{ source: "https://example.test/source", claim: "A retained factual claim" }],
  };
  const contentFingerprint = fp("reviewed-pack-content");
  const authorityContentFingerprint = fp("reviewed-pack-authority");
  const routeSeedFingerprint = fp("route-seed");
  const topicFingerprint = fp("topic");
  const showProfileFingerprint = fp("show-profile");
  const seedStore = {
    dataStorySourceLedger: rawLedger,
    reviewedEvidencePack: {
      contentFingerprint,
      authorityContentFingerprint,
      sourceAuthority: {
        kind: "data_story_source_ledger",
        dataStorySourceLedger: rawLedger,
      },
    },
    reviewedEvidencePackRunAdmission: {
      version: "reviewed-evidence-pack-run-admission/v1",
      authorityKind: "data_story_source_ledger",
      contentFingerprint,
      authorityContentFingerprint,
      routeSeedFingerprint,
      topicFingerprint,
      showProfileFingerprint,
      selectedCapabilityKeys: ["source_attributed_data_story"],
      selector: { packId, contentFingerprint },
    },
  };
  const snapshot: PipelineInvocationSnapshot = {
    version: 1,
    ownerId,
    runId,
    channelId,
    source: "channel",
    entries: [{ block: "script_gen" }],
    seedStore,
    budgetUsd: 3,
    keyPrefix: `owner/${ownerId}/channel/factual-recovery`,
    remoteBlocks: [],
    defaultRetries: 0,
    compilationFingerprint: fp("compilation"),
    compilationPolicyId: "test",
    compilationPolicyVersion: "1",
    compilationModules: [],
    compilationCapabilities: ["source_attributed_data_story"],
    reservedMaxCostUsd: 0,
    showProfileFingerprint,
  };
  const invocationSha256 = pipelineInvocationSha256(snapshot);
  const sourceAuthority = factualReviewSourceAuthorityFromInvocation(snapshot);

  db.seed("channels", { ownerId }, channelId);
  db.seed("reviewedEvidencePacks", {
    ownerId,
    authorityKind: "data_story_source_ledger",
    contentFingerprint,
    authorityContentFingerprint,
    routeSeedFingerprint,
    topicFingerprint,
    showProfileFingerprint,
    selectedCapabilityKeys: ["source_attributed_data_story"],
    pack: {
      sourceAuthority: {
        kind: "data_story_source_ledger",
        dataStorySourceLedger: rawLedger,
      },
    },
  }, packId);

  const outputsByModule = new Map<string, Record<string, unknown>>();
  for (const requirement of FACTUAL_REVIEW_REQUIRED_ARTIFACTS) {
    const outputs = outputsByModule.get(requirement.producerModule) ?? {};
    outputs[requirement.key] = `retained:${requirement.key}`;
    outputsByModule.set(requirement.producerModule, outputs);
  }
  const artifactBindings = [] as Array<{
    key: typeof FACTUAL_REVIEW_REQUIRED_ARTIFACTS[number]["key"];
    artifactId: string;
    payloadHash: string;
    producerModule: string;
    producerVersion: string;
    schemaVersion: string;
  }>;
  for (const [module, outputs] of outputsByModule) {
    db.seed("runStages", {
      ownerId,
      runId,
      block: module,
      status: "ok",
      outputs,
      cost: module === "narration_tts" ? 0.42 : 0,
    }, `runStages:${module}`);
  }
  for (const requirement of FACTUAL_REVIEW_REQUIRED_ARTIFACTS) {
    const value = outputsByModule.get(requirement.producerModule)?.[requirement.key];
    const payloadHash = sha256Hex(canonicalJson(value));
    const artifactId = `runArtifacts:${requirement.key}`;
    db.seed("runArtifacts", {
      ownerId,
      runId,
      key: requirement.key,
      artifactId,
      payloadHash,
      producerModule: requirement.producerModule,
      producerVersion: "test-v1",
      schemaVersion: "test/v1",
      createdAt: 1,
    }, artifactId);
    artifactBindings.push({
      key: requirement.key,
      artifactId,
      payloadHash,
      producerModule: requirement.producerModule,
      producerVersion: "test-v1",
      schemaVersion: "test/v1",
    });
  }
  const checkpointFingerprint = factualReviewCheckpointFingerprint({
    ownerId,
    channelId,
    runId,
    invocationSha256,
    sourceAuthority,
    artifacts: artifactBindings,
  });
  const approvalFingerprint = factualReviewApprovalFingerprint({
    checkpointFingerprint,
    reviewerId: ownerId,
    approvedAt: Date.now() - 20_000,
  });
  db.seed("factualReviewCheckpoints", {
    ownerId,
    channelId,
    runId,
    version: FACTUAL_REVIEW_CHECKPOINT_VERSION,
    invocationSha256,
    sourceAuthority,
    artifacts: artifactBindings,
    checkpointFingerprint,
    decision: "approved",
    createdAt: Date.now() - 30_000,
    reviewerId: ownerId,
    approvedAt: Date.now() - 20_000,
    approvalFingerprint,
  }, checkpointId);
  const expiredAt = Date.now() - 10_000;
  db.seed("runs", {
    ownerId,
    channelId,
    status: "running",
    startedAt: expiredAt - 60_000,
    heartbeatAt: expiredAt,
    leaseExpiresAt: expiredAt,
    leaseOwner: "crashed-approved-continuation",
    executionAttempts: 1,
    costTotal: 0.42,
    pipelineInvocationSnapshot: snapshot,
    pipelineInvocationSha256: invocationSha256,
    factualReviewCheckpointId: checkpointId,
    factualReviewCheckpointFingerprint: checkpointFingerprint,
    factualReviewState: "resumed",
    factualReviewResumeState: "consumed",
    factualReviewApprovalFingerprint: approvalFingerprint,
    factualReviewResumeAttempts: 1,
  }, runId);

  const ctx = serviceContext(db);
  const narrationBefore = structuredClone(
    (await db.get("runStages:narration_tts"))?.outputs,
  );
  const artifactCountBefore = db.rows("runArtifacts").length;

  await invoke<{ reaped: number }>(reapExpiredRunLeases, ctx, {});
  const requeued = await db.get(runId);
  assert.equal(requeued?.status, "awaiting_factual_review");
  assert.equal(requeued?.factualReviewState, "approved");
  assert.equal(requeued?.factualReviewResumeState, "pending");
  assert.equal(requeued?.leaseRecoveryPending, undefined, "generic scheduler recovery must not own this receipt");
  assert.equal((await db.get(checkpointId))?.decision, "approved", "the owner decision is retained, never re-requested");
  assert.deepEqual((await db.get("runStages:narration_tts"))?.outputs, narrationBefore);
  assert.equal(db.rows("runArtifacts").length, artifactCountBefore, "requeueing does not create a second TTS artifact");

  const pending = await invoke<Array<Record<string, unknown>>>(listPendingResumes, ctx, {
    ownerId,
    limit: 10,
  });
  assert.equal(pending.length, 1, "the expired continuation returns only through its factual outbox");
  assert.deepEqual(
    {
      checkpointId: pending[0]?.checkpointId,
      checkpointFingerprint: pending[0]?.checkpointFingerprint,
      approvalFingerprint: pending[0]?.approvalFingerprint,
      invocationSha256: pending[0]?.invocationSha256,
    },
    { checkpointId, checkpointFingerprint, approvalFingerprint, invocationSha256 },
    "the outbox reconstructs the exact immutable approval envelope",
  );

  const claim = await invoke<Record<string, unknown>>(claimExecutionLease, ctx, {
    ownerId,
    channelId,
    runId,
    leaseOwner: "recovered-approved-continuation",
    now: Date.now(),
    factualReviewResume: {
      checkpointId,
      checkpointFingerprint,
      approvalFingerprint,
      invocationSha256,
    },
  });
  assert.equal(claim.kind, "claimed", "the recovered task crosses the boundary only with its exact approval receipt");
  const resumed = await db.get(runId);
  assert.equal(resumed?.status, "running");
  assert.equal(resumed?.factualReviewState, "resumed");
  assert.equal(resumed?.factualReviewResumeState, "consumed");
  assert.deepEqual((await db.get("runStages:narration_tts"))?.outputs, narrationBefore);
  assert.equal(db.rows("runArtifacts").length, artifactCountBefore, "claiming recovery still does not replay TTS or review");

  // A stale envelope is not returned to generic recovery. It is converted to
  // the same visible manual block as a missing approval field, and cannot
  // later be revived by an old Trigger delivery.
  await db.patch(runId, {
    status: "running",
    heartbeatAt: Date.now() - 10_000,
    leaseExpiresAt: Date.now() - 10_000,
    leaseOwner: "crashed-stale-continuation",
    factualReviewState: "resumed",
    factualReviewResumeState: "consumed",
    factualReviewApprovalFingerprint: fp("stale-approval-envelope"),
  });
  await invoke<{ reaped: number }>(reapExpiredRunLeases, ctx, {});
  const blocked = await db.get(runId);
  assert.equal(blocked?.status, "factual_review_blocked");
  assert.equal(blocked?.factualReviewState, "blocked");
  assert.equal(blocked?.factualReviewResumeState, "blocked");
  assert.equal((await db.get(checkpointId))?.decision, "blocked");
  assert.equal(db.rows("runArtifacts").length, artifactCountBefore, "a stale envelope never causes a retry spend");
  const staleClaim = await invoke<Record<string, unknown>>(claimExecutionLease, ctx, {
    ownerId,
    channelId,
    runId,
    leaseOwner: "late-stale-delivery",
    now: Date.now(),
    factualReviewResume: {
      checkpointId,
      checkpointFingerprint,
      approvalFingerprint,
      invocationSha256,
    },
  });
  assert.equal(staleClaim.kind, "factual_review_ineligible");

  const missingRunId = "runs:factual-missing-envelope";
  db.seed("runs", {
    ownerId,
    channelId,
    status: "running",
    startedAt: Date.now() - 70_000,
    heartbeatAt: Date.now() - 10_000,
    leaseExpiresAt: Date.now() - 10_000,
    leaseOwner: "crashed-missing-continuation",
    executionAttempts: 1,
    costTotal: 0.42,
    factualReviewState: "resumed",
    factualReviewResumeState: "consumed",
    factualReviewResumeAttempts: 0,
  }, missingRunId);
  await invoke<{ reaped: number }>(reapExpiredRunLeases, ctx, {});
  const missingBlocked = await db.get(missingRunId);
  assert.equal(missingBlocked?.status, "factual_review_blocked");
  assert.equal(missingBlocked?.factualReviewState, "blocked");
  assert.equal(missingBlocked?.factualReviewResumeState, "blocked");
  assert.equal(db.rows("runArtifacts").length, artifactCountBefore, "a missing envelope cannot enter generic recovery or spend");

  // A Trigger acceptance is not a durable execution claim. Exercise the
  // distinct failure mode where the accepted continuation never starts: the
  // outbox must reissue the same immutable approval envelope once, then turn
  // a second lost delivery into a visible manual block rather than looping.
  const queuedRunId = "runs:factual-queued-delivery";
  const queuedCheckpointId = "factualReviewCheckpoints:factual-queued-delivery";
  const queuedSnapshot: PipelineInvocationSnapshot = { ...snapshot, runId: queuedRunId };
  const queuedInvocationSha256 = pipelineInvocationSha256(queuedSnapshot);
  const queuedSourceAuthority = factualReviewSourceAuthorityFromInvocation(queuedSnapshot);
  const queuedArtifacts = artifactBindings.map((artifact) => ({
    ...artifact,
    artifactId: `${artifact.artifactId}:queued-delivery`,
  }));
  for (const [module, outputs] of outputsByModule) {
    db.seed("runStages", {
      ownerId,
      runId: queuedRunId,
      block: module,
      status: "ok",
      outputs,
      cost: module === "narration_tts" ? 0.42 : 0,
    }, `runStages:queued-delivery:${module}`);
  }
  for (const artifact of queuedArtifacts) {
    db.seed("runArtifacts", {
      ownerId,
      runId: queuedRunId,
      key: artifact.key,
      artifactId: artifact.artifactId,
      payloadHash: artifact.payloadHash,
      producerModule: artifact.producerModule,
      producerVersion: artifact.producerVersion,
      schemaVersion: artifact.schemaVersion,
      createdAt: 2,
    }, artifact.artifactId);
  }
  const queuedCheckpointFingerprint = factualReviewCheckpointFingerprint({
    ownerId,
    channelId,
    runId: queuedRunId,
    invocationSha256: queuedInvocationSha256,
    sourceAuthority: queuedSourceAuthority,
    artifacts: queuedArtifacts,
  });
  const queuedApprovalFingerprint = factualReviewApprovalFingerprint({
    checkpointFingerprint: queuedCheckpointFingerprint,
    reviewerId: ownerId,
    approvedAt: Date.now() - 8 * 60 * 60_000,
  });
  db.seed("factualReviewCheckpoints", {
    ownerId,
    channelId,
    runId: queuedRunId,
    version: FACTUAL_REVIEW_CHECKPOINT_VERSION,
    invocationSha256: queuedInvocationSha256,
    sourceAuthority: queuedSourceAuthority,
    artifacts: queuedArtifacts,
    checkpointFingerprint: queuedCheckpointFingerprint,
    decision: "approved",
    createdAt: Date.now() - 9 * 60 * 60_000,
    reviewerId: ownerId,
    approvedAt: Date.now() - 8 * 60 * 60_000,
    approvalFingerprint: queuedApprovalFingerprint,
  }, queuedCheckpointId);
  db.seed("runs", {
    ownerId,
    channelId,
    status: "awaiting_factual_review",
    startedAt: Date.now() - 9 * 60 * 60_000,
    heartbeatAt: Date.now() - 8 * 60 * 60_000,
    costTotal: 0.42,
    pipelineInvocationSnapshot: queuedSnapshot,
    pipelineInvocationSha256: queuedInvocationSha256,
    factualReviewCheckpointId: queuedCheckpointId,
    factualReviewCheckpointFingerprint: queuedCheckpointFingerprint,
    factualReviewState: "approved",
    factualReviewResumeState: "pending",
    factualReviewApprovalFingerprint: queuedApprovalFingerprint,
    factualReviewResumeAttempts: 0,
  }, queuedRunId);

  const firstQueuedAt = Date.now() - RUN_QUEUE_LEASE_MS - 1;
  await invoke(markResumeQueued, ctx, {
    ownerId,
    channelId,
    runId: queuedRunId,
    checkpointId: queuedCheckpointId,
    checkpointFingerprint: queuedCheckpointFingerprint,
    approvalFingerprint: queuedApprovalFingerprint,
    triggerRunId: "trigger:first-accepted-never-started",
    queuedAt: firstQueuedAt,
  });
  const firstQueued = await db.get(queuedRunId);
  assert.equal(firstQueued?.factualReviewResumeState, "queued");
  assert.equal(firstQueued?.factualReviewResumeAttempts, 1);
  assert.equal(
    firstQueued?.factualReviewResumeQueueDeadlineAt,
    firstQueuedAt + RUN_QUEUE_LEASE_MS,
    "accepted delivery carries a bounded queue deadline",
  );
  const firstQueueRecovery = await invoke<{ requeued: number; blocked: number }>(
    reapExpiredQueuedResumes,
    ctx,
    { ownerId, now: Date.now(), limit: 10 },
  );
  assert.deepEqual(firstQueueRecovery, { checked: 1, requeued: 1, blocked: 0 });
  const reissued = await db.get(queuedRunId);
  assert.equal(reissued?.status, "awaiting_factual_review");
  assert.equal(reissued?.factualReviewState, "approved");
  assert.equal(reissued?.factualReviewResumeState, "pending");
  assert.equal(reissued?.factualReviewResumeAttempts, 1, "reissuing preserves accepted-delivery count");
  const reissuedOutbox = await invoke<Array<Record<string, unknown>>>(listPendingResumes, ctx, {
    ownerId,
    limit: 10,
  });
  const reissuedReceipt = reissuedOutbox.find((row) => row.runId === queuedRunId);
  assert.deepEqual(
    {
      checkpointId: reissuedReceipt?.checkpointId,
      checkpointFingerprint: reissuedReceipt?.checkpointFingerprint,
      approvalFingerprint: reissuedReceipt?.approvalFingerprint,
      invocationSha256: reissuedReceipt?.invocationSha256,
      attempt: reissuedReceipt?.attempt,
    },
    {
      checkpointId: queuedCheckpointId,
      checkpointFingerprint: queuedCheckpointFingerprint,
      approvalFingerprint: queuedApprovalFingerprint,
      invocationSha256: queuedInvocationSha256,
      attempt: 1,
    },
    "queue recovery reissues the exact frozen approval envelope without a new factual revision",
  );

  const secondQueuedAt = Date.now() - RUN_QUEUE_LEASE_MS - 1;
  await invoke(markResumeQueued, ctx, {
    ownerId,
    channelId,
    runId: queuedRunId,
    checkpointId: queuedCheckpointId,
    checkpointFingerprint: queuedCheckpointFingerprint,
    approvalFingerprint: queuedApprovalFingerprint,
    triggerRunId: "trigger:second-accepted-never-started",
    queuedAt: secondQueuedAt,
  });
  const exhaustedQueueRecovery = await invoke<{ requeued: number; blocked: number }>(
    reapExpiredQueuedResumes,
    ctx,
    { ownerId, now: Date.now(), limit: 10 },
  );
  assert.deepEqual(exhaustedQueueRecovery, { checked: 1, requeued: 0, blocked: 1 });
  const queueBlocked = await db.get(queuedRunId);
  assert.equal(queueBlocked?.status, "factual_review_blocked");
  assert.equal(queueBlocked?.factualReviewState, "blocked");
  assert.equal(queueBlocked?.factualReviewResumeState, "blocked");
  assert.equal((await db.get(queuedCheckpointId))?.decision, "blocked");
  assert.equal(
    db.rows("runArtifacts").length,
    artifactCountBefore + queuedArtifacts.length,
    "queue recovery never creates a duplicate factual or narration artifact",
  );

  console.log("factual review lease recovery: ok");
}

void main();
