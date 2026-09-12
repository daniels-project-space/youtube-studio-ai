import assert from "node:assert/strict";
import { manifestFromBlock } from "@/engine/moduleManifest";
import { _clear, registerManifest } from "@/engine/registry";
import { runPipeline } from "@/engine/runner";
import { STAGE_REUSE_RECONCILIATION_MARKER } from "@/engine/stageReuseContract";
import { classifyExecutionError } from "@/engine/executionErrors";
import { planHeal } from "@/engine/healer";
import type { Block, RunStageSink } from "@/engine/types";
import { validatePipeline } from "@/engine/validate";

type Row = Awaited<ReturnType<NonNullable<RunStageSink["getResumeState"]>>>[number];
const options = { ownerId: "reuse-owner", runId: "reuse-run", channelId: "reuse-channel",
  keyPrefix: "owners/reuse/", budgetUsd: 10, defaultRetries: 0 };

function fixture() {
  _clear();
  const calls: string[] = [];
  const artifacts: Array<Parameters<NonNullable<RunStageSink["upsertArtifacts"]>>[0]> = [];
  const rows = new Map<string, Row>();
  const sink: RunStageSink = {
    async upsert(args) {
      const previous = rows.get(args.block) ?? { block: args.block, status: "queued" };
      rows.set(args.block, structuredClone({ ...previous,
        ...Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)) }));
    },
    async getResumeState() { return structuredClone([...rows.values()]); },
    async upsertArtifacts(args) { artifacts.push(structuredClone(args)); },
  };
  const blocks: Block[] = [{
    id: "reuse_review", consumes: ["reviewText"], produces: ["reuseApproved"],
    run: async () => { calls.push("review"); return { reuseApproved: true }; },
  }, {
    id: "reuse_speech", consumes: ["reviewText", "reuseApproved"],
    produces: ["reuseAudioLocalPath", "reuseAudioKey", "reuseTranscript"], paid: true,
    run: async (ctx) => { calls.push("speech"); return { reuseAudioLocalPath: "/first/audio.wav",
      reuseAudioKey: "owners/reuse/audio.wav", reuseTranscript: ctx.store.reviewText, __costUsd: 0.3 }; },
  }, {
    id: "reuse_assembly", consumes: ["reuseAudioLocalPath", "reuseTranscript"], produces: ["reuseAssembly"],
    run: async (ctx) => { calls.push("assembly"); return { reuseAssembly: ctx.store.reuseTranscript }; },
  }];
  for (const block of blocks) registerManifest(manifestFromBlock(block));
  const pipeline = validatePipeline(blocks.map((block) => ({ block: block.id })), ["reviewText"]);
  const rehydrate = async (_id: string, outputs: Record<string, unknown>) => ({ ok: true,
    outputs: { ...outputs, ...(outputs.reuseAudioLocalPath ? { reuseAudioLocalPath: "/second/audio.wav" } : {}) } });
  return { calls, artifacts, rows, sink, blocks, pipeline, rehydrate };
}

