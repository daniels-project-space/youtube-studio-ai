import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as crypto from "node:crypto";
import { mock } from "node:test";
import { taskContext, TaskRunContext } from "@trigger.dev/core/v3";
import ts from "typescript";
import * as artifactSchemas from "@/engine/artifactSchemas";
import { manifestFromBlock } from "@/engine/moduleManifest";
import { compilePipeline, PRODUCTION_CONTRACT_POLICY } from "@/engine/pipelineCompiler";
import { _clear, registerManifest, registerManifestVersion } from "@/engine/registry";
import * as runtimeCapability from "@/engine/runtimeCapability";
import { validatePipeline } from "@/engine/validate";
import type { ArtifactRef, Block, PipelineEntry, RunStageSink, StageContext } from "@/engine/types";
import * as stageReuse from "@/engine/stageReuse";
import * as stageReuseContract from "@/engine/stageReuseContract";
import { createVisualArtifactAttempt } from "@/engine/visualArtifactAttemptLedger";
import * as renderAdmission from "@/lib/renderBlockAdmission";
import * as invocationSnapshots from "@/lib/pipelineInvocationSnapshot";
import { pipelineInvocationSha256 } from "@/lib/pipelineInvocationHash";
import { admitFrozenRemoteChildStage, reconstructFrozenRemoteChildPipeline } from "@/lib/remoteChildBudgetAdmission";
import { selectRehydrationSubset } from "@/lib/rehydrate";
import * as costTransport from "@/trigger/remoteChildCostTransport";
import * as retryPolicy from "@/trigger/taskRetryPolicy";
import type { RenderBlockInput, RenderBlockRunnerOptions } from "@/trigger/renderBlockRunner";
import * as pipelineWorkerRuntime from "@/trigger/pipelineWorkerRuntime";

/**
 * Execute the complete current remote worker body, not a copied restore loop.
 * Only external persistence/storage/bootstrap, registry reconstruction and the
 * final renderer are isolated. Admission, receipt hashing, restore checks,
 * budget admission, checkpoint lineage and cost transport are production code.
 * Version variants also use the real registry, reconstruction and compiler;
 * their catalog-named fake blocks certify only this CPU fixture, not production.
 * This proves no-spend admission, not a real GPU/video/storage integration.
 */
