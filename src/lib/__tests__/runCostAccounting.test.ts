import assert from "node:assert/strict";
import { knownRunCostFloor, runCostFloor } from "../../../convex/runCostAccounting";
import { completeRun, deferSerializedProgramEpisodeRetry, updateRun } from "../../../convex/runs";
import { completeClaimedPlanRun, failClaimedPlanRun } from "../../../convex/contentPlan";
import { createAwaiting } from "../../../convex/factualReviewCheckpoints";
import { begin, finish } from "../../../convex/remoteChildCosts";
import { listRunStages, upsertRunStage } from "../../../convex/runStages";
import { overview } from "../../../convex/analytics";
import { FACTUAL_REVIEW_REQUIRED_ARTIFACTS } from "@/engine/factualReviewCheckpoint";
import { runPipeline } from "@/engine/runner";
import { manifestFromBlock } from "@/engine/moduleManifest";
import { _clear, registerManifest } from "@/engine/registry";
import { validatePipeline } from "@/engine/validate";
import type { Block, RunStageSink } from "@/engine/types";
import { remoteChildFailureWithEvidence } from "@/lib/remoteChildCostEvidence";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

type Row = Record<string, unknown> & { _id: string };

class MemoryDb {
  private tables = new Map<string, Row[]>();
  readonly reads = new Map<string, number>();
  writes = 0;

  rows(table: string): Row[] { return this.tables.get(table) ?? []; }
  seed(table: string, value: Record<string, unknown>, id = `${table}:${this.rows(table).length}`): Row {
    const row = { ...value, _id: id };
    this.tables.set(table, [...this.rows(table), row]);
    return row;
  }
  row(id: string): Row | undefined { return [...this.tables.values()].flat().find((row) => row._id === id); }
  normalizeId(_table: string, id: string): string | null { return this.row(id) ? id : null; }
  async get(id: string): Promise<Row | null> { return structuredClone(this.row(id) ?? null); }
  async patch(id: string, patch: Record<string, unknown>): Promise<void> {
    const row = this.row(id);
    assert(row, `missing row ${id}`);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete row[key];
      else row[key] = structuredClone(value);
    }
    this.writes++;
  }
  async insert(table: string, patch: Record<string, unknown>): Promise<string> {
    this.writes++;
    return this.seed(table, patch)._id;
  }
  query(table: string) {
    this.reads.set(table, (this.reads.get(table) ?? 0) + 1);
    const filters: Array<[string, unknown]> = [];
    const range = { eq: (key: string, value: unknown) => { filters.push([key, value]); return range; } };
    const rows = () => structuredClone(this.rows(table).filter((row) => filters.every(([key, value]) => row[key] === value)));
    const query = {
      withIndex: (_index: string, build: (q: typeof range) => unknown) => { build(range); return query; },
      order: () => query,
      collect: async () => rows(),
      first: async () => rows()[0] ?? null,
      unique: async () => { assert(rows().length <= 1, "unique query found duplicate rows"); return rows()[0] ?? null; },
      take: async (count: number) => rows().slice(0, count),
    };
    return query;
  }
}

const binding = {
  ownerId: "owner-cost", channelId: "channels:cost", runId: "runs:cost",
  leaseOwner: "parent-cost", executionLeaseToken: 1,
};

function fixture() {
  const db = new MemoryDb();
  const run = db.seed("runs", {
    ownerId: binding.ownerId, channelId: binding.channelId, status: "running", costTotal: 0,
    leaseOwner: binding.leaseOwner, executionAttempts: 1, leaseExpiresAt: Date.now() + 120_000,
    pipelineInvocationSnapshot: {}, pipelineInvocationSha256: "a".repeat(64),
    planItemId: "contentPlan:cost", plannedTopic: "A real topic", plannedTitle: "A real title",
    plannedThumbnailKey: "owner/test/thumbnail.png", plannedThumbnailSource: "planner_artwork",
  }, binding.runId);
  db.seed("channels", { ownerId: binding.ownerId }, binding.channelId);
  const item = db.seed("contentPlan", {
    ownerId: binding.ownerId, channelId: binding.channelId, status: "ready", scheduledRunId: binding.runId,
    topic: run.plannedTopic, title: run.plannedTitle, thumbnailKey: run.plannedThumbnailKey,
    thumbnailSource: "planner_artwork",
  }, "contentPlan:cost");
  let role = "service";
  const ctx = {
    db,
    auth: { getUserIdentity: async () => ({ subject: "service-cost", role, owner_id: binding.ownerId }) },
  };
  const invoke = <T = unknown>(definition: unknown, args: unknown): Promise<T> =>
    (definition as { _handler: (context: unknown, input: unknown) => Promise<T> })._handler(ctx, args);
  const stage = (block: string, cost: number | undefined, status = "ok", extra: Record<string, unknown> = {}) =>
    db.seed("runStages", { ownerId: binding.ownerId, runId: binding.runId, block, cost, status, ...extra });
  return { db, run, item, ctx, invoke, stage, setRole: (value: string) => { role = value; } };
}

