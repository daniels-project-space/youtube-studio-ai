import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as crypto from "node:crypto";
import ts from "typescript";
import * as artifactSchemas from "@/engine/artifactSchemas";
import { manifestFromBlock } from "@/engine/moduleManifest";
import type { ArtifactRef, Block, RunStageSink, StageContext } from "@/engine/types";
import * as stageReuse from "@/engine/stageReuse";
import * as stageReuseContract from "@/engine/stageReuseContract";
import { createVisualArtifactAttempt } from "@/engine/visualArtifactAttemptLedger";
import * as renderAdmission from "@/lib/renderBlockAdmission";
import * as invocationSnapshots from "@/lib/pipelineInvocationSnapshot";
import { pipelineInvocationSha256 } from "@/lib/pipelineInvocationHash";
import { admitFrozenRemoteChildStage } from "@/lib/remoteChildBudgetAdmission";
import * as costTransport from "@/trigger/remoteChildCostTransport";
import * as retryPolicy from "@/trigger/taskRetryPolicy";
import type { RenderBlockInput, RenderBlockRunnerOptions } from "@/trigger/renderBlockRunner";

/**
 * Execute the complete current remote worker body, not a copied restore loop.
 * Only external persistence/storage/bootstrap, registry reconstruction and the
 * final renderer are isolated. Admission, receipt hashing, restore checks,
 * budget admission, checkpoint lineage and cost transport are production code.
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

type Mutation = "seed" | "output" | "missing-receipt" | "params" | "module" | "restoration" | "missing-second-receipt" | "missing-outputs" | "missing-stage" | "failed-stage" | "input-mutation";
function harness(mutation?: Mutation) {
  const calls = { stages: 0, bootstrap: 0, rehydrate: 0, paid: 0, begin: 0, finish: 0, artifactQueries: 0 };
  const writtenArtifacts: NonNullable<Parameters<NonNullable<RunStageSink["upsertArtifacts"]>>[0]>[] = [];
  let observedStore: Record<string, unknown> | undefined;
  let acceptedCost: number | undefined;
  const source: Block = {
    id: "reuse_source", consumes: ["sourceText"],
    produces: ["narrationText", "narrationKey", "narrationLocalPath"], run: noUpstreamExecution,
  };
  const qa: Block = {
    id: "reuse_qa", consumes: ["narrationText", "narrationLocalPath"],
    produces: ["scriptApproved"], run: noUpstreamExecution,
  };
  const renderer: Block = {
    id: "timeline_assemble", paid: true,
    consumes: ["narrationText", "narrationKey", "narrationLocalPath", "scriptApproved"],
    produces: ["videoKey"],
    async run(ctx: StageContext) {
      calls.paid++;
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
    version: "1.0.0", capabilities: [], certification: "contract", certificationEvidence: "fixture only",
    ...(block.paid ? { maxCostUsd: 1 } : {}),
  }));
  const entries = manifests.map((manifest) => ({ block: manifest.id, params: { mode: "exact" } }));
  const seedStore = { sourceText: "White moves the pawn from e2 to e4." };
  const snapshot: invocationSnapshots.PipelineInvocationSnapshot = {
    version: 1, ...scope, source: "channel", entries, seedStore, budgetUsd: 10,
    remoteBlocks: [renderer.id], defaultRetries: 1,
    compilationFingerprint: "b".repeat(64), compilationPolicyId: "fixture-only",
    compilationPolicyVersion: "1.0.0", compilationModules: [], compilationCapabilities: [], reservedMaxCostUsd: 1,
  };
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
      ...scope, manifest, params: entries[index]!.params, store: rawStore, inputRefs: refs,
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
  if (mutation === "params") entries[0]!.params.mode = "different";
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
      selectRehydrationSubset: () => ({}),
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
    "@/lib/remoteChildBudgetAdmission": {
      admitFrozenRemoteChildStage,
      reconstructFrozenRemoteChildPipeline: () => ({ resolved: {
        entries, manifests, blocks: manifests.map((manifest) => manifest.block), producedKeys: [],
      } }),
    },
    "../../convex/_generated/api": { api: fakeApi },
    "@/engine/runtimeCapability": { assertPipelineVideoRuntimeReady() {} },
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
  const run = () => loaded.exports.executeRenderBlock({
    ...scope, leaseOwner: "parent", executionLeaseToken: 1, dispatchKey: "child-dispatch",
    blockId: renderer.id, params: entries[2]!.params, budgetUsd: snapshot.budgetUsd, seedStore: snapshot.seedStore,
  }, options);
  return { run, calls, rows, savedRowsBefore, expectedLineage, writtenArtifacts, observedStore: () => observedStore, acceptedCost: () => acceptedCost };
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
  console.log("REMOTE STAGE REUSE PASS — twelve actual-worker cases, ten pre-spend refusals, post-execution cost retained");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
