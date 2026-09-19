import assert from "node:assert/strict";
import { checkpointCostReceiptId, observeCheckpointCostReceipt, type CheckpointCostReceipt } from "@/lib/checkpointCostAccounting";
import { reconcileInlineCheckpoint, reconcileInlineCheckpointCosts, verifiedInlineCheckpoint, verifiedInlineCostEvidence, type InlineCheckpointBinding, type VerifiedInlineCheckpoint } from "../inlineCheckpointAdmission";
import { manifestFromBlock } from "../moduleManifest";
import { _clear, registerManifest } from "../registry";
import { runPipeline, type RunPipelineOptions } from "../runner";
import { COST_PATCH_KEY, type Block, type RunStageSink } from "../types";
import { validatePipeline } from "../validate";

const binding: InlineCheckpointBinding = { ownerId: "owner", channelId: "channel", runId: "run", keyPrefix: "fixture/",
  moduleId: "inline_fixture", moduleVersion: "test-1", inputFingerprint: "a".repeat(64) };
const receipt = (name: string, costUsd: number): CheckpointCostReceipt => ({ id: checkpointCostReceiptId("fixture", name), costUsd });
const old = receipt("old", 0.03), fresh = receipt("fresh", 0.02);
const proof = (kind: VerifiedInlineCheckpoint["kind"] = "continuable", receipts = [old], bound = binding) =>
  verifiedInlineCheckpoint(bound, { kind, receipts, ledgerFingerprint: kind === "fresh" ? null : "b".repeat(64) });
