import assert from "node:assert/strict";
import { registerAllBlocks } from "@/engine/blocks";
import { _clear, allManifests, getManifest, registerManifest } from "@/engine/registry";
import { assertExecutableManifest, manifestFromBlock, type ModuleManifest, type ModuleSideEffect } from "@/engine/moduleManifest";
import { runPipeline } from "@/engine/runner";
import { validatePipeline } from "@/engine/validate";
import { prepareWorkedExample, assertWorkedExamplePreparation, type WorkedExampleRequest } from "@/engine/workedExample";
import { rehydrateOutputsWithStorage, type RehydrationStorage } from "@/lib/rehydrate";
import type { Block, RunStageSink } from "@/engine/types";

const current: WorkedExampleRequest = {
  policy: "worked-example/integer-v1", ownerId: "owner-a", channelId: "channel-a", runId: "run-a",
  requestId: "request-current", seed: "seed-current", operations: ["multiply", "add"],
};
const expected = prepareWorkedExample(current);
const stale = prepareWorkedExample({ ...current, requestId: "request-stale", seed: "seed-stale" });
const base = { ownerId: current.ownerId, channelId: current.channelId, runId: current.runId, keyPrefix: "owners/owner-a/", budgetUsd: 0, defaultRetries: 0 };
let networkCalls = 0, storageCalls = 0;
const storage: RehydrationStorage = {
  async getObjectToFile() { storageCalls += 1; throw new Error("storage download forbidden"); },
  async headObjectMetadata() { storageCalls += 1; throw new Error("storage HEAD forbidden"); },
};

async function mathResume(): Promise<void> {
  registerAllBlocks();
  assert.equal(stale.derivation.answer, "401"); assert.equal(expected.derivation.answer, "-175");
  const variants = [
    { name: "stale-request", cached: stale, request: current, succeeds: true },
    { name: "foreign-cached-namespace", cached: prepareWorkedExample({ ...current, ownerId: "owner-foreign", channelId: "channel-foreign", runId: "run-foreign" }), request: current, succeeds: true },
    { name: "unchanged-request", cached: expected, request: current, succeeds: true },
    { name: "corrupt-cached-output", cached: { ...expected, fingerprint: "bad" }, request: current, succeeds: true },
    { name: "foreign-active-owner", cached: expected, request: { ...current, ownerId: "owner-foreign" }, succeeds: false },
    { name: "foreign-active-channel", cached: expected, request: { ...current, channelId: "channel-foreign" }, succeeds: false },
    { name: "foreign-active-run", cached: expected, request: { ...current, runId: "run-foreign" }, succeeds: false },
    { name: "unsupported-active-policy", cached: expected, request: { ...current, policy: "unsupported" }, succeeds: false },
  ];
  for (const variant of variants) {
    const before = structuredClone(variant.cached);
    const writes: Parameters<RunStageSink["upsert"]>[0][] = [];
    const artifacts: unknown[] = [], rehydrated: string[] = [], logs: string[] = [];
    // Actual storage-backed rehydration cannot validate request/namespace binding.
    const ordinaryRestore = await rehydrateOutputsWithStorage("worked_example_prepare", { workedExamplePreparation: variant.cached }, current.runId, { neededOutputKeys: new Set() }, storage);
    assert.equal(ordinaryRestore.ok, true);
    const sink: RunStageSink = {
      async upsert(row) { writes.push(row); },
      async upsertArtifacts(row) { artifacts.push(...row.artifacts.map((artifact) => artifact.payload)); },
      async getCompleted() { return [{ block: "worked_example_prepare", outputs: { workedExamplePreparation: variant.cached }, cost: 0 }]; },
    };
    const result = await runPipeline(validatePipeline([{ block: "worked_example_prepare" }], ["workedExampleRequest"]), {
      ...base, sink, seedStore: { workedExampleRequest: variant.request }, log: (line) => { logs.push(line); },
      rehydrate: (block, outputs, demand) => { rehydrated.push(block); return rehydrateOutputsWithStorage(block, outputs, current.runId, demand, storage); },
    });
    console.log(JSON.stringify({ case: variant.name, ok: result.ok, expectedAnswer: expected.derivation.answer,
      restoredAnswer: (result.store.workedExamplePreparation as typeof expected | undefined)?.derivation.answer,
      stages: writes.map((row) => row.status), rehydrated }));
    if (variant.succeeds) {
      assert.equal(result.ok, true, result.error);
      assert.deepEqual(assertWorkedExamplePreparation(result.store.workedExamplePreparation, current), expected);
      assert.deepEqual(writes.map((row) => row.status), ["running", "ok"], "must run current admission, not restore stale success");
      assert.deepEqual(artifacts, [expected], "only current-request artifacts become durable");
      assert.ok(logs.some((line) => line.includes("worked_example_prepare: verified")));
    } else {
      assert.equal(result.ok, false); assert.equal(result.store.workedExamplePreparation, undefined);
      assert.equal(writes.some((row) => row.status === "ok"), false);
      assert.deepEqual(artifacts, []);
    }
    assert.deepEqual(rehydrated, [], "discard cached preparation for recompute, never restore/persist it first");
    assert.deepEqual(variant.cached, before, "old evidence is not mutated or deleted");
    assert.equal(result.costTotal, 0);
  }
  assert.deepEqual(allManifests().filter((manifest) => manifest.block.resumePolicy !== undefined).map((manifest) => manifest.id), ["worked_example_prepare", "worked_example_script"]);
  assert.equal(getManifest("worked_example_prepare")!.retryAndResume.resumePolicy, "recompute_unpaid_deterministic");
}

