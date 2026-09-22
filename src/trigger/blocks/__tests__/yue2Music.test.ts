import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { canonicalJson } from "@/lib/canonicalJson";
import { yue2Sha256 } from "@/lib/yue2Evaluation";
import type { YuE2DurableEvaluationInput } from "@/lib/yue2DurableEvaluation";
import type { RunStageSink, StageContext } from "@/engine/types";

const read = (name: string) => JSON.parse(readFileSync(`test-fixtures/music-composer/seaside-after/${name}.json`, "utf8"));
const retained = read("gpu-material"), brief = read("brief").musicBrief;
const arrangement = retained.request.acceptedArrangement;
const policy = { schema_version: 1, provider: "openrelay", allocation_basis: "supervised_dispatch_wall_time",
  rate_source: "operator_configured", rate_reference: "synthetic admission policy", runtime_id: "fixture",
  hourly_rate_usd_micros: 180000, max_execution_seconds: 600, termination_grace_seconds: 10, reserved_allocation_usd_micros: 30500 };
const params = { seed: 42, personalCreatorAcknowledged: true, maxCostUsd: 0.04, executionPolicy: policy };
let calls: YuE2DurableEvaluationInput[] = [], waits = 0, bootstraps = 0, reads = 0;
let mode: "complete" | "pending-complete" | "pending" | "held" | "throw" = "complete";
let material = structuredClone(retained), authorize = false;
const load = createRequire(__filename);
const durable = load("@/lib/yue2DurableEvaluation") as typeof import("@/lib/yue2DurableEvaluation");
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load, originalFetch = globalThis.fetch;
const originalEnv = { url: process.env.YUE2_EVALUATION_URL, token: process.env.YUE2_EVALUATION_TOKEN };
process.env.YUE2_EVALUATION_URL = "https://fixture.invalid";
process.env.YUE2_EVALUATION_TOKEN = "fixture_token_not_a_real_credential_12345678";
globalThis.fetch = async () => { throw new Error("shared source test forbids network"); };
loader._load = function (id, ...args) {
  if (id === "@/lib/yue2DurableEvaluation") return { ...durable,
    executeDurableYuE2Evaluation: async (input: YuE2DurableEvaluationInput) => {
      calls.push(input);
      if (authorize && !input.recoverOnly) await input.authorizeSubmission();
      if (mode === "throw") throw new Error("ambiguous provider response with confidential detail");
      if (mode === "pending" || (mode === "pending-complete" && calls.length === 1)) {
        return { status: "pending", jobId: retained.candidate.jobId, reused: false,
          bindingKey: retained.candidate.bindingKey, workerStatus: "running" };
      }
      if (mode === "held") return { status: "held", jobId: retained.candidate.jobId, reused: true,
        bindingKey: retained.candidate.bindingKey, reason: "supervised_execution_requires_review",
        executionAccounting: { ...retained.candidate.executionAccounting, supervisorStatus: "failed" } };
      return { status: "completed", jobId: retained.candidate.jobId, reused: true,
        candidateKey: retained.candidate.bindingKey.replace("binding.json", "candidate.json"),
        audioKey: retained.candidate.audioKey, candidate: structuredClone(retained.candidate) };
    },
    readDurableYuE2Candidate: async (scope: unknown) => {
      assert.deepEqual(scope, { ownerId: arrangement.ownerId, channelId: arrangement.channelId, runId: arrangement.runId });
      reads++; return structuredClone(material);
    },
  };
  if (id === "@/lib/bootstrap") return { bootstrapSecrets: async (_log: unknown, options: unknown) => {
    bootstraps++; assert.deepEqual(options, { services: ["cloudflare"], required: ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] });
  } };
  if (id === "@trigger.dev/sdk/v3") return { ...originalLoad.call(this, id, ...args) as object,
    wait: { for: async (options: { seconds: number; idempotencyKey: string }) => {
      waits++; assert.equal(options.seconds, 120); assert.ok(options.idempotencyKey.startsWith(retained.candidate.jobId));
    } },
  };
  return originalLoad.call(this, id, ...args);
};
const context: StageContext = {
  ownerId: arrangement.ownerId, channelId: arrangement.channelId, runId: arrangement.runId,
  keyPrefix: `owner/${arrangement.ownerId}/`, params, budgetUsd: 1, stageBudgetUsd: 0.04,
  assertInlinePaidExecutionLease: async () => {}, store: { topic: arrangement.topic, acceptedMusicArrangement: arrangement }, log: () => {},
};
function reset() { calls = []; waits = 0; bootstraps = 0; reads = 0; mode = "complete"; authorize = false; material = structuredClone(retained); }
function changedArrangement(change: Record<string, unknown>) {
  const body = { ...arrangement, ...change };
  delete body.fingerprint;
  const json = JSON.parse(JSON.stringify(body));
  return { ...json, fingerprint: yue2Sha256(canonicalJson(json)) };
}
function sink() {
  type Row = Awaited<ReturnType<NonNullable<RunStageSink["getResumeState"]>>>[number];
  const rows = new Map<string, Row>();
  const value: RunStageSink = { async upsert(row) {
    rows.set(row.block, structuredClone({ ...rows.get(row.block),
      ...Object.fromEntries(Object.entries(row).filter(([, item]) => item !== undefined)) }) as Row);
  }, async getResumeState() { return structuredClone([...rows.values()]); } };
  return { rows, value };
}