const prior = { status: "running", costUsd: 0.03, receipts: [old] };
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
function pureCases() {
  let result = reconcileInlineCheckpoint(binding, proof(), prior, 0.05);
  near(result.priorCostUsd, 0.03); near(result.reservationCreditUsd, 0.03); assert.equal(result.needsPersistence, false);
  result = reconcileInlineCheckpoint(binding, proof(), { ...prior, costUsd: 0, receipts: [] }, 0.05);
  near(result.discoveredCostUsd, 0.03); assert.equal(result.needsPersistence, true);
  result = reconcileInlineCheckpoint(binding, proof("restorable"), prior, 0.05);
  near(result.reservationCreditUsd, 0.05); near(result.priorCostUsd, 0.03);
  result = reconcileInlineCheckpoint(binding, proof(), { ...prior, costUsd: 0.07, receipts: [old, receipt("other-execution", 0.04)] }, 0.05);
  near(result.priorCostUsd, 0.07); near(result.reservationCreditUsd, 0.03);
  near(reconcileInlineCheckpoint(binding, proof(), { ...prior, costUsd: 0.04 }, 0.05).priorCostUsd, 0.04);
  assert.equal(reconcileInlineCheckpoint(binding, proof("fresh", []), undefined, 0.05).needsPersistence, false);
  for (const kind of ["running", "failed", "ok", "superseded"]) {
    assert.throws(() => reconcileInlineCheckpoint(binding, proof("fresh", []), { status: kind, costUsd: 0, receipts: [] }, 0.05), /no matching checkpoint/);
  }
  for (const key of Object.keys(binding) as (keyof InlineCheckpointBinding)[]) {
    const foreign = { ...binding, [key]: key === "inputFingerprint" ? "c".repeat(64) : "foreign" };
    assert.throws(() => reconcileInlineCheckpoint(binding, proof("continuable", [old], foreign), prior, 0.05), /different inputs, module or run/);
  }
  const original = proof();
  for (const copy of [JSON.parse(JSON.stringify(original)), { ...original }]) {
    assert.throws(() => reconcileInlineCheckpoint(binding, copy, prior, 0.05), /unverified\/serialized/);
  }
  assert.ok(Object.isFrozen(original) && Object.isFrozen(original.binding) && Object.isFrozen(original.receipts[0]));
  for (const value of [NaN, Infinity, -1]) {
    assert.throws(() => proof("continuable", [receipt("bad", value)]), /invalid checkpoint amount/);
    assert.throws(() => reconcileInlineCheckpoint(binding, original, { ...prior, costUsd: value }, 0.05), /invalid checkpoint amount/);
  }
  for (const value of [0, NaN, Infinity, -1]) assert.throws(() => reconcileInlineCheckpoint(binding, original, prior, value));
  assert.throws(() => proof("continuable", [old, old]), /duplicated/);
  assert.throws(() => proof("fresh", [old]), /ledger identity/);
  assert.throws(() => reconcileInlineCheckpoint(binding, original, { ...prior, costUsd: 0.02 }, 0.05), /exceed prior/);
  assert.throws(() => reconcileInlineCheckpoint(binding, original, { ...prior, receipts: [{ ...old, costUsd: 0.02 }] }, 0.05), /amount changed/);
  assert.throws(() => reconcileInlineCheckpoint(binding, original, { ...prior, receipts: [] }, 0.05), /unattributed historical/);
  assert.throws(() => reconcileInlineCheckpoint(binding, original, { ...prior, receipts: [receipt("same-dollars-not-same-work", 0.03)] }, 0.02), /exceeds its admitted/);
  result = reconcileInlineCheckpoint(binding, original, { ...prior, receipts: [receipt("different", 0.03)] }, 0.05);
  near(result.priorCostUsd, 0.06); near(result.discoveredCostUsd, 0.03);
  const many = Array.from({ length: 256 }, (_, i) => receipt(String(i), 0));
  assert.throws(() => proof("continuable", [...many, old]), /receipt count/);
  assert.throws(() => reconcileInlineCheckpoint(binding, original, { ...prior, costUsd: 0, receipts: many }, 0.05), /union limit/);
  const costsOnly = verifiedInlineCostEvidence(binding, { ledgerFingerprint: "c".repeat(64), receipts: [old], reason: "unknown package response" });
  const known = reconcileInlineCheckpointCosts(binding, costsOnly, undefined);
  near(known.priorCostUsd, 0.03); assert.equal("reservationCreditUsd" in known, false);
  assert.throws(() => reconcileInlineCheckpoint(binding, costsOnly, undefined, 100), /cost-only evidence cannot authorize/);
  near(reconcileInlineCheckpointCosts(binding, costsOnly, prior).discoveredCostUsd, 0);
  assert.throws(() => reconcileInlineCheckpointCosts(binding, JSON.parse(JSON.stringify(costsOnly)), undefined), /unverified\/serialized/);
  assert.throws(() => reconcileInlineCheckpointCosts({ ...binding, runId: "other" }, costsOnly, undefined), /different inputs/);
  assert.throws(() => reconcileInlineCheckpointCosts(binding, costsOnly, { ...prior, receipts: [] }), /unattributed historical/);
  for (const invalid of [{ reason: "", receipts: [old] }, { reason: "held", receipts: [] }]) {
    assert.throws(() => verifiedInlineCostEvidence(binding, { ...invalid, ledgerFingerprint: "c".repeat(64) }));
  }
}