async function arithmeticAndIntegrity() {
  const rows = [
    { block: "first", cost: 0.3, status: "ok" },
    { block: "second", cost: 0.2, status: "failed", costBeforeExecution: 0.1,
      remoteChildCostAttempts: [{ costUsd: 0.2 }], checkpointCostReceipts: [{ costUsd: 0.2 }] },
    { block: "third", cost: 0.2, status: "superseded" },
    { block: "legacy", status: "queued" },
  ];
  assert.equal(knownRunCostFloor(0, 0, rows), 0.7, "all stage statuses count once, not their constituent receipts/baseline");
  assert.equal(knownRunCostFloor(0.9, 0, rows), 0.9, "prior non-stage/historical cost is not refunded");
  assert.equal(knownRunCostFloor(0.9, 1.1, rows), 1.1, "higher authoritative caller amount survives without double addition");
  assert.equal(knownRunCostFloor(0.9, undefined, []), 0.9, "stage removal cannot reduce the known run floor");
  for (const value of [-1, NaN, Infinity, -Infinity, null, "0"]) {
    assert.throws(() => knownRunCostFloor(value as number, 0, []), /finite and non-negative/);
    assert.throws(() => knownRunCostFloor(0, value as number, []), /finite and non-negative/);
    assert.throws(() => knownRunCostFloor(0, 0, [{ block: "bad", cost: value as number }]), /finite and non-negative/);
  }
  assert.throws(() => knownRunCostFloor(0, 0, [{ block: "x", cost: Number.MAX_VALUE }, { block: "y", cost: Number.MAX_VALUE }]), /stage total/);
  assert.throws(() => knownRunCostFloor(0, 0, [{ block: "same", cost: 0.2 }, { block: "same", cost: 0.2 }]), /duplicate stage/);
  for (const block of ["", " x", null]) {
    assert.throws(() => knownRunCostFloor(0, 0, [{ block: block as string, cost: 0 }]), /identity/);
  }
  const f = fixture();
  const preloaded = [f.stage("paid", 0.5)];
  assert.equal(await runCostFloor(f.ctx as never, f.run as never, 0, preloaded as never), 0.5);
  assert.equal(f.db.reads.get("runStages"), undefined, "preloaded costs need no extra query");
  for (const mismatch of [{ ownerId: "another-owner" }, { runId: "runs:another" }]) {
    await assert.rejects(runCostFloor(f.ctx as never, f.run as never, 0, [{ ...preloaded[0], ...mismatch }] as never), /ownership\/run mismatch/);
  }
}

