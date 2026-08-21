/**
 * Engine integration test (Phase-1 acceptance, runnable via tsx).
 *
 * Exercises REAL behavior end-to-end (no mocks-of-itself):
 *   POSITIVE: register echo_seed + echo_sink, validate + run the 2-block
 *             pipeline, assert echo_sink genuinely received the "topic"
 *             produced by echo_seed and emitted a "marker".
 *   NEGATIVE: a pipeline whose block consumes a key never produced upstream
 *             MUST fail validatePipeline (loud), and a block that lies about
 *             its `produces` MUST fail the runner's no-silent-fallback guard.
 *
 * Uses an in-memory RunStageSink so the runner's persistence path is exercised
 * (we assert the recorded stage transitions), without needing a live Convex.
 */
import assert from "node:assert/strict";
import { _resetBlocks, registerAllBlocks } from "@/engine/blocks";
import { register } from "@/engine/registry";
import { echoSeed, echoSink } from "@/trigger/blocks/echoBlocks";
import {
  validatePipeline,
  preflight,
  PipelineValidationError,
  PreflightError,
} from "@/engine/validate";
import { runPipeline } from "@/engine/runner";
import { allManifests } from "@/engine/registry";
import { configuredMaxCostUsd } from "@/engine/moduleManifest";
import { COST_PATCH_KEY, type Block, type RunStageSink } from "@/engine/types";

interface Recorded {
  block: string;
  status: string;
  outputs?: unknown;
  cost?: number;
  error?: string;
}

function memSink(): { sink: RunStageSink; rows: Recorded[] } {
  const rows: Recorded[] = [];
  return {
    rows,
    sink: {
      async upsert(a) {
        rows.push({
          block: a.block,
          status: a.status,
          outputs: a.outputs,
          cost: a.cost,
          error: a.error,
        });
      },
    },
  };
}

async function positive(): Promise<void> {
  _resetBlocks();
  registerAllBlocks();
  register(echoSeed);
  register(echoSink);

  const entries = [
    { block: "echo_seed", params: { topic: "rainy night jazz" } },
    { block: "echo_sink" },
  ];
  const resolved = validatePipeline(entries);
  preflight(resolved, { budgetUsd: 0 }); // no paid blocks → 0 budget is fine

  const { sink, rows } = memSink();
  const result = await runPipeline(resolved, {
    ownerId: "owner_test",
    runId: "run_test_pos",
    channelId: "chan_test",
    keyPrefix: "owner/owner_test/channel/test/",
    budgetUsd: 0,
    paramsByBlock: { echo_seed: { topic: "rainy night jazz" } },
    sink,
  });

  assert.equal(result.ok, true, "pipeline should succeed");
  assert.equal(result.store["topic"], "rainy night jazz", "topic carried in store");
  assert.equal(
    result.store["marker"],
    "seen:rainy night jazz@run_test_pos",
    "echo_sink consumed topic and wrote a real marker",
  );
  // Stage transitions persisted: running+ok for each of the two blocks.
  const okStages = rows.filter((r) => r.status === "ok").map((r) => r.block);
  assert.deepEqual(okStages, ["echo_seed", "echo_sink"], "both blocks marked ok");
  console.log("POSITIVE PASS: store =", JSON.stringify(result.store));
}

async function negativeValidation(): Promise<void> {
  _resetBlocks();
  registerAllBlocks();
  register(echoSeed);
  register(echoSink);
  // echo_sink consumes "topic" but we omit the producing echo_seed → invalid.
  let threw = false;
  try {
    validatePipeline([{ block: "echo_sink" }]);
  } catch (e) {
    threw = e instanceof PipelineValidationError;
    console.log("NEGATIVE(validation) threw as expected:", (e as Error).message);
  }
  assert.equal(threw, true, "pipeline with unsatisfied consume must fail validation");
}

async function negativeSilentFallback(): Promise<void> {
  _resetBlocks();
  // A liar block: declares it produces "x" but returns nothing.
  const liar: Block = {
    id: "liar",
    consumes: [],
    produces: ["x"],
    run: async () => ({}), // produces nothing → must fail loud
  };
  register(liar);
  const resolved = validatePipeline([{ block: "liar" }]);
  const { sink, rows } = memSink();
  const result = await runPipeline(resolved, {
    ownerId: "o",
    runId: "run_test_neg2",
    channelId: "c",
    keyPrefix: "p/",
    budgetUsd: 0,
    sink,
  });
  assert.equal(result.ok, false, "liar block must fail the run");
  assert.equal(result.failedBlock, "liar");
  assert.ok(
    rows.some((r) => r.status === "failed" && r.block === "liar"),
    "failure persisted to sink",
  );
  console.log("NEGATIVE(no-silent-fallback) PASS:", result.error);
}

async function preflightCostReservation(): Promise<void> {
  _resetBlocks();
  registerAllBlocks();
  const paid = allManifests().find(
    (manifest) => manifest.costAndLatency.paid && Number.isFinite(manifest.costAndLatency.maxCostUsd),
  );
  assert.ok(paid, "the production registry must contain a paid module with a cost envelope");
  const resolved = validatePipeline(
    [{ block: paid.id }],
    Object.keys(paid.consumes),
  );
  const maximum = configuredMaxCostUsd(paid, resolved.entries[0].params ?? {}, {
    entries: resolved.entries,
    index: 0,
  });
  assert.ok(maximum > 0, "the selected paid module must reserve a positive amount");

  assert.throws(
    () => preflight(resolved, { budgetUsd: Math.max(0.000001, maximum / 2) }),
    (error: unknown) => error instanceof PreflightError && /reserves up to/.test(error.message),
    "a run must fail before provider execution when its declared worst case exceeds budget",
  );
  preflight(resolved, { budgetUsd: maximum });
  console.log(`PREFLIGHT RESERVATION PASS: ${paid.id} reserves $${maximum.toFixed(2)}`);
}

