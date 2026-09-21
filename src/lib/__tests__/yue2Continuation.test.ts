import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getFunctionName } from "convex/server";
import ts from "typescript";
import * as continuations from "../../../convex/yue2Continuations";
import * as auditions from "../../../convex/yue2Auditions";
import { claimExecutionLease } from "../../../convex/runs";
import { api } from "../../../convex/_generated/api";
import { pipelineInvocationSha256 } from "@/lib/pipelineInvocationHash";
import type { PipelineInvocationSnapshot } from "@/lib/pipelineInvocationSnapshot";
import * as deployment from "@/lib/pipelineWorkerDeployment";
import { YUE2_AUDITION_CHECKS } from "@/engine/yue2Audition";

type Row = Record<string, unknown>;
const material = JSON.parse(readFileSync("test-fixtures/music-composer/seaside-after/gpu-material.json", "utf8"));
const arrangement = material.request.acceptedArrangement;
const { ownerId, channelId, runId } = arrangement;
const scope = { ownerId, channelId, runId };
const candidate = { version: "shared-yue2-music-candidate/v1", ...scope,
  arrangementFingerprint: arrangement.fingerprint, jobId: material.candidate.jobId,
  candidateSha256: material.candidateSha256, candidateKey: `owner/${ownerId}/runs/${runId}/music/yue2-evaluation/candidate.json`,
  listeningAudioKey: material.listeningAudioKey, listeningAudioSha256: material.candidate.headroom.audioSha256,
  nativeFrames: material.candidate.nativeOutput.frames, sampleRateHz: 48000, channels: 2, technicalStatus: "needs_audition",
  allocatedCostUsdMicros: 4208, costBasis: "supervised_dispatch_wall_time", providerBilledCostUsdMicros: null, productionApproved: false };

function fixture() {
  const snapshot: PipelineInvocationSnapshot = { version: 1, ...scope, source: "channel",
    entries: [{ block: "music_arrangement_plan" }, { block: "music", version: "3.0.0-yue2-candidate" }],
    seedStore: {}, budgetUsd: 1, keyPrefix: `owner/${ownerId}/`, remoteBlocks: [], defaultRetries: 0,
    compilationFingerprint: "a".repeat(64), compilationPolicyId: "production-contract", compilationPolicyVersion: "2",
    compilationModules: [{ id: "music_arrangement_plan", version: "1.0.0" }, { id: "music", version: "3.0.0-yue2-candidate" }],
    compilationCapabilities: [], reservedMaxCostUsd: 1,
    workerDeployment: { projectId: "proj_original", environmentId: "env_original", version: "20260921.1" } };
  const run: Row = { _id: runId, ownerId, channelId, status: "running", leaseOwner: "worker-original",
    executionAttempts: 1, leaseExpiresAt: Date.now() + 60000, pipelineInvocationSnapshot: snapshot,
    pipelineInvocationSha256: pipelineInvocationSha256(snapshot) };
  const tables: Record<string, Row[]> = { runs: [run], channels: [{ _id: channelId, ownerId }],
    runStages: [{ _id: "stage-music", runId, block: "music", status: "ok", outputs: { yue2MusicCandidate: structuredClone(candidate) } },
      { _id: "stage-arrangement", runId, block: "music_arrangement_plan", status: "ok", outputs: { acceptedMusicArrangement: structuredClone(arrangement) } }],
    yue2Continuations: [], yue2Auditions: [] };
  let authorized = true;
  const db = {
    normalizeId: (_table: string, id: string) => id,
    get: async (id: string) => Object.values(tables).flat().find(row => row._id === id) ?? null,
    insert: async (table: string, value: Row) => { const id = `${table}-${tables[table].length}`; tables[table].push({ _id: id, ...structuredClone(value) }); return id; },
    patch: async (id: string, patch: Row) => { const row = await db.get(id); assert.ok(row); Object.assign(row, structuredClone(patch)); },
    query: (table: string) => {
      let rows = [...(tables[table] ?? [])];
      const range = {
        eq: (key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return range; },
        lte: (key: string, value: number) => { rows = rows.filter(row => row[key] === undefined || Number(row[key]) <= value); return range; },
      };
      const query = { withIndex: (_name: string, build: (r: typeof range) => unknown) => { build(range); return query; },
        order: (direction: string) => { if (direction === "desc") rows.reverse(); return query; },
        first: async () => rows[0] ?? null, take: async (limit: number) => rows.slice(0, limit), collect: async () => rows };
      return query;
    },
  };
  const ctx = { db, auth: { getUserIdentity: async () => authorized ? { subject: "service:youtube-studio-ai", role: "service", owner_id: ownerId } : null } };
  const call = async <T = Row>(definition: unknown, args: Row = {}): Promise<T> => {
    const before = structuredClone(tables);
    try { return await (definition as { _handler: (ctx: unknown, args: unknown) => Promise<T> })._handler(ctx, { ...scope, ...args }); }
    catch (error) {
      // Convex mutations roll back on throw; keep the same run reference.
      for (const key of Object.keys(run)) delete run[key]; Object.assign(run, before.runs[0]);
      Object.assign(tables, before); tables.runs = [run]; throw error;
    }
  };
  const park = () => call(continuations.createAwaiting, { invocationSha256: run.pipelineInvocationSha256, leaseOwner: run.leaseOwner, executionLeaseToken: run.executionAttempts });
  const review = (verdict = "approved_for_assembly", candidateSha256 = candidate.candidateSha256) => call(auditions.record, {
    candidateSha256, submission: { candidateSha256, verdict, listenedEntireSource: true,
      checks: Object.fromEntries(YUE2_AUDITION_CHECKS.map(key => [key, "pass"])),
      sections: arrangement.arrangement.sections.map((section: { id: string }) => ({ id: section.id, judgment: "pass", notes: "Synthetic approval; not a real owner's listening decision." })),
      notes: "Synthetic continuation test, never approval of this retained track." },
    ...(verdict === "approved_for_assembly" ? { sourceBasis: tables.yue2Continuations[0].basis } : {}),
  });
  const pending = () => call<Row[]>(continuations.prepareDispatch);
  const claim = (resume?: unknown, leaseOwner = "worker-resumed") => call(claimExecutionLease, { leaseOwner, now: Date.now(), ...(resume ? { yue2AuditionResume: resume } : {}) });
  return { run, tables, call, park, review, pending, claim, forbid: () => { authorized = false; } };
}