async function terminalHandlersAndReplay() {
  const handlers = [
    { name: "updateRun", definition: updateRun, args: () => ({ runId: binding.runId, leaseOwner: binding.leaseOwner, executionLeaseToken: 1, status: "failed", costTotal: 0 }) },
    { name: "updateRun without caller cost", definition: updateRun, args: () => ({ runId: binding.runId, leaseOwner: binding.leaseOwner, executionLeaseToken: 1, status: "canceled" }) },
    { name: "completeRun", definition: completeRun, args: () => ({ ...binding, finishedAt: Date.now(), costTotal: 0 }) },
    { name: "serialized deferral", definition: deferSerializedProgramEpisodeRetry, args: () => ({ ...binding, retryAt: Date.now() + 30_000, costTotal: 0, error: "episode busy" }) },
    { name: "scheduled failure", definition: failClaimedPlanRun, args: () => ({ ...binding, itemId: "contentPlan:cost", failedAt: Date.now(), costTotal: 0, error: "failed" }) },
    { name: "scheduled failure without caller cost", definition: failClaimedPlanRun, args: () => ({ ...binding, itemId: "contentPlan:cost", failedAt: Date.now(), error: "failed" }) },
    { name: "scheduled completion", definition: completeClaimedPlanRun, args: () => ({ ...binding, itemId: "contentPlan:cost", finishedAt: Date.now(), costTotal: 0 }) },
  ];
  for (const handler of handlers) {
    const f = fixture();
    f.stage("first", 0.3);
    f.stage("prior-repair", 0.2, "superseded");
    await f.invoke(handler.definition, handler.args());
    assert.equal(f.run.costTotal, 0.5, handler.name);
    assert.equal(f.db.reads.get("runStages"), 1, `${handler.name} uses one indexed stage query`);
    const analytics = await f.invoke<{ totalCost: number }>(overview, { ownerId: binding.ownerId });
    assert.equal(analytics.totalCost, 0.5, `${handler.name} updates actual analytics projection`);
  }
  const f = fixture();
  f.stage("final", 0.5);
  const args = { ...binding, itemId: f.item._id, finishedAt: Date.now(), costTotal: 0 };
  assert.deepEqual(await f.invoke(completeClaimedPlanRun, args), { state: "used", reused: false });
  assert.equal(f.run.scheduledCompletionCallerCostTotal, 0);
  const writes = f.db.writes;
  assert.deepEqual(await f.invoke(completeClaimedPlanRun, { ...args, finishedAt: args.finishedAt + 1 }), { state: "used", reused: true });
  assert.equal(f.db.writes, writes, "lost-response replay returns without changing rows or topic memory");
  for (const costTotal of [0.2, 0.6]) {
    await assert.rejects(f.invoke(completeClaimedPlanRun, { ...args, costTotal }), /replay mismatch/);
    assert.equal(f.db.writes, writes, "changed replay must not alter any receipt");
  }
  delete f.run.scheduledCompletionCallerCostTotal;
  await assert.rejects(f.invoke(completeClaimedPlanRun, args), /replay mismatch/, "legacy rows retain the old direct-cost replay contract");
  assert.deepEqual(await f.invoke(completeClaimedPlanRun, { ...args, costTotal: 0.5 }), { state: "used", reused: true });
  assert.equal(f.db.writes, writes);
  for (const invalidReceipt of [null, NaN, Infinity, -1]) {
    f.run.scheduledCompletionCallerCostTotal = invalidReceipt;
    await assert.rejects(f.invoke(completeClaimedPlanRun, { ...args, costTotal: 0.2 }), /caller cost receipt is invalid/);
    assert.equal(f.db.writes, writes, "malformed receipt never becomes an implicit legacy replay");
  }

  const imported = fixture();
  imported.run.costTotal = 0.9;
  await imported.invoke(updateRun, { runId: binding.runId, leaseOwner: binding.leaseOwner, executionLeaseToken: 1, status: "failed", costTotal: 0 });
  assert.equal(imported.run.costTotal, 0.9, "no-stage imported cost survives");

  const hot = fixture();
  await hot.invoke(updateRun, { runId: binding.runId, leaseOwner: binding.leaseOwner, executionLeaseToken: 1, pipelineFingerprint: "metadata-only" });
  await hot.invoke(updateRun, { runId: binding.runId, leaseOwner: binding.leaseOwner, executionLeaseToken: 1, status: "running" });
  assert.equal(hot.db.reads.get("runStages"), undefined, "metadata/liveness updates must not add stage scans");
  hot.stage("paid", 0.5);
  await hot.invoke(updateRun, { runId: binding.runId, leaseOwner: binding.leaseOwner, executionLeaseToken: 1, costTotal: 0 });
  assert.equal(hot.run.costTotal, 0.5, "nonterminal explicit cost update is also floored");
}

async function authorizationAndInvalidAccounting() {
  for (const failure of ["lease", "owner", "channel", "service", "plan", "stage", "publish", "invalid", "duplicate"] as const) {
    const f = fixture();
    const stage = f.stage("final", 0.5);
    const args = { ...binding, itemId: f.item._id, finishedAt: Date.now(), costTotal: 0 };
    if (failure === "lease") args.executionLeaseToken = 2;
    if (failure === "owner") args.ownerId = "other-owner";
    if (failure === "channel") f.run.channelId = "channels:other";
    if (failure === "service") f.setRole("viewer");
    if (failure === "plan") f.item.title = "replaced immutable title";
    if (failure === "stage") stage.status = "failed";
    if (failure === "publish") f.run.blockedPublishIntentId = "publishIntents:unpaired";
    if (failure === "invalid") stage.cost = NaN;
    if (failure === "duplicate") f.stage("final", 0.5);
    await assert.rejects(f.invoke(completeClaimedPlanRun, args), (error) => error instanceof Error, failure);
    assert.equal(f.db.writes, 0, `${failure} rejects before changing any row`);
  }
  for (const costTotal of [-1, Infinity, NaN]) {
    const f = fixture();
    await assert.rejects(f.invoke(updateRun, { runId: binding.runId, leaseOwner: binding.leaseOwner, executionLeaseToken: 1, costTotal }), /finite and non-negative/);
    assert.equal(f.db.writes, 0);
  }
}