async function omittedPolicyRestores(paid: boolean): Promise<void> {
  let executed = 0, rehydrated = 0;
  const block: Block = { id: `ordinary_resume_${paid ? "paid" : "unpaid"}`, consumes: [], produces: ["resumeValue"], paid,
    run: async () => { executed += 1; throw new Error("ordinary completed block must not rerun"); } };
  const manifest = manifestFromBlock(block);
  assert.equal(Object.hasOwn(manifest.retryAndResume, "resumePolicy"), false, "omitted policy preserves manifest shape");
  _clear(); registerManifest(manifest);
  const writes: Parameters<RunStageSink["upsert"]>[0][] = [];
  const result = await runPipeline(validatePipeline([{ block: block.id, params: { resumePolicy: "recompute_unpaid_deterministic" } }]), {
    ...base, budgetUsd: 10,
    sink: { async upsert(row) { writes.push(row); }, async getCompleted() { return [{ block: block.id, cost: paid ? 0.37 : 0, outputs: { resumeValue: "retained" } }]; } },
    rehydrate: (id, outputs, demand) => { rehydrated += 1; return rehydrateOutputsWithStorage(id, outputs, current.runId, demand, storage); },
  });
  assert.equal(result.ok, true, result.error); assert.equal(result.store.resumeValue, "retained");
  assert.equal(executed, 0); assert.equal(rehydrated, 1);
  // Serialized/config params cannot opt ordinary blocks into code-owned replay.
  assert.deepEqual(writes.map((row) => row.status), ["ok"]);
  assert.equal(writes[0].cost, undefined, "restore does not overwrite prior paid cost");
  assert.equal(result.costTotal, paid ? 0.37 : 0);
}