test("real handlers pause, atomically approve, dispatch, claim, and recover without mutating completed source stages", async () => {
  const f = fixture(), stages = structuredClone(f.tables.runStages);
  await f.park(); assert.equal(f.run.status, "awaiting_music_audition"); assert.equal(f.run.leaseOwner, undefined);
  assert.deepEqual(await f.pending(), []); assert.equal((await f.claim()).kind, "music_audition_awaiting");
  await f.review("promising"); assert.deepEqual(await f.pending(), []);
  const approved = await f.review(); const [delivery] = await f.pending();
  assert.ok(delivery); assert.equal(delivery.approvalFingerprint, undefined);
  assert.equal((delivery.yue2AuditionResume as Row).approvalFingerprint, approved.sourceApprovalFingerprint);
  assert.deepEqual(delivery.workerDeployment, (f.run.pipelineInvocationSnapshot as PipelineInvocationSnapshot).workerDeployment);
  await f.review(); assert.deepEqual(await f.pending(), [delivery], "approval retries preserve delivery identity");
  await f.call(continuations.recordDispatch, { resume: delivery.yue2AuditionResume, attempt: 1, triggerRunId: "trigger-1" });
  assert.equal(f.tables.yue2Continuations[0].state, "queued");
  assert.equal((await f.claim(delivery.yue2AuditionResume)).kind, "claimed");
  assert.equal(f.run.executionAttempts, 2); assert.equal(f.tables.yue2Continuations[0].state, "consumed");
  await assert.rejects(f.claim(delivery.yue2AuditionResume, "competing-worker"), /another live worker/);
  assert.equal((await f.claim(undefined)).kind, "claimed", "same worker recovery revalidates consumed source without a new audition envelope");
  assert.deepEqual(f.tables.runStages, stages); assert.deepEqual(await f.pending(), []);
  await f.review("rejected"); assert.equal((await f.claim(undefined)).kind, "music_audition_ineligible");
});

test("pending decisions revoke atomically, stale envelopes cannot destroy replacement approval, other candidates stay isolated", async () => {
  const f = fixture(); await f.park(); await f.review(); const [first] = await f.pending();
  await f.review("rejected", "f".repeat(64)); assert.deepEqual(await f.pending(), [first]);
  await f.review("needs_work"); assert.equal(f.tables.yue2Continuations[0].state, "awaiting");
  assert.equal((await f.claim(first.yue2AuditionResume)).kind, "music_audition_ineligible");
  await f.review(); const [second] = await f.pending();
  assert.notDeepEqual(second.yue2AuditionResume, first.yue2AuditionResume);
  assert.equal((await f.claim(first.yue2AuditionResume)).kind, "music_audition_ineligible");
  assert.equal(f.tables.yue2Continuations[0].state, "pending");
  assert.equal((await f.claim(second.yue2AuditionResume)).kind, "claimed");
  await f.call(continuations.recordDispatch, { resume: second.yue2AuditionResume, attempt: 1, triggerRunId: "ack-after-claim" });
  assert.equal(f.tables.yue2Continuations[0].state, "consumed");
});

test("queued loss and enqueue failures are bounded at two deliveries of the same source", async () => {
  for (const accepted of [true, false]) {
    const f = fixture(); await f.park(); await f.review();
    for (const attempt of [1, 2]) {
      const [delivery] = await f.pending(); assert.equal(delivery.attempt, attempt);
      await f.call(continuations.recordDispatch, { resume: delivery.yue2AuditionResume, attempt,
        ...(accepted ? { triggerRunId: `delivery-${attempt}` } : {}) });
      if (accepted) {
        f.tables.yue2Continuations[0].queueDeadlineAt = Date.now() - 1;
        assert.equal((await f.claim(delivery.yue2AuditionResume)).kind, "music_audition_ineligible");
      }
    }
    assert.deepEqual(await f.pending(), []); assert.equal(f.tables.yue2Continuations[0].state, "blocked");
  }
});

