import assert from "node:assert/strict";
import { registerAllBlocks } from "@/engine/blocks";
import { getManifest } from "@/engine/registry";
import { runPipeline } from "@/engine/runner";
import { validatePipeline } from "@/engine/validate";
import { compilePipeline } from "@/engine/pipelineCompiler";
import { draftWorkedExampleNarration, assertWorkedExampleNarrationBinding } from "@/engine/workedExampleNarration";
import { prepareWorkedExample, type WorkedExampleRequest } from "@/engine/workedExample";
import { qaScript, narrationTts } from "@/trigger/blocks/narratedBlocks";
import type { StageContext, RunStageSink } from "@/engine/types";
type MutableContext = Omit<StageContext, "store"> & { store: Record<string, unknown> };

const request: WorkedExampleRequest = {
  policy: "worked-example/integer-v1", ownerId: "owner-a", channelId: "channel-a", runId: "run-a",
  requestId: "request-current", seed: "seed-current", operations: ["multiply", "add"],
};
const preparation = prepareWorkedExample(request);
const draft = draftWorkedExampleNarration(preparation, request);
const base: StageContext = {
  ownerId: request.ownerId, channelId: request.channelId, runId: request.runId,
  keyPrefix: "owners/owner-a/", budgetUsd: 1, params: {}, log: () => {},
  store: { workedExampleRequest: request, workedExamplePreparation: preparation, ...draft },
};