async function upstreamInputRehydration(): Promise<void> {
  let sourceRuns = 0, targetRuns = 0;
  const demands: string[][] = [];
  const source: Block = { id: "recompute_input_source", consumes: [], produces: ["resumeInput"], paid: true,
    run: async () => { sourceRuns += 1; throw new Error("paid source must not rerun"); } };
  const target: Block = { id: "recompute_input_target", consumes: ["resumeInput"], produces: ["resumeResult"],
    resumePolicy: "recompute_unpaid_deterministic", run: async (ctx) => {
      targetRuns += 1; assert.equal(ctx.store.resumeInput, "materialized current input"); return { resumeResult: "current result" };
    } };
  _clear(); registerManifest(manifestFromBlock(source)); registerManifest(manifestFromBlock(target));
  const result = await runPipeline(validatePipeline([{ block: source.id }, { block: target.id }]), {
    ...base, budgetUsd: 10,
    sink: { async upsert() {}, async getCompleted() { return [
      { block: source.id, cost: 0.37, outputs: { resumeInput: "not materialized" } },
      { block: target.id, cost: 0, outputs: { resumeResult: "stale result" } },
    ]; } },
    rehydrate: async (block, outputs, demand) => {
      assert.equal(block, source.id, "opted-in target output must not be rehydrated");
      const keys = [...(demand?.neededOutputKeys ?? [])]; demands.push(keys);
      const restored = await rehydrateOutputsWithStorage(block, outputs, current.runId, demand, storage);
      return keys.includes("resumeInput") ? { ...restored, outputs: { ...restored.outputs, resumeInput: "materialized current input" } } : restored;
    },
  });
  assert.equal(result.ok, true, result.error); assert.equal(sourceRuns, 0); assert.equal(targetRuns, 1);
  assert.deepEqual(demands, [[], ["resumeInput"]], "reuse demand-driven cachedFallbackToLocalRun input restoration");
  assert.equal(result.costTotal, 0.37);
}

async function policySafety(): Promise<void> {
  const make = (): Block => ({ id: "recompute_policy_probe", consumes: [], produces: ["probeResult"],
    resumePolicy: "recompute_unpaid_deterministic", run: async () => { throw new Error("policy test must stop before execution"); } });
  for (const effect of ["paid_compute", "external_message", "publish_media", "delete_scoped_artifacts"] as ModuleSideEffect[]) {
    assert.throws(() => assertExecutableManifest(manifestFromBlock(make(), { capabilities: [], sideEffects: [effect] })), /resume policy.*unpaid.*side-effect-free/);
  }
  assert.throws(() => assertExecutableManifest(manifestFromBlock({ ...make(), paid: true })), /resume policy.*unpaid.*side-effect-free/);
  const cases: Array<[string, (manifest: ModuleManifest) => void]> = [
    ["paid manifest", (m) => { m.costAndLatency.paid = true; }],
    ["paid executable", (m) => { m.block.paid = true; }],
    ["external effect", (m) => { m.securityAndSideEffects.effects = ["external_message"]; }],
    ["empty effects", (m) => { m.securityAndSideEffects.effects = []; }],
    ["manifest-only policy", (m) => { delete m.block.resumePolicy; }],
    ["unreflected code policy", (m) => { delete m.retryAndResume.resumePolicy; }],
    ["unknown policy", (m) => { m.block.resumePolicy = "anything" as Block["resumePolicy"]; m.retryAndResume.resumePolicy = m.block.resumePolicy; }],
  ];
  for (const [label, mutate] of cases) {
    const block = make(), manifest = manifestFromBlock(block);
    _clear(); registerManifest(manifest);
    const resolved = validatePipeline([{ block: block.id }]); mutate(manifest);
    let effects = 0;
    await assert.rejects(() => runPipeline(resolved, { ...base,
      sink: { async upsert() { effects += 1; }, async getCompleted() { effects += 1; return []; } },
    }), /resume policy/, label);
    assert.equal(effects, 0, `${label} refused before persistence reads or writes`);
  }
  const block = make(); _clear(); registerManifest(manifestFromBlock(block));
  let remoteCalls = 0;
  await assert.rejects(() => runPipeline(validatePipeline([{ block: block.id }]), {
    ...base, sink: { async upsert() { throw new Error("must not persist"); } },
    remoteBlocks: new Set([block.id]), runRemoteBlock: async () => { remoteCalls += 1; return {}; },
  }), /resume policy.*local/);
  assert.equal(remoteCalls, 0);
}

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { networkCalls += 1; throw new Error("network forbidden"); };
  try {
    await mathResume();
    await omittedPolicyRestores(false); await omittedPolicyRestores(true);
    await upstreamInputRehydration(); await policySafety();
    assert.equal(networkCalls, 0); assert.equal(storageCalls, 0);
    console.log("worked-example resume PASS: stale401→current-175, namespace/corruption controls, unchanged deterministic regeneration, strict policy eligibility, ordinary paid/unpaid restores and demand-driven upstream input restoration; zero network/storage/providers");
  } finally { globalThis.fetch = originalFetch; }
}
void main();
