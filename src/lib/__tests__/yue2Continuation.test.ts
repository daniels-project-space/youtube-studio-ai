import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getFunctionName } from "convex/server";
import ts from "typescript";
import * as continuations from "../../../convex/yue2Continuations";
import * as auditions from "../../../convex/yue2Auditions";
import { prepareResumeDispatch } from "../../../convex/musicAuditionCheckpoints";
import { claimExecutionLease } from "../../../convex/runs";
import { api } from "../../../convex/_generated/api";
import { pipelineInvocationSha256 } from "@/lib/pipelineInvocationHash";
import type { PipelineInvocationSnapshot } from "@/lib/pipelineInvocationSnapshot";
import * as deployment from "@/lib/pipelineWorkerDeployment";
import { YUE2_AUDITION_CHECKS } from "@/engine/yue2Audition";
import { verifyCurrentYuE2ReleaseSource } from "@/lib/yue2ReleaseSource";
import type { YuE2ContinuationReceipt } from "../../trigger/yue2ContinuationDispatcher";

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
  const queriedTables: string[] = [];
  const db = {
    normalizeId: (_table: string, id: string) => id,
    get: async (id: string) => Object.values(tables).flat().find(row => row._id === id) ?? null,
    insert: async (table: string, value: Row) => { const id = `${table}-${tables[table].length}`; tables[table].push({ _id: id, ...structuredClone(value) }); return id; },
    patch: async (id: string, patch: Row) => { const row = await db.get(id); assert.ok(row); Object.assign(row, structuredClone(patch)); },
    query: (table: string) => {
      queriedTables.push(table);
      let rows = [...(tables[table] ?? [])];
      const range = {
        eq: (key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return range; },
        lte: (key: string, value: number) => { rows = rows.filter(row => row[key] === undefined || Number(row[key]) <= value); return range; },
        gt: (key: string, value: number | undefined) => { rows = rows.filter(row => row[key] !== undefined && (value === undefined || Number(row[key]) > value)); return range; },
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
  return { run, tables, queriedTables, call, park, review, pending, claim, forbid: () => { authorized = false; } };
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
  for (const prepared of [false, true]) {
  const f = fixture(); await f.park(); await f.review();
  const deliveries: { payload: Row; options: Row }[] = [];
  let loseAck = true;
  let preparations = 0;
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
    ...(prepared ? { preparedReceipts: await f.pending() } : {}),
    convex: { mutation: async (ref: Parameters<typeof getFunctionName>[0], args: Row) => {
      const name = getFunctionName(ref).split(":")[1];
      if (name === "prepareDispatch") preparations++;
      if (name === "recordDispatch" && loseAck) { loseAck = false; throw new Error("lost acknowledgement"); }
      return f.call(continuations[name as keyof typeof continuations], args);
    } } };
  await assert.rejects(loaded.exports.dispatchPendingYuE2Continuations(input), /recovery failed for 1 of 1 receipts/);
  await loaded.exports.dispatchPendingYuE2Continuations(input);
  assert.deepEqual(deliveries[0], deliveries[1]); assert.equal(deliveries[0].options.concurrencyKey, channelId);
  assert.equal(deliveries[0].payload.invocationSha256, f.run.pipelineInvocationSha256);
  assert.equal(f.tables.yue2Continuations[0].state, "queued");
  assert.equal(preparations, prepared ? 0 : 2, "prepared delivery must not repeat preparation on either acknowledgement attempt");
  }
});