test("ownership, execution fences, frozen invocation, and retained source corruption fail closed", async () => {
  const forbidden = fixture(); forbidden.forbid(); await assert.rejects(forbidden.park());
  for (const corrupt of [
    (f: ReturnType<typeof fixture>) => { f.run.executionAttempts = 2; },
    (f: ReturnType<typeof fixture>) => { f.run.pipelineInvocationSha256 = "f".repeat(64); },
    (f: ReturnType<typeof fixture>) => { f.tables.channels[0].ownerId = "foreign"; },
  ]) {
    const f = fixture(); corrupt(f);
    await assert.rejects(f.call(continuations.createAwaiting, { invocationSha256: f.run.pipelineInvocationSha256, leaseOwner: "worker-original", executionLeaseToken: 1 }));
    assert.equal(f.tables.yue2Continuations.length, 0);
  }
  for (const corrupt of [
    (f: ReturnType<typeof fixture>) => { f.tables.runStages[0].outputs = { yue2MusicCandidate: { ...candidate, nativeFrames: 10 } }; },
    (f: ReturnType<typeof fixture>) => { f.tables.runStages[0].status = "failed"; },
    (f: ReturnType<typeof fixture>) => { f.tables.yue2Continuations[0].fingerprint = "e".repeat(64); },
    (f: ReturnType<typeof fixture>) => { (f.tables.yue2Auditions[0].submission as Row).notes = "tampered decision"; },
  ]) {
    const f = fixture(); await f.park(); await f.review(); const [receipt] = await f.pending(); corrupt(f);
    assert.equal((await f.claim(receipt.yue2AuditionResume)).kind, "music_audition_ineligible");
    assert.deepEqual(await f.pending(), []); assert.equal(f.tables.yue2Continuations[0].state, "blocked");
  }
});

test("actual dispatcher preserves worker binding and idempotency through a lost acknowledgement", async () => {
  const f = fixture(); await f.park(); await f.review();
  const deliveries: { payload: Row; options: Row }[] = [];
  let loseAck = true;
  const compiled = ts.transpileModule(readFileSync("src/trigger/yue2ContinuationDispatcher.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} as { dispatchPendingYuE2Continuations: (input: unknown) => Promise<unknown> } };
  new Function("require", "module", "exports", compiled)((name: string) => {
    if (name === "@trigger.dev/sdk") return { idempotencyKeys: { create: async (seed: string, options: Row) => { assert.equal(options.scope, "global"); return seed; } },
      tasks: { trigger: async (id: string, payload: Row, options: Row) => { assert.equal(id, "run-pipeline"); deliveries.push({ payload, options }); return { id: "trigger-fixture" }; } } };
    if (name.endsWith("/_generated/api")) return { api };
    if (name.endsWith("/pipelineWorkerDeployment")) return deployment;
    throw new Error(`Unexpected dependency ${name}`);
  }, loaded, loaded.exports);
  const input = { ownerId, log: () => {}, dispatchContext: { projectId: "proj_original", environmentId: "env_original" },
    convex: { mutation: async (ref: Parameters<typeof getFunctionName>[0], args: Row) => {
      const name = getFunctionName(ref).split(":")[1];
      if (name === "recordDispatch" && loseAck) { loseAck = false; throw new Error("lost acknowledgement"); }
      return f.call(continuations[name as keyof typeof continuations], args);
    } } };
  await assert.rejects(loaded.exports.dispatchPendingYuE2Continuations(input), /lost acknowledgement/);
  await loaded.exports.dispatchPendingYuE2Continuations(input);
  assert.deepEqual(deliveries[0], deliveries[1]); assert.equal(deliveries[0].options.concurrencyKey, channelId);
  assert.equal(deliveries[0].payload.invocationSha256, f.run.pipelineInvocationSha256);
  assert.equal(f.tables.yue2Continuations[0].state, "queued");
});

test("worker wiring parks after persisted music and keeps recovery and self-heal bound to that source", () => {
  const worker = readFileSync("src/trigger/runPipeline.ts", "utf8");
  assert.match(worker, /resumingYuE2 = Boolean\(payload\.yue2AuditionResume \|\| durableRun\.yue2ContinuationId\)/u);
  assert.match(worker, /requiresYuE2AuditionCheckpoint && !resumingYuE2\s*\? \{ stopAfterBlockId: "music" \}/u);
  assert.match(worker, /if \(isYuE2Boundary\) \{\s*await logSink\.flush\(\);\s*const checkpoint = await convex\.mutation\(yue2ContinuationsApi\.createAwaiting/u);
  assert.match(worker, /requiresYuE2AuditionCheckpoint && plan\.rerunBlocks\.some/u);
  const dispatcher = readFileSync("src/trigger/musicAuditionContinuationDispatcher.ts", "utf8");
  assert.match(dispatcher, /await dispatchPendingYuE2Continuations\(\{ ownerId, convex, log, dispatchContext: input\?\.dispatchContext \}\)/u);
});