type Row = NonNullable<Awaited<ReturnType<NonNullable<RunStageSink["getResumeState"]>>>>[number];
async function engineCase(config: {
  initial?: Row; kind?: VerifiedInlineCheckpoint["kind"]; receipts?: CheckpointCostReceipt[];
  budget?: number; envelope?: number; future?: number; restoredOnly?: boolean;
  inspect?: Block["inspectPaidInlineResume"]; noAdapter?: boolean; failPersistence?: boolean;
  options?: Partial<RunPipelineOptions>; id?: string;
} = {}) {
  _clear();
  const events: string[] = [], rows = new Map<string, Row>();
  if (config.initial) rows.set(config.initial.block, structuredClone(config.initial));
  const sink: RunStageSink = {
    getResumeState: async () => structuredClone([...rows.values()]),
    upsert: async (args) => {
      if (args.checkpointCostReceipts?.length && args.status === "running") {
        events.push("persist-receipts");
        if (config.failPersistence) throw new Error("receipt persistence unavailable");
      }
      rows.set(args.block, { ...(rows.get(args.block) ?? { block: args.block, status: "queued" }),
        ...Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)) });
    },
  };
  const block: Block = { id: config.id ?? binding.moduleId, paid: true, consumes: ["fixtureInput"], produces: ["fixtureOutput"],
    ...(config.noAdapter ? {} : { inspectPaidInlineResume: config.inspect ?? (async (ctx) => {
      events.push("inspect");
      assert.ok(Object.isFrozen(ctx) && Object.isFrozen(ctx.params) && Object.isFrozen(ctx.store.fixtureInput));
      assert.deepEqual(Object.keys(ctx.store), ["fixtureInput"]);
      assert.throws(() => ctx.store.undeclared, /undeclared/);
      assert.equal("log" in ctx, false); assert.equal("assertInlinePaidExecutionLease" in ctx, false);
      return proof(config.kind ?? "continuable", config.receipts ?? [old], ctx.binding);
    }) }),
    run: async (ctx) => {
      events.push("body");
      ctx.assertRemainingBudgetReservation!();
      for (const row of config.receipts ?? [old]) observeCheckpointCostReceipt(row, true);
      if (!config.restoredOnly) { events.push("purchase"); observeCheckpointCostReceipt(fresh, false); }
      return { fixtureOutput: "saved", [COST_PATCH_KEY]: (config.receipts ?? [old]).reduce((sum, r) => sum + r.costUsd, 0) + (config.restoredOnly ? 0 : fresh.costUsd) };
    },
  };
  registerManifest(manifestFromBlock(block, { capabilities: [], maxCostUsd: config.envelope ?? 0.05 }));
  const entries = [{ block: block.id }];
  if (config.future !== undefined) {
    const future: Block = { id: "future_inline_fixture", consumes: [], produces: [], paid: true,
      run: async () => { events.push("future"); return { [COST_PATCH_KEY]: config.future }; } };
    registerManifest(manifestFromBlock(future, { capabilities: [], maxCostUsd: config.future })); entries.push({ block: future.id });
  }
  const result = await runPipeline(validatePipeline(entries, ["fixtureInput"]), { ownerId: binding.ownerId,
    channelId: binding.channelId, runId: binding.runId, keyPrefix: binding.keyPrefix, budgetUsd: config.budget ?? 0.05,
    seedStore: { fixtureInput: { nested: [1, 2] }, undeclared: "hidden" }, sink, defaultRetries: 0, ...config.options });
  return { result, events, rows };
}

