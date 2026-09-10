import assert from "node:assert/strict";
import { registerAllBlocks } from "@/engine/blocks";
import { artifactContract, validateArtifact } from "@/engine/artifactSchemas";
import { _clear, allManifests, getManifest, registerManifest } from "@/engine/registry";
import { manifestFromBlock } from "@/engine/moduleManifest";
import { runPipeline } from "@/engine/runner";
import { validatePipeline } from "@/engine/validate";
import { compilePipeline } from "@/engine/pipelineCompiler";
import { designPipeline } from "@/engine/designer";
import { ARCHETYPES } from "@/engine/archetypes";
import { FAMILIES, familyDurationContract, type FamilyKey } from "@/engine/families";
import { assertWorkedExamplePreparation, type WorkedExampleRequest } from "@/engine/workedExample";
import type { Block, RunStageSink } from "@/engine/types";

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls += 1; throw new Error("provider/network calls forbidden by worked-example test"); };
  try {
    registerAllBlocks();
    const manifest = getManifest("worked_example_prepare")!;
    assert.ok(manifest);
    assert.deepEqual(Object.keys(manifest.consumes), ["workedExampleRequest"]);
    assert.deepEqual(Object.keys(manifest.produces), ["workedExamplePreparation"]);
    assert.equal(manifest.costAndLatency.paid, false);
    assert.equal(manifest.costAndLatency.maxCostUsd, 0);
    assert.deepEqual(manifest.securityAndSideEffects.effects, ["none"]);
    assert.equal(manifest.certification.status, "contract", "ABI only, never Golden/catalog qualification");
    for (const key of ["workedExampleRequest", "workedExamplePreparation"]) assert.equal(artifactContract(key).opaque, false);

    const request: WorkedExampleRequest = {
      policy: "worked-example/integer-v1", ownerId: "owner-test", channelId: "channel-test",
      runId: "run-test", requestId: "request-test", seed: "generated-real-caller",
      operations: ["multiply", "add", "subtract", "exact_divide"],
    };
    let consumed = 0;
    const consumer: Block = {
      id: "audit_worked_example_consumer", consumes: ["workedExamplePreparation", "workedExampleRequest"], produces: [],
      run: async (ctx) => {
        assertWorkedExamplePreparation(ctx.store["workedExamplePreparation"], ctx.store["workedExampleRequest"]);
        consumed += 1;
        return {};
      },
    };
    registerManifest(manifestFromBlock(consumer));
    const writes: Array<{ block: string; status: string }> = [];
    const sink: RunStageSink = { async upsert(row) { writes.push({ block: row.block, status: row.status }); } };
    const opts = {
      ownerId: request.ownerId, channelId: request.channelId, runId: request.runId,
      keyPrefix: "owners/owner-test/", budgetUsd: 0, sink, defaultRetries: 0,
      seedStore: { workedExampleRequest: request },
    };
    const entries = [{ block: "worked_example_prepare" }, { block: consumer.id }];
    const result = await runPipeline(validatePipeline(entries, ["workedExampleRequest"]), opts);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.costTotal, 0); assert.equal(consumed, 1);
    assert.deepEqual(writes.filter((row) => row.status === "ok").map((row) => row.block), ["worked_example_prepare", consumer.id]);
    assert.deepEqual(Object.keys(result.store).sort(), ["workedExamplePreparation", "workedExampleRequest"]);
    const prepared = assertWorkedExamplePreparation(result.store["workedExamplePreparation"], request);
    assert.deepEqual(validateArtifact(artifactContract("workedExamplePreparation"), prepared), prepared);
    const retry = await runPipeline(validatePipeline(entries, ["workedExampleRequest"]), opts);
    assert.equal(retry.ok, true, retry.error);
    assert.deepEqual(retry.store.workedExamplePreparation, prepared, "unpaid fresh retry has identical request-bound bytes");

    for (const changedRequest of [{ ...request, policy: "unsupported" }, { ...request, ownerId: "foreign-owner" }, { ...request, channelId: "foreign-channel" }, { ...request, runId: "foreign-run" }]) {
      const priorConsumed: number = consumed;
      const bad = await runPipeline(validatePipeline(entries, ["workedExampleRequest"]), { ...opts, seedStore: { workedExampleRequest: changedRequest } });
      assert.equal(bad.ok, false); assert.equal(bad.costTotal, 0); assert.equal(consumed, priorConsumed);
      assert.equal(Object.hasOwn(bad.store, "workedExamplePreparation"), false);
    }
    const invalidParams = await runPipeline(validatePipeline([{ block: "worked_example_prepare", params: { private: true } }], ["workedExampleRequest"]), opts);
    assert.equal(invalidParams.ok, false, "no guessed configuration/private-context switch");

    // Real runner input validation must reject the typed artifact BEFORE entering its
    // consumer. A separate stale-request test exercises the mandatory external binding.
    const corrupt = structuredClone(prepared); corrupt.derivation.steps[0].result = "999999";
    const priorConsumed: number = consumed;
    const corruptResult = await runPipeline(validatePipeline([{ block: consumer.id }], ["workedExamplePreparation", "workedExampleRequest"]), {
      ...opts, seedStore: { workedExamplePreparation: corrupt, workedExampleRequest: request },
    });
    assert.equal(corruptResult.ok, false); assert.equal(consumed, priorConsumed);
    const staleResult = await runPipeline(validatePipeline([{ block: consumer.id }], ["workedExamplePreparation", "workedExampleRequest"]), {
      ...opts, seedStore: { workedExamplePreparation: prepared, workedExampleRequest: { ...request, requestId: "new-request" } },
    });
    assert.equal(staleResult.ok, false); assert.match(staleResult.error ?? "", /different request or namespace/);

    assert.throws(() => validatePipeline([{ block: "worked_example_prepare" }, { block: "narration_tts" }], ["workedExampleRequest"]), /narrationText/);
    const design = designPipeline({ family: "illustrated_explainer", nicheKey: "history", lengthMinutes: 5, publishMode: "draft" });
    assert.equal(design.available, true);
    const compilation = compilePipeline(validatePipeline(design.pipeline));
    assert.equal(compilation.bindings.narration_tts.scriptApproved, "qa_script:scriptApproved");
    assert.equal(compilation.bindings.narration_tts.narrationText, "script_gen:narrationText");
    const noQa = design.pipeline.filter((entry) => entry.block !== "qa_script");
    assert.throws(() => validatePipeline(noQa), /scriptApproved/);
    assert.throws(() => compilePipeline(validatePipeline(noQa, ["scriptApproved"])), /script.qa_passed|certify its script/,
      "even a seeded approval value cannot replace the actual compiler QA capability");
    const lateQa = [...noQa, { block: "qa_script" }];
    assert.throws(() => validatePipeline(lateQa), /scriptApproved/);
    assert.throws(() => validatePipeline([{ block: "script_gen" }, { block: "script_gen" }], ["topic"]), /duplicate producer/);
    assert.throws(() => compilePipeline(validatePipeline([{ block: "worked_example_prepare" }, ...design.pipeline], ["workedExampleRequest"])), /worked-example modules are registered private-review foundations only/,
      "held registration must not accidentally admit this module to the production compiler");

    for (const archetype of Object.values(ARCHETYPES)) assert.ok(archetype.pipeline.every((entry) => entry.block !== "worked_example_prepare"));
    const designs = () => Object.keys(FAMILIES).map((family) => designPipeline({
      family: family as FamilyKey, nicheKey: "history", publishMode: "draft",
      lengthMinutes: familyDurationContract(family as FamilyKey).defaultSeconds / 60,
    }));
    const withRegistration = designs();
    const ordinary = allManifests().filter((item) => item.id !== manifest.id && item.id !== consumer.id);
    _clear(); for (const item of ordinary) registerManifest(item);
    assert.deepEqual(designs(), withRegistration, "additive registration must not change any ordinary family design/compilation");
    assert.equal(networkCalls, 0);
    console.log(JSON.stringify({ registeredCaller: "worked_example_prepare", strictArtifactConsumer: "PASS", qaBeforeTtsCompiler: "PASS", noCatalogAdmission: "PASS", ordinaryFamiliesUnchanged: withRegistration.length, deterministicRetry: "PASS", providerCalls: networkCalls, costUsd: result.costTotal }, null, 2));
  } finally { globalThis.fetch = originalFetch; }
}
void main();
