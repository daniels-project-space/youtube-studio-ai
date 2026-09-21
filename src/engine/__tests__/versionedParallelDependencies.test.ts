import assert from "node:assert/strict";
import { _clear, registerManifest, registerManifestVersion } from "../registry";
import { manifestFromBlock, type ModuleContractOverride } from "../moduleManifest";
import { runPipeline } from "../runner";
import { validatePipeline } from "../validate";
import { COST_PATCH_KEY, type Block, type RunStageSink } from "../types";
import { ExecutionError } from "../executionErrors";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function observed(promise: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("independent sibling did not start")), 2000);
  })]); } finally { clearTimeout(timer); }
}
function manifest(block: Block, overrides: Partial<ModuleContractOverride> = {}) {
  return manifestFromBlock({ ...block, paid: true }, {
    version: "1.0.0", capabilities: [], certification: "contract", maxCostUsd: 0.1,
    providerProfiles: [{ id: "offline-fixture", provider: "fixture", quality: "production", allowFallback: false }],
    ...overrides,
  });
}

async function caseFor(mode: "required" | "optional" | "optional-output" | "capability" | "independent" | "failed" | "three-way") {
  _clear();
  const release = deferred(), firstStarted = deferred(), independentStarted = deferred();
  const starts: string[] = [], completed: string[] = [];
  const rows: Array<Parameters<RunStageSink["upsert"]>[0]> = [];
  let consumerCalls = 0;
  const producer = manifest({ id: "director_brief", consumes: [], produces: ["fixtureCue"], run: async () => {
    starts.push("director_brief"); firstStarted.resolve(); await release.promise;
    if (mode === "failed") throw new ExecutionError("fixture upstream failure", { retryable: false });
    completed.push("director_brief");
    return { fixtureCue: "fresh cue", [COST_PATCH_KEY]: 0.01 };
  } }, { capabilities: ["fixture.cue_ready"], ...(mode === "optional-output" ? { optionalProduces: ["fixtureCue"] } : {}) });
  registerManifest(producer);
  const consumerId = mode === "three-way" ? "editor_brief" : "dp_brief";
  const independent = (id: string) => manifest({ id, consumes: [], produces: [`${id}Result`], run: async () => {
    starts.push(id); independentStarted.resolve();
    return { [`${id}Result`]: "independent", [COST_PATCH_KEY]: 0.01 };
  } });
  registerManifest(independent(consumerId));
  if (mode === "three-way") registerManifest(independent("dp_brief"));
  const needsCue = !["capability", "independent"].includes(mode);
  const optional = ["optional", "failed"].includes(mode);
  const version = "2.0.0-selected";
  registerManifestVersion(manifest({ id: consumerId, consumes: needsCue && !optional ? ["fixtureCue"] : [],
    produces: [`${consumerId}Result`], run: async ctx => {
      starts.push(consumerId); consumerCalls++;
      if (mode === "independent") independentStarted.resolve();
      else assert.ok(completed.includes("director_brief"), "a declared dependency must finish before the selected consumer spends");
      if (needsCue) {
        assert.equal(ctx.store.fixtureCue, "fresh cue");
        assert.equal(ctx.artifactRefs?.fixtureCue.producerModule, "director_brief");
      }
      return { [`${consumerId}Result`]: "selected", [COST_PATCH_KEY]: 0.01 };
    } }, { version, ...(optional ? { optionalConsumes: ["fixtureCue"] } : {}),
    ...(mode === "capability" ? { requiredCapabilities: ["fixture.cue_ready"] } : {}) }));
  const pipeline = validatePipeline([
    { block: "director_brief" }, ...(mode === "three-way" ? [{ block: "dp_brief" }] : []),
    { block: consumerId, version },
  ]);
  const running = runPipeline(pipeline, { ownerId: "fixture", channelId: "fixture-channel", runId: `wave-${mode}`,
    keyPrefix: "owner/fixture/", budgetUsd: 1, defaultRetries: 0,
    sink: { async upsert(row) { rows.push(structuredClone(row)); } } });
  try {
    await observed(firstStarted.promise);
    if (mode === "independent" || mode === "three-way") await observed(independentStarted.promise);
    // Give all scheduled siblings an opportunity to reach their actual body.
    await new Promise(resolve => setImmediate(resolve));
    if (mode !== "independent") assert.equal(consumerCalls, 0, `${mode}: selected consumer is not admitted beside its producer`);
    release.resolve();
    const result = await running;
    if (mode === "failed") {
      assert.equal(result.ok, false); assert.equal(result.failedBlock, "director_brief");
      assert.equal(consumerCalls, 0, "failed optional producer cannot buy a fallback candidate in parallel");
      assert.equal(rows.some(row => row.block === consumerId), false);
    } else {
      assert.equal(result.ok, true, result.error);
      assert.equal(consumerCalls, 1);
      assert.ok(Math.abs(result.costTotal - (mode === "three-way" ? 0.03 : 0.02)) < 1e-10);
      assert.equal(result.store[`${consumerId}Result`], "selected", "exact selected version executes");
      assert.equal(rows.filter(row => row.status === "ok").length, pipeline.blocks.length);
    }
    if (mode === "three-way") assert.deepEqual(starts, ["director_brief", "dp_brief", "editor_brief"]);
  } finally { release.resolve(); await running; }
}

async function reverseOptionalRead() {
  _clear();
  const gate = deferred(), started = deferred();
  let writerCalls = 0;
  registerManifest(manifest({ id: "director_brief", consumes: [], produces: ["fixtureObserved"], run: async ctx => {
    started.resolve(); await gate.promise;
    return { fixtureObserved: ctx.store.fixtureCue, [COST_PATCH_KEY]: 0.01 };
  } }, { optionalConsumes: ["fixtureCue"] }));
  registerManifest(manifest({ id: "dp_brief", consumes: [], produces: ["fixtureCue"], run: async () => {
    writerCalls++; return { fixtureCue: "new cue", [COST_PATCH_KEY]: 0.01 };
  } }));
  const running = runPipeline(validatePipeline([{ block: "director_brief" }, { block: "dp_brief" }], ["fixtureCue"]), {
    ownerId: "fixture", channelId: "fixture-channel", runId: "reverse-wave", keyPrefix: "owner/fixture/", budgetUsd: 1, defaultRetries: 0,
    seedStore: { fixtureCue: "seed cue" }, sink: { async upsert() {} },
  });
  try {
    await observed(started.promise); await new Promise(resolve => setImmediate(resolve));
    assert.equal(writerCalls, 0, "a later writer cannot race an earlier optional reader");
    gate.resolve();
    const result = await running;
    assert.equal(result.ok, true, result.error);
    assert.equal(result.store.fixtureObserved, "seed cue"); assert.equal(result.store.fixtureCue, "new cue");
  } finally { gate.resolve(); await running; }
}

async function main() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("parallel contract test forbids external I/O"); };
  try {
    for (const mode of ["required", "optional", "optional-output", "capability", "independent", "failed", "three-way"] as const) await caseFor(mode);
    await reverseOptionalRead();
    console.log("VERSIONED PARALLEL DEPENDENCIES PASS: eight real-runner cases; selected contracts split unsafe waves, independent work remains concurrent");
  } finally { _clear(); globalThis.fetch = originalFetch; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