async function main() {
  let cases = 0;
  {
    const f = fixture();
    const args = { ...options, sink: f.sink, seedStore: { reviewText: "White plays e4." }, rehydrate: f.rehydrate };
    assert.equal((await runPipeline(f.pipeline, args)).ok, true);
    const originalRows = structuredClone([...f.rows.values()]);
    const originalArtifacts = structuredClone(f.artifacts);
    for (let retry = 0; retry < 2; retry++) {
      const resumed = await runPipeline(f.pipeline, args);
      assert.equal(resumed.ok, true, resumed.error);
      assert.equal(resumed.costTotal, 0.3);
      assert.equal(resumed.store.reuseAudioLocalPath, "/second/audio.wav");
    }
    assert.deepEqual(f.calls, ["review", "speech", "assembly"], "unchanged retries do not repeat work");
    assert.deepEqual(f.artifacts, originalArtifacts, "resume never re-stamps old artifacts with current lineage");
    for (const row of originalRows) {
      assert.deepEqual(f.rows.get(row.block)?.outputs, row.outputs, "original durable paths stay unchanged");
      assert.deepEqual(f.rows.get(row.block)?.reuseReceipt, row.reuseReceipt);
    }
    cases++;
  }
  for (const change of ["text", "params", "output", "receipt", "missing", "restore"] as const) {
    const f = fixture();
    const args = { ...options, sink: f.sink, seedStore: { reviewText: "White plays e4." }, rehydrate: f.rehydrate };
    assert.equal((await runPipeline(f.pipeline, args)).ok, true);
    const savedCount = f.artifacts.length;
    if (change === "output") (f.rows.get("reuse_speech")!.outputs as Record<string, unknown>).reuseTranscript = "Black castles.";
    if (change === "receipt") (f.rows.get("reuse_speech")!.reuseReceipt as Record<string, unknown>).invocationHash = "a".repeat(64);
    if (change === "missing") delete f.rows.get("reuse_speech")!.reuseReceipt;
    const result = await runPipeline(f.pipeline, { ...args,
      ...(change === "text" ? { seedStore: { reviewText: "Black castles." } } : {}),
      ...(change === "params" ? { paramsByBlock: { reuse_speech: { voice: "different" } } } : {}),
      ...(change === "restore" ? { rehydrate: async (_id: string, outputs: Record<string, unknown>) => ({ ok: true,
        outputs: { ...outputs, ...(outputs.reuseTranscript ? { reuseTranscript: "Black castles." } : {}) } }) } : {}),
    });
    assert.equal(result.ok, false, `${change} must not reuse accepted speech`);
    assert.match(result.error ?? "", new RegExp(STAGE_REUSE_RECONCILIATION_MARKER));
    assert.equal(result.costTotal, 0.3);
    assert.equal(f.calls.length, 3, "failure cannot buy a replacement or run downstream work");
    assert.equal(f.artifacts.length, savedCount, "no false new lineage");
    assert.ok(f.rows.get("reuse_speech")?.outputs, "saved output is retained for reconciliation");
    const again = await runPipeline(f.pipeline, args);
    assert.equal(again.ok, false, "failed cache admission cannot become fresh execution next retry");
    assert.equal(f.calls.length, 3);
    assert.equal(classifyExecutionError(new Error(result.error)).kind, "deterministic");
    assert.equal(classifyExecutionError({ message: result.error, status: 503, retryable: true }).kind,
      "deterministic", "transport wrappers cannot override a reconciliation hold");
    assert.equal(planHeal(result.error!, f.blocks), null, "healer cannot auto-supersede a reuse hold");
    cases++;
  }
  {
    const f = fixture();
    f.rows.set("reuse_review", { block: "reuse_review", status: "ok", outputs: { reuseApproved: true } });
    f.rows.set("reuse_speech", { block: "reuse_speech", status: "ok", cost: 0.3,
      outputs: { reuseTranscript: "Black castles.", reuseAudioLocalPath: "/old/audio.wav", reuseAudioKey: "owners/old/audio.wav" } });
    let storageCalls = 0;
    const result = await runPipeline(f.pipeline, { ...options, sink: f.sink,
      seedStore: { reviewText: "White plays e4." },
      rehydrate: async (_id, outputs) => { storageCalls++; return { ok: true, outputs }; } });
    assert.equal(result.ok, false, "the original unproven cached-approval/stale-audio case is rejected");
    assert.equal(storageCalls, 0, "legacy rejection precedes even a storage request");
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.artifacts, []);
    cases++;
  }
  for (const invalidOutput of [null, undefined, "not-an-output-record", []]) {
    const f = fixture();
    f.rows.set("reuse_review", { block: "reuse_review", status: "ok", outputs: invalidOutput });
    const result = await runPipeline(f.pipeline, { ...options, sink: f.sink,
      seedStore: { reviewText: "White plays e4." }, rehydrate: f.rehydrate });
    assert.equal(result.ok, false, "malformed completed rows cannot become a fresh execution");
    assert.match(result.error ?? "", new RegExp(STAGE_REUSE_RECONCILIATION_MARKER));
    assert.deepEqual(f.calls, []);
    cases++;
  }
  {
    _clear();
    const stored: Array<Parameters<RunStageSink["upsert"]>[0]> = [];
    const block: Block = { id: "input_mutator", consumes: ["sourceRecord"], produces: ["accepted"], paid: true,
      run: async (ctx) => { (ctx.store.sourceRecord as { text: string }).text = "Unreviewed replacement";
        return { accepted: true, __costUsd: 0.3 }; } };
    registerManifest(manifestFromBlock(block));
    const result = await runPipeline(validatePipeline([{ block: block.id }], ["sourceRecord"]), {
      ...options, seedStore: { sourceRecord: { text: "Reviewed source" } },
      sink: { async upsert(args) { stored.push(args); }, async upsertArtifacts() { throw new Error("must not persist false lineage"); } },
    });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /mutated its input/);
    assert.equal(result.costTotal, 0.3, "a late mutation hold still records already-observed spend");
    assert.equal(stored.some((stage) => stage.reuseReceipt), false);
    cases++;
  }
  console.log(`STAGE REUSE RUNNER PASS — ${cases} actual runner lifecycle cases, zero provider calls`);
}

void main();