async function realEngineRemoteOutage() {
  _clear();
  const f = fixture();
  const child = { ...binding, blockId: "rollup_remote", dispatchKey: "dispatch-cost", taskRunId: "child-cost", attemptNumber: 1 };
  Object.assign(f.run, {
    remoteChildWaitLeaseOwner: binding.leaseOwner, remoteChildWaitExecutionLeaseToken: 1,
    remoteChildWaitBlockId: child.blockId, remoteChildWaitDispatchKey: child.dispatchKey,
    remoteChildWaitUntil: Date.now() + 120_000,
  });
  const stage = f.stage(child.blockId, 0, "queued");
  const block: Block = { id: child.blockId, consumes: [], produces: ["image"], paid: true,
    run: async () => { throw new Error("remote work cannot execute locally"); } };
  registerManifest(manifestFromBlock(block, { capabilities: [], maxCostUsd: 0.5 }));
  const resolved = validatePipeline([{ block: block.id }]);
  const sink: RunStageSink = {
    upsert: async (args) => { await f.invoke(upsertRunStage, { ...args, leaseOwner: binding.leaseOwner, executionLeaseToken: 1 }); },
    getResumeState: async () => f.invoke(listRunStages, { runId: binding.runId }),
  };
  let dispatches = 0;
  const opts = { ...binding, keyPrefix: "owners/test/", budgetUsd: 1, defaultRetries: 0, sink,
    remoteBlocks: new Set([block.id]),
    runRemoteBlock: async () => {
      dispatches++;
      await f.invoke(begin, child);
      await f.invoke(finish, { ...child, status: "failed", costUsd: 0.5, complete: true, checkpointCostReceipts: [] });
      throw remoteChildFailureWithEvidence("getForDispatch unavailable after a committed child charge");
    },
  };
  const result = await runPipeline(resolved, opts);
  assert.equal(result.ok, false);
  assert.equal(result.costTotal, 0, "this slice deliberately does not change the worker result contract");
  assert.equal(stage.cost, 0.5);
  await f.invoke(updateRun, { runId: binding.runId, leaseOwner: binding.leaseOwner, executionLeaseToken: 1,
    status: "failed", finishedAt: Date.now(), costTotal: result.costTotal, error: result.error });
  assert.equal(f.run.costTotal, 0.5, "actual terminal mutation reads the durable child charge independently");
  assert.equal((await f.invoke<{ totalCost: number }>(overview, { ownerId: binding.ownerId })).totalCost, 0.5);
  Object.assign(f.run, { status: "running", leaseOwner: binding.leaseOwner, leaseExpiresAt: Date.now() + 120_000 });
  const resumed = await runPipeline(resolved, opts);
  assert.equal(resumed.costTotal, 0.5);
  assert.match(resumed.error ?? "", /PAID_STAGE_RECONCILIATION_REQUIRED/);
  assert.equal(dispatches, 1, "correcting the projection never purchases another provider attempt");

  // The opposite serial ordering: a terminal parent clears the fence first,
  // so a later child receipt must not regain authority. Real concurrent OCC
  // retries are a Convex runtime property, not claimed by this memory fixture.
  const stopped = fixture();
  Object.assign(stopped.run, {
    remoteChildWaitLeaseOwner: binding.leaseOwner, remoteChildWaitExecutionLeaseToken: 1,
    remoteChildWaitBlockId: child.blockId, remoteChildWaitDispatchKey: child.dispatchKey,
    remoteChildWaitUntil: Date.now() + 120_000,
  });
  stopped.stage(child.blockId, 0, "running");
  await stopped.invoke(begin, child);
  await stopped.invoke(updateRun, { runId: binding.runId, leaseOwner: binding.leaseOwner, executionLeaseToken: 1, status: "failed", costTotal: 0 });
  await assert.rejects(stopped.invoke(finish, { ...child, status: "failed", costUsd: 0.5, complete: true, checkpointCostReceipts: [] }), /active lease/);
}