test("accepted Trigger delivery with lost or malformed responses preserves one key and a bounded pending window", async () => {
  for (const response of ["lost", "malformed"] as const) {
  const f = fixture(); await f.park(); await f.review();
  const deliveries: Row[] = [];
  const compiled = ts.transpileModule(readFileSync("src/trigger/yue2ContinuationDispatcher.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} as { dispatchPendingYuE2Continuations: (input: unknown) => Promise<unknown> } };
  new Function("require", "module", "exports", compiled)((name: string) => {
    if (name === "@trigger.dev/sdk") return { idempotencyKeys: { create: async (seed: string) => seed },
      tasks: { trigger: async (_id: string, _payload: Row, options: Row) => {
        deliveries.push(options);
        if (deliveries.length < 3) {
          if (response === "malformed") return { id: "" };
          throw new Error("accepted remotely; response lost");
        }
        return { id: "same-trigger-run" };
      } } };
    if (name.endsWith("/_generated/api")) return { api };
    if (name.endsWith("/pipelineWorkerDeployment")) return deployment;
    throw new Error(`Unexpected dependency ${name}`);
  }, loaded, loaded.exports);
  const input = { ownerId, log: () => {}, dispatchContext: { projectId: "proj_original", environmentId: "env_original" },
    convex: { mutation: (ref: Parameters<typeof getFunctionName>[0], args: Row) =>
      f.call(continuations[getFunctionName(ref).split(":")[1] as keyof typeof continuations], args) } };
  await loaded.exports.dispatchPendingYuE2Continuations(input);
  const deadline = f.tables.yue2Continuations[0].queueDeadlineAt;
  assert.equal(f.tables.yue2Continuations[0].attempts, 0, "uncertain enqueue must not consume a delivery identity");
  assert.ok(Number.isFinite(deadline));
  await loaded.exports.dispatchPendingYuE2Continuations(input);
  assert.equal(f.tables.yue2Continuations[0].queueDeadlineAt, deadline, "retries must not extend the ambiguity window");
  await loaded.exports.dispatchPendingYuE2Continuations(input);
  assert.equal(deliveries.length, 3);
  assert.deepEqual(deliveries[0], deliveries[1]); assert.deepEqual(deliveries[1], deliveries[2]);
  assert.equal(deliveries[0].idempotencyKeyTTL, "24h");
  assert.equal(f.tables.yue2Continuations[0].state, "queued");
  assert.equal(f.tables.yue2Continuations[0].attempts, 1);

  const expired = fixture(); await expired.park(); await expired.review(); const [receipt] = await expired.pending();
  expired.tables.yue2Continuations[0].queueDeadlineAt = Date.now() - 1;
  assert.equal((await expired.claim(receipt.yue2AuditionResume)).kind, "music_audition_ineligible");
  assert.deepEqual(await expired.pending(), []);
  assert.equal(expired.tables.yue2Continuations[0].state, "blocked");
  }
});

test("YuE2 delivery isolates acknowledgement failures without changing attempts or skipping later channels", async () => {
  const f = fixture(); await f.park(); await f.review();
  const [basis] = await f.pending() as unknown as YuE2ContinuationReceipt[];
  const receipts = Array.from({ length: 25 }, (_, index) => ({ ...structuredClone(basis), channelId: `channel-${index}`, runId: `run-${index}` }));
  for (const failure of ["ack", "enqueue-and-ack", "enqueue", "enqueue-rejected", "foreign-worker", "none"]) {
    const deliveries: Row[] = [];
    const acknowledgements: Row[] = [];
    const logs: string[] = [];
    const compiled = ts.transpileModule(readFileSync("src/trigger/yue2ContinuationDispatcher.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const loaded = { exports: {} as { dispatchPendingYuE2Continuations: (input: unknown) => Promise<unknown> } };
    new Function("require", "module", "exports", compiled)((name: string) => {
      if (name === "@trigger.dev/sdk") return {
        idempotencyKeys: { create: async (seed: string, options: Row) => { assert.equal(options.scope, "global"); return seed; } },
        tasks: { trigger: async (id: string, payload: Row, options: Row) => {
          assert.equal(id, "run-pipeline");
          const receipt = receipts.find(value => value.runId === payload.runId)!;
          const { attempt, workerDeployment, ...expected } = receipt;
          assert.deepEqual(payload, expected);
          assert.deepEqual(options, { ...deployment.pipelineWorkerDeploymentDispatchOptions(workerDeployment),
            concurrencyKey: receipt.channelId, idempotencyKeyTTL: "24h", idempotencyKey: ["yue2-audition-resume/v1", receipt.runId,
              receipt.yue2AuditionResume.checkpointId, receipt.yue2AuditionResume.checkpointFingerprint,
              receipt.yue2AuditionResume.approvalFingerprint, receipt.invocationSha256, attempt].join(":") });
          deliveries.push(payload);
          if (payload.runId === "run-0" && failure.startsWith("enqueue")) throw Object.assign(new Error("secret-provider-sentinel"),
            failure === "enqueue-rejected" ? { status: 403 } : {});
          return { id: `trigger-${payload.runId}` };
        } },
      };
      if (name.endsWith("/_generated/api")) return { api };
      if (name.endsWith("/pipelineWorkerDeployment")) return deployment;
      throw new Error(`Unexpected dependency ${name}`);
    }, loaded, loaded.exports);
    const preparedReceipts = structuredClone(receipts);
    if (failure === "foreign-worker") preparedReceipts[0].workerDeployment!.environmentId = "foreign";
    const input = { ownerId, preparedReceipts, log: (message: string) => logs.push(message),
      dispatchContext: { projectId: "proj_original", environmentId: "env_original" },
      convex: { mutation: async (ref: Parameters<typeof getFunctionName>[0], args: Row) => {
        assert.equal(getFunctionName(ref), "yue2Continuations:recordDispatch");
        acknowledgements.push(args);
        if (args.runId === "run-0" && failure.includes("ack")) throw new Error("secret-database-sentinel");
      } } };
    if (failure.includes("ack")) {
      await assert.rejects(loaded.exports.dispatchPendingYuE2Continuations(input), { message: "YuE2 continuation recovery failed for 1 of 25 receipts" });
    } else {
      assert.deepEqual(await loaded.exports.dispatchPendingYuE2Continuations(input), { pending: 25, triggered: failure === "none" ? 25 : 24 });
    }
    assert.equal(deliveries.length, failure === "foreign-worker" ? 24 : 25);
    assert.equal(acknowledgements.length, 25);
    assert.equal(acknowledgements[24].triggerRunId, "trigger-run-24");
    for (const [index, acknowledgement] of acknowledgements.entries()) {
      assert.deepEqual(acknowledgement, { ownerId, channelId: receipts[index].channelId, runId: receipts[index].runId,
        resume: receipts[index].yue2AuditionResume, attempt: receipts[index].attempt,
        ...(index === 0 && failure.startsWith("enqueue") && failure !== "enqueue-rejected" ? { ambiguous: true } : {}),
        ...(index === 0 && (failure.startsWith("enqueue") || failure === "foreign-worker") ? {} : { triggerRunId: `trigger-run-${index}` }) });
    }
    assert.doesNotMatch(logs.join("\n"), /secret-/);
    await assert.rejects(loaded.exports.dispatchPendingYuE2Continuations({ ...input, preparedReceipts: [...receipts, receipts[0]] }), /at most 25/);
    assert.equal(acknowledgements.length, 25, "oversized batches must fail before side effects");
  }
});

test("worker wiring parks after persisted music and keeps recovery and self-heal bound to that source", () => {
  const worker = readFileSync("src/trigger/runPipeline.ts", "utf8");
  assert.match(worker, /resumingYuE2 = Boolean\(payload\.yue2AuditionResume \|\| durableRun\.yue2ContinuationId\)/u);
  assert.match(worker, /requiresYuE2AuditionCheckpoint && !resumingYuE2\s*\? \{ stopAfterBlockId: "music" \}/u);
  assert.match(worker, /if \(isYuE2Boundary\) \{\s*await logSink\.flush\(\);\s*const checkpoint = await convex\.mutation\(yue2ContinuationsApi\.createAwaiting/u);
  assert.match(worker, /requiresYuE2AuditionCheckpoint && plan\.rerunBlocks\.some/u);
  const dispatcher = readFileSync("src/trigger/musicAuditionContinuationDispatcher.ts", "utf8");
  assert.match(dispatcher, /await dispatchPendingYuE2Continuations\(\{ ownerId, convex, log, dispatchContext: input\?\.dispatchContext, preparedReceipts: yue2Pending \}\)/u);
});

test("combined music preparation preserves legacy selection and recovers the exact approved YuE2 receipt", async () => {
  const f = fixture(); await f.park(); await f.review();
  f.queriedTables.length = 0;
  assert.deepEqual(await f.call(prepareResumeDispatch, { now: Date.now() }), { recovery: { requeued: 0, blocked: 0 }, pending: [] });
  assert.ok(!f.queriedTables.includes("yue2Continuations"), "old workers do not acquire new queue behavior");
  const expected = await f.pending();
  const combined = await f.call(prepareResumeDispatch, { now: Date.now(), includeYuE2: true });
  assert.deepEqual(combined, { recovery: { requeued: 0, blocked: 0 }, pending: [], yue2Pending: expected });
  await f.call(continuations.recordDispatch, { resume: expected[0].yue2AuditionResume, attempt: 1, triggerRunId: "lost" });
  f.tables.yue2Continuations[0].queueDeadlineAt = Date.now() - 1;
  const recovered = await f.call(prepareResumeDispatch, { now: Date.now(), includeYuE2: true });
  assert.equal((recovered.yue2Pending as Row[])[0].attempt, 2);
  assert.deepEqual((recovered.yue2Pending as Row[])[0].yue2AuditionResume, expected[0].yue2AuditionResume);
  await f.review("rejected");
  assert.deepEqual((await f.call(prepareResumeDispatch, { now: Date.now(), includeYuE2: true })).yue2Pending, []);
  f.forbid(); await assert.rejects(f.call(prepareResumeDispatch, { now: Date.now(), includeYuE2: true }));
});

async function assembledFixture(block = "assemble") {
  const f = fixture(); await f.park(); const approval = await f.review(); const [delivery] = await f.pending();
  assert.equal((await f.claim(delivery.yue2AuditionResume)).kind, "claimed");
  const source = { version: "yue2-assembly-source/v1", approvalFingerprint: approval.sourceApprovalFingerprint,
    candidateSha256: candidate.candidateSha256, arrangementFingerprint: arrangement.fingerprint,
    listeningAudioSha256: candidate.listeningAudioSha256, preparedAudioSha256: "a".repeat(64),
    nativeFrames: candidate.nativeFrames, preparedFrames: candidate.nativeFrames - 96000, preparedAudioBytes: 1024,
    crossfadeSec: 2, sampleRateHz: 48000, channels: 2, playback: "repeat", publishingApproved: false };
  f.tables.runStages.push({ _id: "stage-assembly", runId, block, status: "ok", outputs: { yue2AssemblySource: source } });
  const client = { query: async (ref: Parameters<typeof getFunctionName>[0], args: Row) => {
    assert.equal(getFunctionName(ref), "yue2Continuations:verifyReleaseSource");
    assert.deepEqual(Object.keys(args).sort(), ["channelId", "ownerId", "runId", "source"], "never serialize a StageContext or its secrets/callbacks");
    return f.call(continuations.verifyReleaseSource, args);
  } } as unknown as Parameters<typeof verifyCurrentYuE2ReleaseSource>[0];
  const stageScope = { ...scope, log: () => {}, store: { unrelated: "not-for-transport" } };
  return { ...f, source, verify: (value: unknown = source) => verifyCurrentYuE2ReleaseSource(client, stageScope, value) };
}

test("release source binds both assemblers and remains read-only through repeated cached QA/upload/retry checks", async () => {
  for (const block of ["assemble", "timeline_assemble"]) {
    const f = await assembledFixture(block), before = structuredClone(f.tables);
    for (let attempt = 0; attempt < 3; attempt++) assert.deepEqual(await f.verify(), f.source);
    assert.deepEqual(f.tables, before);
    await f.review("rejected", "f".repeat(64)); assert.deepEqual(await f.verify(), f.source);
    await f.review("needs_work"); await assert.rejects(f.verify(), /current explicit owner approval/);
    await f.review(); await assert.rejects(f.verify(), /current explicit owner approval/, "new approval cannot bless a cached old render");
  }
});

test("release rejects missing, corrupt, foreign, unconsumed, or substituted approval and assembly evidence", async () => {
  for (const corrupt of [
    (f: Awaited<ReturnType<typeof assembledFixture>>) => { delete f.run.yue2ContinuationId; },
    (f: Awaited<ReturnType<typeof assembledFixture>>) => { f.tables.yue2Continuations[0].state = "pending"; },
    (f: Awaited<ReturnType<typeof assembledFixture>>) => { f.tables.channels[0].ownerId = "foreign"; },
    (f: Awaited<ReturnType<typeof assembledFixture>>) => { f.run.pipelineInvocationSha256 = "b".repeat(64); },
    (f: Awaited<ReturnType<typeof assembledFixture>>) => { f.tables.runStages[2].status = "running"; },
    (f: Awaited<ReturnType<typeof assembledFixture>>) => { f.tables.runStages.pop(); },
    (f: Awaited<ReturnType<typeof assembledFixture>>) => { f.tables.runStages.push({ ...f.tables.runStages[2], _id: "duplicate" }); },
    (f: Awaited<ReturnType<typeof assembledFixture>>) => { f.tables.runStages[2].outputs = {}; },
    (f: Awaited<ReturnType<typeof assembledFixture>>) => { f.tables.runStages[2].outputs = { yue2AssemblySource: { ...f.source, preparedAudioSha256: "b".repeat(64) } }; },
    (f: Awaited<ReturnType<typeof assembledFixture>>) => { f.forbid(); },
  ]) {
    const f = await assembledFixture(); corrupt(f); await assert.rejects(f.verify());
  }
  const f = await assembledFixture();
  await assert.rejects(f.call(continuations.verifyReleaseSource));
  for (const key of ["candidateSha256", "arrangementFingerprint", "listeningAudioSha256", "approvalFingerprint", "preparedAudioSha256"]) {
    await assert.rejects(f.verify({ ...f.source, [key]: "f".repeat(64) }));
  }
  await assert.rejects(f.verify({ ...f.source, preparedFrames: f.source.preparedFrames + 1 }));
  await assert.rejects(f.verify({ ...f.source, publishingApproved: true }));
});

test("historical non-YuE2 runs remain readable without inventing a source approval", async () => {
  const f = fixture(); delete f.run.pipelineInvocationSnapshot; delete f.run.pipelineInvocationSha256;
  assert.equal(await f.call(continuations.verifyReleaseSource), null);
  await assert.rejects(f.call(continuations.verifyReleaseSource, { source: {} }));
});

test("QA seals the checked source and both upload boundaries recheck before connector access", () => {
  const qa = readFileSync("src/trigger/blocks/narratedBlocks.ts", "utf8");
  assert.match(qa, /const yue2AssemblySource = ctx\.params\["qaProfile"\] === "draft" \? null\s*: await verifyCurrentYuE2ReleaseSource\(convex\(\), ctx, ctx\.store\["yue2AssemblySource"\]\)/u);
  assert.match(qa, /if \(yue2AssemblySource\) await verifyCurrentYuE2ReleaseSource\(convex\(\), ctx, yue2AssemblySource\);\s*const persistedFinalMasterReleaseCertificate = createFinalMasterReleaseCertificate\(\{\s*\.\.\.\(yue2AssemblySource \? \{ yue2AssemblySource \} : \{\}\)/u);
  const upload = readFileSync("src/trigger/blocks/lofiBlocks.ts", "utf8");
  assert.match(upload, /await verifyCurrentYuE2ReleaseSource\(convex\(\), ctx, durableCertificate\.yue2AssemblySource\);\s*return durableCertificate/u);
  const dispatcher = readFileSync("src/lib/publishDispatcher.ts", "utf8");
  const checkAt = dispatcher.indexOf("await verifyCurrentYuE2ReleaseSource(convex,");
  assert.ok(checkAt > dispatcher.indexOf("const releaseEvidence = await verifyPublishIntentReleaseEvidence"));
  assert.ok(checkAt < dispatcher.indexOf("const connector = await requireYouTubeConnector", checkAt));
  assert.match(dispatcher.slice(checkAt), /throw new PublishReleaseEvidenceError\(`source approval no longer verifies/u);
});