async function main() {
  registerAllBlocks();
  const originalFetch = globalThis.fetch, originalKey = process.env.OPENROUTER_API_KEY;
  let calls = 0, accept = true;
  try {
    process.env.OPENROUTER_API_KEY = "fixture-only-never-sent";
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions", "no TTS, storage or database request is permitted");
      const body = JSON.parse(String(init?.body));
      assert.match(body.messages.at(-1).content, /^Critique this YouTube narration for quality/);
      assert.equal(body.max_tokens, 2500); assert.equal(body.temperature, 0.3);
      calls += 1;
      return Response.json({ choices: [{ message: { content: JSON.stringify({ pass: accept, issues: accept ? [] : ["The explanation is too mechanical."] }) } }], usage: { cost: 0.003 } });
    };
    const manifest = getManifest("worked_example_script")!;
    assert.deepEqual(Object.keys(manifest.consumes), ["workedExampleRequest", "workedExamplePreparation"]);
    assert.deepEqual(Object.keys(manifest.produces), ["script", "narrationText"]);
    assert.equal(manifest.costAndLatency.paid, false); assert.equal(manifest.costAndLatency.maxCostUsd, 0);
    assert.deepEqual(manifest.securityAndSideEffects.effects, ["none"]);
    assert.equal(manifest.retryAndResume.resumePolicy, "recompute_unpaid_deterministic");
    assert.equal(manifest.certification.status, "contract");
    assert.equal(preparation.derivation.answer, "-175");
    assert.equal(draft.script.sections.at(-1)!.narration, "The answer is negative one hundred seventy five.");
    assert.equal(draft.script.hook, preparation.projection.problemSpeech);
    assert.deepEqual(draft.script.sections.slice(0, -1).map((section) => section.narration), preparation.projection.steps.map((step) => step.speech));
    assert.equal(draft.narrationText, draft.script.narrationText);
    assert.equal(Object.hasOwn(draft, "scriptApproved"), false);

    const entries = [{ block: "worked_example_prepare" }, { block: "worked_example_script" }];
    const stageWrites: Parameters<RunStageSink["upsert"]>[0][] = [];
    const opts = { ...base, defaultRetries: 0, budgetUsd: 0, seedStore: { workedExampleRequest: request },
      sink: { async upsert(row: Parameters<RunStageSink["upsert"]>[0]) { stageWrites.push(row); } } };
    const result = await runPipeline(validatePipeline(entries, ["workedExampleRequest"]), opts);
    assert.equal(result.ok, true, result.error); assert.equal(result.costTotal, 0); assert.equal(calls, 0);
    assert.deepEqual(result.store.script, draft.script); assert.equal(result.store.narrationText, draft.narrationText);
    assert.equal(result.store.scriptApproved, undefined);
    assert.deepEqual(stageWrites.filter((row) => row.status === "ok").map((row) => row.block), entries.map((entry) => entry.block));
    assert.throws(() => validatePipeline([...entries, { block: "script_gen" }], ["workedExampleRequest", "topic"]), /duplicate producer/);
    assert.throws(() => validatePipeline([...entries, { block: "narration_tts" }], ["workedExampleRequest"]), /scriptApproved/);
    assert.throws(() => compilePipeline(validatePipeline(entries, ["workedExampleRequest"])), /worked-example modules are registered private-review foundations only/, "a held adapter pair is not an admitted production pipeline");

    // Known-current draft reaches the UNCHANGED actual independent critic. Its response
    // is a transport fixture, not a claim about the real draft's editorial quality.
    const approval = await qaScript.run({ ...base, store: result.store });
    assert.equal(approval.scriptApproved, true);
    assert.equal((approval.workedExampleEditorialApproval as { preparationFingerprint: string }).preparationFingerprint, preparation.fingerprint);
    assert.equal(calls, 1);
    accept = false;
    const rejected = await runPipeline(validatePipeline([...entries, { block: "qa_script" }, { block: "narration_tts" }], ["workedExampleRequest"]), { ...opts, budgetUsd: 1 });
    assert.equal(rejected.ok, false); assert.match(rejected.error ?? "", /narration failed craft-quality critique/);
    assert.equal(rejected.store.scriptApproved, undefined);
    assert.equal(stageWrites.some((row) => row.block === "narration_tts"), false);
    assert.equal(calls, 2); assert.ok(rejected.costTotal > 0);
    accept = true;

    const corruptions: Array<(ctx: MutableContext) => void> = [
      (ctx) => { ctx.store.narrationText = "Two plus two equals five."; },
      (ctx) => { (ctx.store.script as typeof draft.script).sections[0].narration = "Two plus two equals five."; },
      (ctx) => { (ctx.store.script as typeof draft.script).hook = "An unrelated story."; },
      (ctx) => { (ctx.store.script as typeof draft.script).estDurationSec = 99_999; },
      (ctx) => { (ctx.store.script as typeof draft.script).workedExamplePreparationFingerprint = "0".repeat(64); },
      (ctx) => { delete ctx.store.workedExamplePreparation; },
      (ctx) => { delete ctx.store.workedExampleRequest; },
      (ctx) => { delete ctx.store.script; },
      (ctx) => { ctx.ownerId = "foreign-owner"; },
      (ctx) => { ctx.channelId = "foreign-channel"; },
      (ctx) => { ctx.runId = "foreign-run"; },
      (ctx) => { (ctx.store.workedExampleRequest as WorkedExampleRequest).seed = "changed-seed"; },
      (ctx) => { (ctx.store.workedExamplePreparation as typeof preparation).derivation.answer = "999"; },
      (ctx) => { ctx.store.script = { ...(ctx.store.script as object), workedExampleNarrationVersion: "unknown" }; },
      (ctx) => { const script = { ...(ctx.store.script as Record<string, unknown>) }; delete script.workedExampleNarrationVersion; delete script.workedExamplePreparationFingerprint; ctx.store.script = script; },
    ];
    for (const mutate of corruptions) {
      const ctx: MutableContext = { ...base, store: structuredClone(base.store) };
      ctx.store.scriptApproved = true; mutate(ctx);
      const before: number = calls;
      await assert.rejects(() => qaScript.run(ctx));
      await assert.rejects(() => narrationTts.run(ctx));
      assert.equal(calls, before, "both actual consumers reject stale/altered math before any provider call");
    }
    // A marked script cannot become an ordinary one by omitting its proof inputs.
    assert.throws(() => assertWorkedExampleNarrationBinding({ ...base, request: undefined, preparation: undefined, script: draft.script, narrationText: draft.narrationText }));
    assert.doesNotThrow(() => assertWorkedExampleNarrationBinding({ ...base, request: undefined, preparation: undefined, script: { hook: "A different channel." }, narrationText: "Ordinary narration." }));

    // Real adapter resume must rebuild current script, never restore an older answer.
    const staleRequest = { ...request, requestId: "request-stale", seed: "seed-stale" };
    const stale = draftWorkedExampleNarration(prepareWorkedExample(staleRequest), staleRequest);
    assert.notEqual(stale.narrationText, draft.narrationText);
    let restored = 0;
    const resumed = await runPipeline(validatePipeline([{ block: "worked_example_script" }], ["workedExampleRequest", "workedExamplePreparation"]), {
      ...opts, seedStore: { workedExampleRequest: request, workedExamplePreparation: preparation },
      sink: { async upsert() {}, async getCompleted() { return [{ block: "worked_example_script", outputs: stale, cost: 0 }]; } },
      rehydrate: async (_block, outputs) => { restored += 1; return { ok: true, outputs }; },
    });
    assert.equal(resumed.ok, true, resumed.error); assert.deepEqual(resumed.store.script, draft.script);
    assert.equal(restored, 0); assert.equal(resumed.costTotal, 0); assert.equal(calls, 2);

    // A resumed legacy Boolean or another derivation's approval cannot authorize
    // fresh paid speech. Exercise the actual TTS entry, before provider selection.
    for (const cachedApproval of [undefined, { ...approval.workedExampleEditorialApproval as object, preparationFingerprint: "0".repeat(64) }]) {
      await assert.rejects(() => narrationTts.run({ ...base, store: { ...base.store, scriptApproved: true, workedExampleEditorialApproval: cachedApproval } }), /editorial approval does not match the current script/);
    }
    const voiceContext = { ...base, params: { ttsProvider: "fixture-provider-must-not-exist" }, store: { ...base.store, ...approval } };
    await assert.rejects(() => narrationTts.run(voiceContext), /TTS provider|ttsProvider|tts provider/,
      "matching independently produced approval reaches the unchanged provider-selection boundary");
    await assert.rejects(() => runPipeline(validatePipeline([...entries, { block: "qa_script" }, { block: "narration_tts" }], ["workedExampleRequest"]), {
      ...opts, budgetUsd: 1, sink: { async upsert() {}, async getCompleted() { return [{ block: "qa_script", outputs: { scriptApproved: true }, cost: 0.003 }]; } },
      rehydrate: async (_block, outputs) => ({ ok: true, outputs }),
    }), { code: "CACHED_OUTPUT_BINDING_REFUSED", message: /editorial approval does not match the current script/ });
    assert.equal(calls, 2, "cached legacy approval is held before TTS, not silently approved or re-bought");
    console.log(JSON.stringify({ actualRegisteredAdapter: "PASS", independentCriticAdmission: "PASS", tamperCasesBeforeBothConsumers: corruptions.length,
      duplicateWriterAndUnapprovedTtsRefused: true, actualResume: "PASS", productionCatalog: "held", fixtureCriticCalls: calls, liveProviderCalls: 0 }));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