function factualFixture() {
  const f = fixture();
  const fp = (value: string) => sha256Hex(value);
  const packId = "reviewedEvidencePacks:cost";
  const ledger = { version: "data-story-source-ledger/v1", rows: [{ source: "https://example.test/source", claim: "A reviewed fact" }] };
  const fingerprints = {
    contentFingerprint: fp("content"), authorityContentFingerprint: fp("authority"),
    routeSeedFingerprint: fp("route"), topicFingerprint: fp("topic"), showProfileFingerprint: fp("profile"),
  };
  f.run.pipelineInvocationSnapshot = {
    showProfileFingerprint: fingerprints.showProfileFingerprint,
    seedStore: {
      dataStorySourceLedger: ledger,
      reviewedEvidencePackRunAdmission: { ...fingerprints, version: "reviewed-evidence-pack-run-admission/v1",
        authorityKind: "data_story_source_ledger", selectedCapabilityKeys: ["source_attributed_data_story"],
        selector: { packId, contentFingerprint: fingerprints.contentFingerprint } },
      reviewedEvidencePack: { ...fingerprints, sourceAuthority: { kind: "data_story_source_ledger", dataStorySourceLedger: ledger } },
    },
  };
  f.db.seed("reviewedEvidencePacks", { ownerId: binding.ownerId, ...fingerprints,
    authorityKind: "data_story_source_ledger", selectedCapabilityKeys: ["source_attributed_data_story"],
    pack: { sourceAuthority: { kind: "data_story_source_ledger", dataStorySourceLedger: ledger } } }, packId);
  const outputsByModule = new Map<string, Record<string, unknown>>();
  for (const requirement of FACTUAL_REVIEW_REQUIRED_ARTIFACTS) {
    const outputs = outputsByModule.get(requirement.producerModule) ?? {};
    outputs[requirement.key] = `retained:${requirement.key}`;
    outputsByModule.set(requirement.producerModule, outputs);
    f.db.seed("runArtifacts", {
      ownerId: binding.ownerId, runId: binding.runId, key: requirement.key,
      artifactId: `artifact:${requirement.key}`, payloadHash: fp(canonicalJson(outputs[requirement.key])),
      producerModule: requirement.producerModule, producerVersion: "test-v1", schemaVersion: "test/v1", createdAt: 1,
    });
  }
  for (const [block, outputs] of outputsByModule) f.stage(block, block === "narration_tts" ? 0.3 : 0, "ok", { outputs });
  f.stage("discarded-prior-attempt", 0.2, "superseded");
  return f;
}

async function factualReviewBoundary() {
  const f = factualFixture();
  const args = { ...binding, invocationSha256: "a".repeat(64), costTotal: 0, now: Date.now() };
  const first = await f.invoke<{ kind: string; reused: boolean }>(createAwaiting, args);
  assert.equal(first.kind, "awaiting");
  assert.equal(first.reused, false);
  assert.equal(f.run.costTotal, 0.5, "factual review includes non-required and superseded stage charges");
  assert.equal(f.db.reads.get("runStages"), 1, "reuse the existing artifact binding stage read");
  Object.assign(f.run, { status: "running", leaseOwner: binding.leaseOwner, leaseExpiresAt: Date.now() + 120_000 });
  const replay = await f.invoke<{ kind: string; reused: boolean }>(createAwaiting, args);
  assert.equal(replay.kind, "awaiting");
  assert.equal(replay.reused, true);
  assert.equal(f.run.costTotal, 0.5);
  assert.equal(f.db.reads.get("runStages"), 2, "one existing stage query per valid boundary, including replay");

  const invalid = factualFixture();
  invalid.stage("discarded-prior-attempt", 0.2, "superseded");
  await assert.rejects(invalid.invoke(createAwaiting, args), /duplicate stage/);
  assert.equal(invalid.db.writes, 0, "ambiguous duplicate accounting cannot create a checkpoint");
  const blocked = factualFixture();
  blocked.run.costTotal = NaN;
  const result = await blocked.invoke<{ kind: string }>(createAwaiting, { ...args, invocationSha256: "b".repeat(64) });
  assert.equal(result.kind, "blocked", "source/invocation safety blocking is unchanged even without a cost rollup");
  assert.equal(blocked.run.status, "factual_review_blocked");
  const alteredReplay = factualFixture();
  alteredReplay.run.costTotal = NaN;
  alteredReplay.db.seed("factualReviewCheckpoints", {
    ownerId: binding.ownerId, runId: binding.runId, decision: "awaiting", checkpointFingerprint: "bad-fingerprint",
  });
  const alteredResult = await alteredReplay.invoke<{ kind: string }>(createAwaiting, args);
  assert.equal(alteredResult.kind, "blocked", "immutable replay blocking takes precedence over malformed accounting");
  assert.equal(alteredReplay.run.status, "factual_review_blocked");
}

async function main() {
  await arithmeticAndIntegrity();
  await terminalHandlersAndReplay();
  await authorizationAndInvalidAccounting();
  await realEngineRemoteOutage();
  await factualReviewBoundary();
  console.log("RUN COST ACCOUNTING PASS — actual engine/child outage, terminal analytics, original-cost replay, factual boundary, all-status floors, integrity/fence rejection and query counts");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