const runnerPath = resolve(process.cwd(), "src/trigger/renderBlockRunner.ts");
const compiledRunner = ts.transpileModule(readFileSync(runnerPath, "utf8"), {
  fileName: runnerPath,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const scope = {
  ownerId: "remote-reuse-owner", runId: "remote-reuse-run", channelId: "remote-reuse-channel",
  keyPrefix: "owners/remote-reuse/",
};
const options: RenderBlockRunnerOptions = {
  taskLabel: "remote-reuse-test", machineClass: "heavy", taskRunId: "child-test", attemptNumber: 1,
};
const noUpstreamExecution = async () => { throw new Error("cached upstream must not execute"); };
const workerVersion = "20260919.1";
const receiverContext = TaskRunContext.parse({
  task: { id: "render-block", filePath: "src/trigger/render-block.ts" },
  attempt: { number: 1, startedAt: new Date(0) },
  run: { id: "child-test", tags: [], isTest: true, createdAt: new Date(0), version: workerVersion },
  queue: { id: "queue_fixture", name: "fixture" },
  environment: { id: "env_fixture", slug: "staging", type: "STAGING" },
  project: { id: "proj_fixture", ref: "fixture", slug: "fixture", name: "Fixture" },
  organization: { id: "org_fixture", slug: "fixture", name: "Fixture" },
  machine: { name: "small-1x", cpu: 1, memory: 1, centsPerMs: 0 },
  deployment: { id: "dep_fixture", shortCode: "fixture", version: workerVersion, runtime: "node", runtimeVersion: "22" },
});

type Mutation = "seed" | "output" | "missing-receipt" | "params" | "module" | "restoration" | "missing-second-receipt" | "missing-outputs" | "missing-stage" | "failed-stage" | "input-mutation";
type VersionCase = "v2" | "missing-v2" | "fingerprint-drift" | "historical-v1";
type WorkerMutation = "wrong-version" | "missing-actual" | "missing-context" | "project" | "environment" | "run-version" | "deployment-version" | "missing-binding";
function harness(mutation?: Mutation, versionCase?: VersionCase, workerMutation?: WorkerMutation) {
  const calls = { stages: 0, bootstrap: 0, rehydrate: 0, paid: 0, begin: 0, finish: 0, artifactQueries: 0,
    defaultExecution: 0, alternateExecution: 0, reconstruction: 0 };
  const writtenArtifacts: NonNullable<Parameters<NonNullable<RunStageSink["upsertArtifacts"]>>[0]>[] = [];
  let observedStore: Record<string, unknown> | undefined;
  let acceptedCost: number | undefined;
  let observedStageBudget: number | undefined;
  const source: Block = {
    id: versionCase ? "hook_craft" : "reuse_source", consumes: ["sourceText"],
    produces: ["narrationText", "narrationKey", "narrationLocalPath"], run: noUpstreamExecution,
  };
  const qa: Block = {
    id: versionCase ? "qa_script" : "reuse_qa", consumes: ["narrationText", "narrationLocalPath"],
    produces: ["scriptApproved"], run: noUpstreamExecution,
  };
  const renderer: Block = {
    id: versionCase ? "documotion_short" : "timeline_assemble", paid: true,
    consumes: ["narrationText", "narrationKey", "narrationLocalPath", "scriptApproved"],
    produces: ["videoKey"],
    async run(ctx: StageContext) {
      calls.paid++;
      observedStageBudget = ctx.stageBudgetUsd;
      observedStore = structuredClone(ctx.store);
      await ctx.checkpointVisualArtifactAttempts!([createVisualArtifactAttempt({
        adapterId: "remote_reuse_test", scopeFingerprint: "a".repeat(64),
        attemptId: "render-attempt-1", ordinal: 1,
        artifact: { kind: "video", subjectId: "scene-1", candidate: { id: "candidate-1" } },
        review: { verdict: "accepted", gateId: "fixture_gate", reviewVersion: "test/v1", notes: [] },
        repair: { kind: "initial" },
      })]);
      if (mutation === "input-mutation") (ctx.store as Record<string, unknown>).narrationText = "Changed inside renderer.";
      return { videoKey: "owners/remote-reuse/final.mp4", __costUsd: 0.2 };
    },
  };
  const manifests = [source, qa, renderer].map((block) => manifestFromBlock(block, {
    version: "1.0.0", capabilities: versionCase && block === qa ? [...PRODUCTION_CONTRACT_POLICY.requiredCapabilities] : [],
    certification: "contract", certificationEvidence: "fixture only; no production quality claim",
    ...(block.paid ? { maxCostUsd: versionCase ? 0.5 : 1,
      ...(versionCase ? { providerProfiles: [{ id: "cpu-fixture", provider: "none", quality: "production" as const, allowFallback: false }] } : {}),
    } : {}),
  }));
  const entries: PipelineEntry[] = manifests.map((manifest) => ({ block: manifest.id, params: { mode: "exact" } }));
  const seedStore = { sourceText: "White moves the pawn from e2 to e4." };
  const snapshot: invocationSnapshots.PipelineInvocationSnapshot = {
    version: 1, ...scope, source: "channel", entries, seedStore, budgetUsd: 10,
    remoteBlocks: [renderer.id], defaultRetries: 1,
    compilationFingerprint: "b".repeat(64), compilationPolicyId: "fixture-only",
    compilationPolicyVersion: "1.0.0", compilationModules: [], compilationCapabilities: [], reservedMaxCostUsd: 1,
    ...(versionCase && versionCase !== "historical-v1" ? { workerDeployment: {
      version: workerVersion, projectId: receiverContext.project.id, environmentId: receiverContext.environment.id,
    } } : {}),
  };
  let reconstructed: ReturnType<typeof reconstructFrozenRemoteChildPipeline> | undefined;
  let legacyCompilation: ReturnType<typeof compilePipeline> | undefined;
  if (versionCase) {
    _clear();
    const legacyBlock: Block = { ...renderer, async run(ctx) {
      calls.defaultExecution++;
      assert.equal(versionCase, "historical-v1", "default executable trap: frozen v2 must not dispatch v1");
      return renderer.run(ctx);
    } };
    const legacy = { ...manifests[2]!, block: legacyBlock, execute: legacyBlock.run };
    const alternateBlock: Block = { ...renderer, async run(ctx) {
      calls.alternateExecution++;
      return renderer.run(ctx);
    } };
    const alternate = { ...legacy, version: "2.0.0", block: alternateBlock, execute: alternateBlock.run,
      costAndLatency: { ...legacy.costAndLatency, maxCostUsd: 0.75 } };
    for (const manifest of [manifests[0]!, manifests[1]!, legacy]) registerManifest(manifest);
    legacyCompilation = compilePipeline(validatePipeline(entries, Object.keys(seedStore)));
    // Freeze the historical unversioned invocation before the alternate exists.
    if (versionCase === "historical-v1") {
      Object.assign(snapshot, {
        compilationFingerprint: legacyCompilation.fingerprint,
        compilationPolicyId: legacyCompilation.policyId, compilationPolicyVersion: legacyCompilation.policyVersion,
        compilationModules: legacyCompilation.modules, compilationCapabilities: legacyCompilation.capabilities,
        reservedMaxCostUsd: legacyCompilation.reservedMaxCostUsd,
      });
    }
    registerManifestVersion(alternate);
    if (versionCase !== "historical-v1") {
      entries[2]!.version = alternate.version;
      const compilation = compilePipeline(validatePipeline(entries, Object.keys(seedStore)));
      Object.assign(snapshot, {
        compilationFingerprint: compilation.fingerprint,
        compilationPolicyId: compilation.policyId, compilationPolicyVersion: compilation.policyVersion,
        compilationModules: compilation.modules, compilationCapabilities: compilation.capabilities,
        reservedMaxCostUsd: compilation.reservedMaxCostUsd,
      });
    }
    reconstructed = reconstructFrozenRemoteChildPipeline(snapshot);
    if (versionCase === "missing-v2") {
      _clear();
      for (const manifest of [manifests[0]!, manifests[1]!, legacy]) registerManifest(manifest);
    }
    if (versionCase === "fingerprint-drift") entries[2]!.version = legacy.version;
  }
  if (workerMutation === "missing-binding") delete snapshot.workerDeployment;
  const rawStore: Record<string, unknown> = { ...seedStore };
  const refs: Record<string, ArtifactRef> = {};
  for (const [key, value] of Object.entries(rawStore)) {
    const contract = artifactSchemas.artifactContract(key);
    const payloadHash = stageReuse.stageReuseHash(value);
    refs[key] = {
      artifactId: `${scope.runId}:seed:${key}:${payloadHash.slice(0, 16)}`, key,
      type: contract.type, schemaVersion: contract.version,
      producerModule: "$seed", producerVersion: "1.0.0", payloadHash,
    };
  }
  const patches: Record<string, unknown>[] = [{
    narrationText: seedStore.sourceText,
    narrationKey: "owners/remote-reuse/narration.mp3",
    narrationLocalPath: "/old-worker/narration.mp3",
  }, { scriptApproved: true }];
  const rows = patches.map((outputs, index) => {
    const manifest = manifests[index]!;
    const invocationHash = stageReuse.stageInvocationHash({
      ...scope, manifest, params: entries[index]!.params ?? {}, store: rawStore, inputRefs: refs,
    });
    const inputArtifactIds = Object.keys(manifest.consumes).map((key) => refs[key]!.artifactId).sort();
    const outputRefs = Object.entries(outputs).map(([key, value]): ArtifactRef => {
      const contract = artifactSchemas.artifactContract(key);
      const payloadHash = stageReuse.stageReuseHash(value);
      const identity = stageReuse.stageReuseHash({
        payloadHash, inputArtifactIds, moduleId: manifest.id, moduleVersion: manifest.version, artifactKey: key,
      });
      return {
        artifactId: `${scope.runId}:${manifest.id}:${key}:${identity.slice(0, 16)}`, key,
        type: contract.type, schemaVersion: contract.version,
        producerModule: manifest.id, producerVersion: manifest.version, payloadHash,
      };
    });
    const reuseReceipt = stageReuse.sealStageReuseReceipt(invocationHash, outputs, outputRefs);
    for (const ref of outputRefs) refs[ref.key] = ref;
    Object.assign(rawStore, outputs);
    return { block: manifest.id, status: "ok", outputs, cost: 0.1, reuseReceipt: reuseReceipt as unknown };
  });
  const expectedLineage = renderer.consumes.map((key) => refs[key]!.artifactId).sort();
  if (mutation === "seed") snapshot.seedStore.sourceText = "Black castles on the opposite side.";
  if (mutation === "output") rows[0]!.outputs.narrationText = "Unreviewed replacement text.";
  if (mutation === "missing-receipt") delete (rows[0] as { reuseReceipt?: unknown }).reuseReceipt;
  if (mutation === "missing-second-receipt") delete (rows[1] as { reuseReceipt?: unknown }).reuseReceipt;
  if (mutation === "missing-outputs") (rows[1] as { outputs: unknown }).outputs = null;
  if (mutation === "missing-stage") rows.splice(1, 1);
  if (mutation === "failed-stage") rows[1]!.status = "failed";
  if (mutation === "params") entries[0]!.params!.mode = "different";
  if (mutation === "module") manifests[0]!.version = "2.0.0";
  const savedRowsBefore = structuredClone(rows);
  const fakeApi = {
    runs: { assertRemoteChildWaitLease: "lease", getRun: "run", renewRemoteChildWaitLease: "renew" },
    channels: { getChannel: "channel" },
    remoteChildCosts: { begin: "begin", finish: "finish" },
    runArtifacts: { listForRun: "artifact-list" },
  };
  class Client {
    async query(name: string) {
      if (name === "run") return {
        _id: scope.runId, ownerId: scope.ownerId, channelId: scope.channelId, status: "running",
        pipelineInvocationSnapshot: snapshot, pipelineInvocationSha256: pipelineInvocationSha256(snapshot),
      };
      if (name === "channel") return { _id: scope.channelId, ownerId: scope.ownerId };
      if (name === "artifact-list") calls.artifactQueries++;
      throw new Error(`unexpected query ${name}`);
    }
    async mutation(name: string, input: { costUsd?: number; complete?: boolean }) {
      if (name === "lease" || name === "renew") return {};
      if (name === "begin") { calls.begin++; return {}; }
      if (name === "finish") { calls.finish++; acceptedCost = input.costUsd; return { costUsd: input.costUsd, complete: input.complete, attempts: 1 }; }
      throw new Error(`unexpected mutation ${name}`);
    }
  }
  const sink: RunStageSink = {
    upsert: async () => { throw new Error("child must not rewrite upstream stages"); },
    getResumeState: async () => { calls.stages++; return structuredClone(rows); },
    upsertArtifacts: async (args) => { writtenArtifacts.push(structuredClone(args)); },
  };
  const modules: Record<string, unknown> = {
    "node:crypto": crypto,
    "@trigger.dev/sdk/v3": { logger: { info() {}, warn() {}, error() {} } },
    "@/lib/studioConvexHttpClient": { StudioConvexHttpClient: Client },
    "@/engine/blocks": { registerAllBlocks() {} },
    "@/engine/convexSink": { makeConvexSink: () => sink },
    "@/engine/artifactSchemas": artifactSchemas,
    "@/engine/stageReuse": stageReuse,
    "@/engine/stageReuseContract": stageReuseContract,
    "@/lib/rehydrate": {
      selectRehydrationSubset: versionCase ? selectRehydrationSubset : () => ({}),
      rehydrateOutputs: async (_block: string, outputs: Record<string, unknown>) => {
        calls.rehydrate++;
        return { ok: true, outputs: {
          ...outputs,
          ...(outputs.narrationLocalPath ? { narrationLocalPath: "/new-worker/narration.mp3" } : {}),
          ...(mutation === "restoration" ? { narrationText: "Changed during restoration." } : {}),
        } };
      },
    },
    "@/lib/bootstrap": { bootstrapSecrets: async () => { calls.bootstrap++; } },
    "@/trigger/taskRetryPolicy": retryPolicy,
    "@/lib/renderBlockAdmission": renderAdmission,
    "@/lib/pipelineInvocationSnapshot": invocationSnapshots,
    "./pipelineWorkerRuntime": pipelineWorkerRuntime,
    "@/lib/remoteChildBudgetAdmission": {
      admitFrozenRemoteChildStage,
      reconstructFrozenRemoteChildPipeline: (frozen: invocationSnapshots.PipelineInvocationSnapshot) => {
        calls.reconstruction++;
        return versionCase ? reconstructFrozenRemoteChildPipeline(frozen) : { resolved: {
          entries, manifests, blocks: manifests.map((manifest) => manifest.block), producedKeys: [],
        } };
      },
    },
    "../../convex/_generated/api": { api: fakeApi },
    "@/engine/runtimeCapability": versionCase ? runtimeCapability : { assertPipelineVideoRuntimeReady() {} },
    "@/lib/renderChildLease": { RENDER_CHILD_HEARTBEAT_RENEW_INTERVAL_MS: 60_000 },
    "@/trigger/remoteChildCostTransport": costTransport,
  };
  const loaded = { exports: {} as { executeRenderBlock: (input: RenderBlockInput, options: RenderBlockRunnerOptions) => Promise<{ patch: Record<string, unknown> }> } };
  new Function("require", "module", "exports", "process", compiledRunner)(
    (name: string) => {
      assert.ok(Object.hasOwn(modules, name), `unisolated remote worker import: ${name}`);
      return modules[name];
    }, loaded, loaded.exports, { env: { NEXT_PUBLIC_CONVEX_URL: "https://never-used.invalid" } },
  );
  const run = async () => {
    const ctx = structuredClone(receiverContext);
    const worker = { id: "worker_fixture", version: workerVersion, contentHash: "fixture" };
    if (workerMutation === "wrong-version") {
      worker.version = "20260919.99";
      ctx.run.version = worker.version;
      ctx.deployment!.version = worker.version;
    }
    if (workerMutation === "project") ctx.project.id = "other_project";
    if (workerMutation === "environment") ctx.environment.id = "other_environment";
    if (workerMutation === "run-version") ctx.run.version = "20260919.98";
    if (workerMutation === "deployment-version") ctx.deployment!.version = "20260919.97";
    taskContext.setGlobalTaskContext({ ctx, worker });
    const missingActual = workerMutation === "missing-actual"
      ? mock.getter(taskContext, "worker", () => undefined) : undefined;
    try {
      return await loaded.exports.executeRenderBlock({
        ...scope, leaseOwner: "parent", executionLeaseToken: 1, dispatchKey: "child-dispatch",
        blockId: renderer.id, params: entries[2]!.params ?? {}, budgetUsd: snapshot.budgetUsd, seedStore: snapshot.seedStore,
      }, { ...options, ...(versionCase && versionCase !== "historical-v1" && workerMutation !== "missing-context"
        ? { workerContext: ctx } : {}) });
    } finally {
      missingActual?.mock.restore();
    }
  };
  return { run, calls, rows, savedRowsBefore, expectedLineage, writtenArtifacts, snapshot, reconstructed, legacyCompilation,
    observedStore: () => observedStore, acceptedCost: () => acceptedCost, observedStageBudget: () => observedStageBudget };
}

async function main() {
  const unchanged = harness();
  const result = await unchanged.run();
  assert.equal(result.patch.__costUsd, 0.2);
  assert.equal(unchanged.calls.paid, 1);
  assert.equal(unchanged.calls.begin, 1);
  assert.equal(unchanged.calls.finish, 1);
  assert.equal(unchanged.calls.stages, 1, "reuse adds no stage query round trips");
  assert.equal(unchanged.calls.artifactQueries, 0, "historical artifacts must not replace selected identities");
  assert.equal(unchanged.observedStore()!.narrationLocalPath, "/new-worker/narration.mp3");
  assert.equal(unchanged.observedStore()!.scriptApproved, true);
  assert.deepEqual(unchanged.rows, unchanged.savedRowsBefore, "worker-local restoration must not rewrite durable outputs");
  assert.equal(unchanged.writtenArtifacts.length, 1);
  assert.deepEqual(unchanged.writtenArtifacts[0]!.artifacts[0]!.inputArtifactIds, unchanged.expectedLineage,
    "real checkpoint writer binds original selected refs after temp paths move");

  for (const mutation of ["seed", "output", "missing-receipt", "params", "module", "restoration", "missing-second-receipt", "missing-outputs", "missing-stage", "failed-stage"] as const) {
    const candidate = harness(mutation);
    await assert.rejects(candidate.run(), /STAGE_REUSE_RECONCILIATION_REQUIRED/, mutation);
    assert.equal(candidate.calls.paid, 0, `${mutation} must fail before paid block execution`);
    assert.equal(candidate.calls.begin, 0, `${mutation} must fail before cost transaction begins`);
    assert.equal(candidate.calls.finish, 0);
    assert.equal(candidate.writtenArtifacts.length, 0, `${mutation} must not relabel stale lineage`);
    if (["seed", "output", "missing-receipt", "params", "module"].includes(mutation)) {
      assert.equal(candidate.calls.rehydrate, 0, `${mutation} fails before storage reads`);
    }
  }
  const lateMutation = harness("input-mutation");
  await assert.rejects(lateMutation.run(), /STAGE_REUSE_RECONCILIATION_REQUIRED/);
  assert.equal(lateMutation.calls.paid, 1);
  assert.equal(lateMutation.calls.finish, 1);
  assert.equal(lateMutation.acceptedCost(), 0.2, "post-execution input mutation preserves already-observed remote cost");
  assert.deepEqual(lateMutation.rows, lateMutation.savedRowsBefore);
  try {
    for (const versionCase of ["v2", "historical-v1"] as const) {
      const candidate = harness(undefined, versionCase);
      const version = versionCase === "v2" ? "2.0.0" : "1.0.0";
      const costEnvelope = versionCase === "v2" ? 0.75 : 0.5;
      const compilation = candidate.reconstructed!.compilation;
      assert.equal(compilation.modules[2]!.version, version);
      assert.equal(compilation.catalogFlow[2]!.executableVersion, version);
      assert.equal(compilation.reservedMaxCostUsd, costEnvelope);
      assert.equal(compilation.fingerprint, candidate.snapshot.compilationFingerprint);
      if (versionCase === "v2") {
        assert.notEqual(compilation.fingerprint, candidate.legacyCompilation!.fingerprint);
      } else {
        assert.equal(candidate.snapshot.entries[2]!.version, undefined, "historical ABI has no version field");
        assert.equal(compilation.fingerprint, candidate.legacyCompilation!.fingerprint);
      }
      const output = await candidate.run();
      assert.equal(candidate.calls.reconstruction, 1, "matching binding reaches the actual reconstruction once");
      assert.equal(output.patch.videoKey, "owners/remote-reuse/final.mp4");
      assert.equal(output.patch.__costUsd, 0.2, "fake observed cost survives real cost transport");
      assert.equal(candidate.calls.defaultExecution, versionCase === "v2" ? 0 : 1);
      assert.equal(candidate.calls.alternateExecution, versionCase === "v2" ? 1 : 0);
      assert.equal(candidate.calls.paid, 1);
      assert.equal(candidate.calls.begin, 1);
      assert.equal(candidate.calls.finish, 1);
      assert.equal(candidate.acceptedCost(), 0.2);
      assert.equal(candidate.observedStageBudget(), costEnvelope, "child context uses selected manifest envelope");
      assert.equal(candidate.writtenArtifacts.length, 1);
      assert.equal(candidate.writtenArtifacts[0]!.artifacts[0]!.artifact.producerVersion, version);
      assert.deepEqual(candidate.rows, candidate.savedRowsBefore);
    }
    for (const versionCase of ["missing-v2", "fingerprint-drift"] as const) {
      const candidate = harness(undefined, versionCase);
      await assert.rejects(candidate.run(), versionCase === "missing-v2"
        ? /unknown block "documotion_short" version "2\.0\.0"/ : /module\/policy fingerprint drift/);
      for (const key of ["defaultExecution", "alternateExecution", "paid", "begin", "finish", "rehydrate", "bootstrap", "stages", "artifactQueries"] as const) {
        assert.equal(candidate.calls[key], 0, `${versionCase}: refuse before ${key}`);
      }
      assert.equal(candidate.writtenArtifacts.length, 0);
      assert.deepEqual(candidate.rows, candidate.savedRowsBefore);
    }
    const workerRefusals: Array<[WorkerMutation, RegExp]> = [
      ["wrong-version", /pipeline worker deployment version mismatch/],
      ["missing-actual", /pipeline worker deployment version must be/],
      ["missing-context", /bound pipeline requires executing worker context/],
      ["project", /pipeline worker deployment projectId mismatch/],
      ["environment", /pipeline worker deployment environmentId mismatch/],
      ["run-version", /pipeline worker deployment runVersion mismatch/],
      ["deployment-version", /pipeline worker deployment deploymentVersion mismatch/],
      ["missing-binding", /versioned pipeline requires a frozen worker deployment/],
    ];
    for (const [mutation, expected] of workerRefusals) {
      const candidate = harness(undefined, "v2", mutation);
      await assert.rejects(candidate.run(), expected);
      for (const [key, value] of Object.entries(candidate.calls)) {
        assert.equal(value, 0, `${mutation}: refuse before ${key}, including compilation/reconstruction`);
      }
      assert.equal(candidate.writtenArtifacts.length, 0);
      assert.equal(candidate.acceptedCost(), undefined);
      assert.deepEqual(candidate.rows, candidate.savedRowsBefore);
    }
  } finally {
    _clear();
  }
  console.log("REMOTE STAGE REUSE PASS — twelve actual-worker cases, ten pre-spend refusals, post-execution cost retained");
  console.log("REMOTE VERSION DISPATCH PASS - four real frozen-reconstruction/compiler/worker cases; CPU fake blocks, no provider calls");
  console.log("REMOTE WORKER BINDING PASS - matching deployment, historical unbound compatibility, eight pre-reconstruction refusals");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
