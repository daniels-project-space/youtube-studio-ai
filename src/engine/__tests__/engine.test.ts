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
import {
  validatePipeline,
  preflight,
  PipelineValidationError,
} from "@/engine/validate";
import { runPipeline } from "@/engine/runner";
import type { Block, RunStageSink } from "@/engine/types";

interface Recorded {
  block: string;
  status: string;
  outputs?: unknown;
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
          error: a.error,
        });
      },
    },
  };
}

async function positive(): Promise<void> {
  _resetBlocks();
  registerAllBlocks();

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

async function main(): Promise<void> {
  await positive();
  await negativeValidation();
  await negativeSilentFallback();
  console.log("\nALL ENGINE TESTS PASSED");
}

main().catch((e) => {
  console.error("ENGINE TEST FAILED:", e);
  process.exit(1);
});