async function main() {
  pureCases();
  const initial: Row = { block: binding.moduleId, status: "running", cost: 0.03, checkpointCostReceipts: [old] };
  let h = await engineCase({ initial });
  assert.equal(h.result.ok, true, h.result.error); near(h.result.costTotal, 0.05);
  assert.deepEqual(h.events, ["inspect", "body", "purchase"]); near(h.rows.get(binding.moduleId)!.cost!, 0.05);
  h = await engineCase({ initial: { ...initial, cost: 0, checkpointCostReceipts: [] } });
  assert.equal(h.result.ok, true, h.result.error); near(h.result.costTotal, 0.05);
  assert.deepEqual(h.events, ["inspect", "persist-receipts", "body", "purchase"]);
  h = await engineCase({ initial, budget: 0.03, kind: "restorable", restoredOnly: true });
  assert.equal(h.result.ok, true, h.result.error); near(h.result.costTotal, 0.03); assert.ok(!h.events.includes("purchase"));
  h = await engineCase({ kind: "fresh", receipts: [] });
  assert.equal(h.result.ok, true, h.result.error); near(h.result.costTotal, 0.02);
  h = await engineCase({ initial, future: 0.02, budget: 0.07 });
  assert.equal(h.result.ok, true, h.result.error); near(h.result.costTotal, 0.07);
  assert.equal(h.events.filter((e) => e === "inspect").length, 1);
  h = await engineCase({ initial, future: 0.02 });
  assert.equal(h.result.ok, false); assert.match(h.result.error!, /remaining reserved/); assert.ok(!h.events.includes("purchase"));
  for (const config of [
    { initial, budget: 0.04 }, { initial, noAdapter: true }, { initial, kind: "fresh" as const, receipts: [] },
    { initial, options: { resume: false } }, { initial, budget: 0 }, { initial, budget: Infinity },
    { options: { sink: { upsert: async () => {} } } },
    { options: { remoteBlocks: new Set([binding.moduleId]) } },
    { initial, budget: NaN }, { initial, envelope: 0 },
    { initial: { ...initial, cost: 0, checkpointCostReceipts: [] }, failPersistence: true },
    { id: "intro_card" }, { inspect: async (ctx) => ({ ...proof("continuable", [old], ctx.binding) }) },
    { inspect: async () => { throw new Error("R2 unavailable"); } },
    { inspect: async (ctx) => { (ctx.store.fixtureInput as { nested: number[] }).nested.push(3); return proof("continuable", [old], ctx.binding); } },
  ] satisfies Parameters<typeof engineCase>[0][]) {
    h = await engineCase(config);
    assert.equal(h.result.ok, false, JSON.stringify(config)); assert.ok(!h.events.includes("body"));
    assert.ok(!h.events.includes("purchase"));
  }
  h = await engineCase({ initial: { ...initial, cost: 0, checkpointCostReceipts: [] }, budget: 0.04 });
  assert.equal(h.result.ok, false); near(h.result.costTotal, 0.03);
  near(h.rows.get(binding.moduleId)!.cost!, 0.03); assert.deepEqual(h.events, ["inspect", "persist-receipts"]);
  h = await engineCase({ initial: { ...initial, cost: 0, checkpointCostReceipts: [] }, failPersistence: true });
  assert.equal(h.result.ok, false); near(h.result.costTotal, 0.03);
  assert.equal(h.rows.get(binding.moduleId)!.cost, 0, "failed persistence is not claimed durable");
  assert.deepEqual(h.events, ["inspect", "persist-receipts"]);
  const mutableInput = { nested: [1, 2] };
  h = await engineCase({ options: { seedStore: { fixtureInput: mutableInput } }, inspect: async (ctx) => {
    mutableInput.nested.push(3);
    return proof("continuable", [old], ctx.binding);
  } });
  assert.equal(h.result.ok, false); assert.match(h.result.error!, /inputs changed during inspection/);
  assert.ok(!h.events.includes("body"));
  for (const budget of [0, 0.02, 0.05, Infinity, NaN]) {
    h = await engineCase({ budget, inspect: async (ctx) => verifiedInlineCostEvidence(ctx.binding,
      { ledgerFingerprint: "d".repeat(64), receipts: [old], reason: "unknown accepted operation" }) });
    assert.equal(h.result.ok, false); near(h.result.costTotal, 0.03); assert.deepEqual(h.events, []);
    const row = h.rows.get(binding.moduleId)!;
    assert.equal(row.status, "failed"); near(row.cost!, 0.03);
    assert.deepEqual(row.checkpointCostReceipts, [old]); assert.match(row.error!, /RECONCILIATION_REQUIRED.*unknown accepted/);
  }
  h = await engineCase({ initial, inspect: async (ctx) => verifiedInlineCostEvidence(ctx.binding,
    { ledgerFingerprint: "d".repeat(64), receipts: [old], reason: "still held" }) });
  near(h.result.costTotal, 0.03); assert.equal(h.result.ok, false); assert.deepEqual(h.events, []);
  console.log("Inline checkpoint admission: exact receipt reconciliation, frozen bindings, durable-before-purchase recovery, remaining reservations and fail-closed cases passed (no external calls)");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