/**
 * Cost wiring: a paid block that reports __costUsd must (a) have that cost
 * recorded on its runStage, (b) roll up into RunResult.costTotal, and (c) when
 * cumulative spend crosses budgetUsd, ABORT the run before the next block runs.
 */
async function costAndBudget(): Promise<void> {
  _resetBlocks();
  const pricey1: Block = {
    id: "pricey1",
    consumes: [],
    produces: ["a"],
    paid: true,
    run: async () => ({ a: "1", [COST_PATCH_KEY]: 3 }),
  };
  const pricey2: Block = {
    id: "pricey2",
    consumes: ["a"],
    produces: ["b"],
    paid: true,
    run: async () => ({ b: "2", [COST_PATCH_KEY]: 3 }),
  };
  register(pricey1);
  register(pricey2);

  // (a)+(b): budget high enough — both run, costs roll up to 6.
  {
    const resolved = validatePipeline([{ block: "pricey1" }, { block: "pricey2" }]);
    const { sink, rows } = memSink();
    const result = await runPipeline(resolved, {
      ownerId: "o", runId: "run_cost_ok", channelId: "c", keyPrefix: "p/",
      budgetUsd: 100, sink,
    });
    assert.equal(result.ok, true, "under budget → run succeeds");
    assert.equal(result.costTotal, 6, "costs roll up (3+3)");
    assert.ok(!("__costUsd" in result.store), "cost key never leaks into the store");
    const okCost = rows.find((r) => r.block === "pricey1" && r.status === "ok")?.cost;
    assert.equal(okCost, 3, "per-block cost persisted on the runStage");
  }

  // (c): budget below the first block's cost — abort after pricey1, pricey2 never runs.
  {
    const resolved = validatePipeline([{ block: "pricey1" }, { block: "pricey2" }]);
    const { sink, rows } = memSink();
    const result = await runPipeline(resolved, {
      ownerId: "o", runId: "run_cost_over", channelId: "c", keyPrefix: "p/",
      budgetUsd: 2, sink,
    });
    assert.equal(result.ok, false, "over budget → run aborts");
    assert.equal(result.failedBlock, "pricey1", "aborts at the block that tipped over");
    assert.equal(result.costTotal, 3, "reports what was actually spent");
    assert.match(result.error ?? "", /budget ceiling exceeded/);
    assert.ok(!rows.some((r) => r.block === "pricey2"), "downstream paid block never runs");
  }
  console.log("COST/BUDGET PASS: rollup + ceiling abort both enforced");
}

/**
 * Artifact persistence is BATCHED: one sink call per block carrying every
 * artifact that block produced, never one call per produced key. This pins the
 * Convex-call-count contract — a regression back to per-key writes would turn
 * a 3-output block into 3 mutations again.
 */
async function artifactBatching(): Promise<void> {
  _resetBlocks();
  const triple: Block = {
    id: "echo_triple",
    consumes: [],
    produces: ["a", "b", "c"],
    run: async () => ({ a: 1, b: "two", c: { three: true } }),
  };
  const single: Block = {
    id: "echo_single",
    consumes: ["a"],
    produces: ["d"],
    run: async () => ({ d: "solo" }),
  };
  register(triple);
  register(single);

  const calls: Array<{ count: number; keys: string[]; createdAt: number[] }> = [];
  const sink: RunStageSink = {
    async upsert() {},
    async upsertArtifacts(args) {
      calls.push({
        count: args.artifacts.length,
        keys: args.artifacts.map((entry) => entry.artifact.key),
        createdAt: args.artifacts.map((entry) => entry.createdAt),
      });
    },
  };

  const resolved = validatePipeline([{ block: "echo_triple" }, { block: "echo_single" }]);
  const result = await runPipeline(resolved, {
    ownerId: "o",
    runId: "run_artifact_batch",
    channelId: "c",
    keyPrefix: "p/",
    budgetUsd: 0,
    sink,
  });
  assert.equal(result.ok, true, "batching pipeline must succeed");

  // ONE call per block — not one per produced key.
  assert.equal(calls.length, 2, `expected 1 sink call per block, got ${calls.length}`);
  assert.deepEqual(calls[0].keys.slice().sort(), ["a", "b", "c"], "3-output block batches all 3");
  assert.equal(calls[0].count, 3);
  // A single-output block must behave exactly as before: one call, one entry.
  assert.deepEqual(calls[1].keys, ["d"], "1-output block still writes exactly one artifact");
  assert.equal(calls[1].count, 1);
  // Artifacts written by one transaction share one creation instant.
  assert.equal(new Set(calls[0].createdAt).size, 1, "batched artifacts share a createdAt");

  const perKeyCallCount = calls.reduce((total, call) => total + call.count, 0);
  console.log(
    `ARTIFACT BATCHING PASS: ${perKeyCallCount} artifacts persisted in ${calls.length} sink call(s)`,
  );
}

async function main(): Promise<void> {
  await positive();
  await negativeValidation();
  await negativeSilentFallback();
  await preflightCostReservation();
  await costAndBudget();
  await artifactBatching();
  console.log("\nALL ENGINE TESTS PASSED");
}

main().catch((e) => {
  console.error("ENGINE TEST FAILED:", e);
  process.exit(1);
});
