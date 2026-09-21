import assert from "node:assert/strict";
import { manifestFromBlock } from "@/engine/moduleManifest";
import { _clear, registerManifest } from "@/engine/registry";
import { runPipeline } from "@/engine/runner";
import type { Block, RunStageSink } from "@/engine/types";
import { validatePipeline } from "@/engine/validate";

const base = {
  ownerId: "factual-review-owner",
  runId: "factual-review-run",
  channelId: "factual-review-channel",
  keyPrefix: "owners/factual-review/",
  budgetUsd: 10,
  log: () => {},
};

function registerTestBlock(block: Block): void {
  // These intentionally use production-shaped ids while supplying tiny local
  // contracts. The runner boundary is being tested, not a provider or the
  // complete Story Spine/Episode Graph payload schemas.
  registerManifest(manifestFromBlock(block));
}

async function stopsAfterPersistedEpisodeGraphAndResumesTts(): Promise<void> {
  let narrationRuns = 0;
  let episodeGraphRuns = 0;
  let visualRuns = 0;
  const rehydrated: string[] = [];
  const rehydrateRequests: string[][] = [];
  const writes: Array<{ block: string; status: string; outputs?: unknown }> = [];

  _clear();
  registerTestBlock({
    id: "narration_tts",
    consumes: [],
    produces: ["reviewNarration", "reviewNarrationLocalPath", "reviewNarrationKey"],
    paid: true,
    run: async () => {
      narrationRuns += 1;
      return {
        reviewNarration: "rehydrated narration",
        reviewNarrationLocalPath: "/first-worker/narration.mp3",
        reviewNarrationKey: "owners/factual-review/narration.mp3",
        __costUsd: 0.42,
      };
    },
  });
  registerTestBlock({
    id: "episode_graph",
    consumes: ["reviewNarration"],
    produces: ["reviewEpisodeGraph"],
    run: async (ctx) => {
      episodeGraphRuns += 1;
      assert.equal(ctx.store["reviewNarration"], "rehydrated narration");
      return { reviewEpisodeGraph: "frozen actual episode graph" };
    },
  });
  registerTestBlock({
    id: "scene_compiler",
    consumes: ["reviewEpisodeGraph", "reviewNarrationLocalPath"],
    produces: ["reviewVisualPlan"],
    run: async () => {
      visualRuns += 1;
      throw new Error("visual work must stay behind the factual review boundary");
    },
  });

  const completed: Array<{ block: string; outputs: unknown; cost?: number; reuseReceipt?: unknown }> = [];
  const sink: RunStageSink = {
    async upsert(args) {
      writes.push({ block: args.block, status: args.status, outputs: args.outputs });
      if (args.status === "ok" && args.outputs) completed.push({
        block: args.block, outputs: structuredClone(args.outputs), cost: args.cost, reuseReceipt: args.reuseReceipt,
      });
    },
    async getCompleted() {
      return structuredClone(completed);
    },
  };
  // Produce the receipt through the real runner; the synthetic narration block
  // above has no provider. Only the subsequent resume is counted below.
  const initial = await runPipeline(validatePipeline([{ block: "narration_tts" }]), {
    ...base, sink, resume: false,
  });
  assert.equal(initial.ok, true, initial.error);
  narrationRuns = 0;
  writes.length = 0;

  const result = await runPipeline(
    validatePipeline([
      { block: "narration_tts" },
      { block: "episode_graph" },
      { block: "scene_compiler" },
    ]),
    {
      ...base,
      sink,
      stopAfterBlockId: "episode_graph",
      rehydrate: async (block, outputs, request) => {
        rehydrated.push(block);
        rehydrateRequests.push([...(request?.neededOutputKeys ?? [])].sort());
        return {
          ok: true,
          outputs:
            block === "narration_tts"
              ? { ...outputs, reviewNarrationLocalPath: "/second-worker/narration.mp3" }
              : outputs,
        };
      },
    },
  );

  assert.equal(result.ok, true, "the checkpoint is a successful stop, never a failed stage");
  assert.equal(result.status, "awaiting_review");
  assert.equal(result.stoppedAfterBlockId, "episode_graph");
  assert.equal(narrationRuns, 0, "completed paid TTS is restored instead of replayed");
  assert.deepEqual(rehydrated, ["narration_tts"], "the cached TTS patch is rehydrated");
  assert.deepEqual(
    rehydrateRequests,
    [["reviewNarration"]],
    "the boundary does not download narration media needed only by post-review visual work",
  );
  assert.equal(episodeGraphRuns, 1, "the actual graph is computed before review");
  assert.equal(visualRuns, 0, "no post-graph visual work begins before review");
  assert.deepEqual(
    writes.filter((write) => write.status === "ok").map((write) => write.block),
    ["narration_tts", "episode_graph"],
    "the graph's durable ok stage is written before the boundary is returned",
  );
  assert.deepEqual(
    result.stages,
    [
      { block: "narration_tts", status: "ok" },
      { block: "episode_graph", status: "ok" },
    ],
    "the result exposes the exact persisted phase-I stage set",
  );
  assert.equal(result.costTotal, 0.42, "cached TTS spend remains in the truthful total");
}

async function refusesParallelGroupBoundaryBeforeAnyWork(): Promise<void> {
  let calls = 0;
  const writes: Array<{ block: string; status: string }> = [];

  _clear();
  registerTestBlock({
    id: "qa_script",
    consumes: [],
    produces: [],
    run: async () => {
      calls += 1;
      return {};
    },
  });

  const sink: RunStageSink = {
    async upsert(args) {
      writes.push({ block: args.block, status: args.status });
    },
  };
  const result = await runPipeline(validatePipeline([{ block: "qa_script" }]), {
    ...base,
    runId: "factual-review-parallel-boundary",
    sink,
    stopAfterBlockId: "qa_script",
  });

  assert.equal(result.ok, false, "a group member cannot be a partial review boundary");
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /REVIEW_BOUNDARY_UNSAFE/);
  assert.equal(calls, 0, "unsafe boundary validation happens before any block runs");
  assert.deepEqual(writes, [], "unsafe boundary validation writes no misleading stage state");
}

async function main(): Promise<void> {
  await stopsAfterPersistedEpisodeGraphAndResumesTts();
  await refusesParallelGroupBoundaryBeforeAnyWork();
  for (const entries of [["music", "narration_tts"], ["narration_tts", "music"]]) {
    _clear();
    const calls: string[] = [], persisted: string[] = [];
    for (const id of entries) registerTestBlock({ id, consumes: [], produces: [], run: async () => { calls.push(id); return {}; } });
    const result = await runPipeline(validatePipeline(entries.map(block => ({ block }))), {
      ...base, resume: false, stopAfterBlockId: "music",
      sink: { upsert: async row => { if (row.status === "ok") persisted.push(row.block); } },
    });
    assert.equal(result.status, "awaiting_review", result.error);
    assert.deepEqual(calls, entries.slice(0, entries.indexOf("music") + 1), "music barrier must split the usual music/narration wave");
    assert.deepEqual(persisted, calls, "every pre-review result is persisted before returning");
  }
  console.log("factualReviewBoundary: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