async function main() {
  const { registerAllBlocks, _resetBlocks } = load("@/engine/blocks") as typeof import("@/engine/blocks");
  const { getManifest, allManifests, registerManifest } = load("@/engine/registry") as typeof import("@/engine/registry");
  const { manifestFromBlock } = load("@/engine/moduleManifest") as typeof import("@/engine/moduleManifest");
  const { validatePipeline } = load("@/engine/validate") as typeof import("@/engine/validate");
  const { runPipeline } = load("@/engine/runner") as typeof import("@/engine/runner");
  const { rehydrateOutputs } = load("@/lib/rehydrate") as typeof import("@/lib/rehydrate");
  const { YUE2_MUSIC_CANDIDATE_VERSION } = load("../yue2Music") as typeof import("../yue2Music");
  _resetBlocks(); registerAllBlocks();
  const selected = getManifest("music", YUE2_MUSIC_CANDIDATE_VERSION)!;
  assert.ok(selected && !allManifests().includes(selected));
  assert.notEqual(getManifest("music"), selected);
  assert.deepEqual(Object.keys(selected.produces), ["yue2MusicCandidate"]);
  assert.deepEqual(selected.capabilities, ["audio.music_candidate"]);
  assert.equal(selected.retryAndResume.retryable, false);

  for (const patch of [
    { ownerId: "another-owner" }, { channelId: "another-channel" }, { runId: "another-run" },
    { budgetUsd: 0 }, { budgetUsd: Infinity }, { stageBudgetUsd: undefined }, { stageBudgetUsd: 0.03 },
    { assertInlinePaidExecutionLease: undefined }, { params: { ...params, provider: "suno" } },
    { params: { ...params, personalCreatorAcknowledged: false } }, { params: { ...params, maxCostUsd: 0.02 } },
    { params: { ...params, executionPolicy: { ...policy, max_execution_seconds: 1300, reserved_allocation_usd_micros: 100000 } } },
    ...[changedArrangement({ symbolicScore: undefined }), changedArrangement({ reviewContext: undefined }),
      changedArrangement({ topic: "Another episode" })].map(value => ({ store: { ...context.store, acceptedMusicArrangement: value } })),
  ]) {
    reset(); await assert.rejects(selected.execute({ ...context, ...patch }));
    assert.equal(calls.length + reads + bootstraps, 0, "invalid input must refuse before vault/storage/provider I/O");
  }
  reset();
  const patch = await selected.execute(context);
  assert.equal(patch.__costUsd, 0.004208);
  const candidate = selected.produces.yue2MusicCandidate.schema.parse(patch.yue2MusicCandidate) as Record<string, unknown>;
  assert.equal(candidate.productionApproved, false);
  assert.equal(candidate.listeningAudioSha256, retained.candidate.headroom.audioSha256);
  assert.deepEqual(calls[0].request, retained.request, "score, personality, role and natural-duration policy reach the worker unchanged");
  assert.equal(reads, 1);
  reset(); mode = "throw";
  await assert.rejects(selected.execute({ ...context, store: { ...context.store,
    acceptedMusicArrangement: changedArrangement({ symbolicScorePolicy: "instrumental" }) } }), /RECONCILIATION_REQUIRED/);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].request.job.schema_version === 2);
  assert.equal(calls[0].request.job.score_policy, "instrumental");
  assert.notEqual(calls[0].request.job.job_id, retained.request.job.job_id);
  assert.equal(reads, 0, "transport failure never substitutes a historical candidate");
  for (const mutation of [{ productionApproved: true }, { listeningAudioKey: "owner/foreign/audio.wav" },
    { candidateKey: "owner/foreign/candidate.json" }]) {
    assert.equal(selected.produces.yue2MusicCandidate.schema.safeParse({ ...candidate, ...mutation }).success, false);
  }
  reset(); material.quality.status = "blocked";
  assert.equal(((await selected.execute(context)).yue2MusicCandidate as Record<string, unknown>).technicalStatus, "blocked");
  reset(); mode = "pending-complete";
  await selected.execute(context);
  assert.equal(waits, 1); assert.equal(calls.length, 2);
  assert.equal(calls[0].recoverOnly, undefined); assert.equal(calls[1].recoverOnly, true);
  reset(); mode = "pending";
  await assert.rejects(selected.execute(context), /RECONCILIATION_REQUIRED/);
  assert.equal(waits, 8); assert.equal(calls.length, 9);
  assert.ok(calls.slice(1).every(call => call.recoverOnly === true));

  registerManifest(manifestFromBlock({ id: "retained_brief_fixture", consumes: [], produces: ["musicBrief"],
    run: async () => ({ musicBrief: structuredClone(brief) }) }, { capabilities: ["crew.accepted_music_arrangement"] }));
  const entries = [{ block: "retained_brief_fixture" }, { block: "music_arrangement_plan" },
    { block: "music", version: YUE2_MUSIC_CANDIDATE_VERSION, params }];
  const resolved = validatePipeline(entries, ["topic"]);
  for (const [consumer, seeds] of [["assemble", ["loopUnitKey"]],
    ["timeline_assemble", ["footageClips", "narrationLocalPath", "narrationDurationSec"]]] as const) {
    assert.throws(() => validatePipeline([...entries, { block: consumer }], ["topic", ...seeds]), /musicUrl/,
      "candidate cannot satisfy release-ready music input");
  }
  reset(); mode = "pending-complete";
  const saved = sink();
  const options = { ...context, seedStore: { topic: arrangement.topic }, sink: saved.value, defaultRetries: 2,
    rehydrate: (block: string, outputs: Record<string, unknown>) => rehydrateOutputs(block, outputs, context.runId) };
  const result = await runPipeline(resolved, options);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.store.acceptedMusicArrangement, arrangement, "actual planner seals the retained brief exactly");
  assert.equal(result.costTotal, 0.004208);
  assert.equal((result.store.yue2MusicCandidate as Record<string, unknown>).productionApproved, false);
  assert.equal(result.store.musicKey, undefined); assert.equal(result.store.musicUrl, undefined);
  const count = calls.length;
  const replay = await runPipeline(resolved, options);
  assert.equal(replay.ok, true, replay.error);
  assert.equal(calls.length, count, "completed stage restores without dispatch");

  reset();
  let laterWork = 0;
  registerManifest(manifestFromBlock({ id: "after_audition_fixture", consumes: ["yue2MusicCandidate"], produces: [],
    run: async () => { laterWork++; return {}; } }));
  const pausedGraph = validatePipeline([...entries, { block: "after_audition_fixture" }], ["topic"]);
  const pausedOptions = { ...options, sink: sink().value };
  const paused = await runPipeline(pausedGraph, { ...pausedOptions, stopAfterBlockId: "music" });
  assert.equal(paused.status, "awaiting_review", paused.error); assert.equal(paused.stoppedAfterBlockId, "music");
  assert.equal(laterWork, 0); const dispatchesAtPause = calls.length;
  const continued = await runPipeline(pausedGraph, pausedOptions);
  assert.equal(continued.ok, true, continued.error); assert.equal(laterWork, 1);
  assert.equal(calls.length, dispatchesAtPause, "approved continuation must restore the exact candidate without new inference");
  assert.deepEqual(continued.store.yue2MusicCandidate, paused.store.yue2MusicCandidate);

  for (const fault of ["held", "throw", "mismatch"] as const) {
    reset();
    if (fault === "mismatch") material.request.job.seed++;
    else mode = fault;
    const heldOptions = { ...options, sink: sink().value };
    const failure = await runPipeline(resolved, heldOptions);
    assert.equal(failure.ok, false); assert.match(failure.error ?? "", /RECONCILIATION_REQUIRED/);
    assert.doesNotMatch(failure.error ?? "", /confidential detail/);
    assert.equal(failure.costTotal, fault === "throw" ? 0 : 0.004208, "known allocations survive rejected output");
    assert.equal(calls.length, 1);
    assert.equal((await runPipeline(resolved, heldOptions)).ok, false);
    assert.equal(calls.length, 1, "ambiguous or rejected paid work cannot be re-purchased on engine resume");
  }
  reset(); authorize = true;
  await assert.rejects(selected.execute({ ...context, assertInlinePaidExecutionLease: async () => { throw new Error("revoked"); } }), /RECONCILIATION_REQUIRED/);
  assert.equal(reads, 0);
  _resetBlocks();
  console.log("SHARED YUE2 MUSIC PASS: real planner/runner/version ABI; bounded same-job recovery, scope/budget/lease refusal, rejected-charge preservation, no assembly approval or repurchase; worker/storage transport mocked");
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  loader._load = originalLoad; globalThis.fetch = originalFetch;
  if (originalEnv.url === undefined) delete process.env.YUE2_EVALUATION_URL; else process.env.YUE2_EVALUATION_URL = originalEnv.url;
  if (originalEnv.token === undefined) delete process.env.YUE2_EVALUATION_TOKEN; else process.env.YUE2_EVALUATION_TOKEN = originalEnv.token;
});
