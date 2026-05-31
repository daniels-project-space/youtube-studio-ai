/**
 * Live-Convex spine test (Phase-1 Trigger fallback evidence).
 *
 * Proves the FULL Trigger-task→runner→Convex wiring minus the Trigger runtime:
 *   1. create a real channel (2-block echo pipeline) in the live Convex deploy,
 *   2. create a run,
 *   3. run the pipeline through the engine runner with the Convex-backed sink
 *      (the exact same sink + runner the `run-pipeline` task uses),
 *   4. mark the run ok,
 *   5. query runStages BACK from Convex and assert both blocks are "ok" and the
 *      marker output landed.
 *
 * Run: NEXT_PUBLIC_CONVEX_URL=… npx tsx scripts/test-live-convex.ts
 */
import assert from "node:assert/strict";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { registerAllBlocks } from "@/engine/blocks";
import { validatePipeline, preflight } from "@/engine/validate";
import { runPipeline } from "@/engine/runner";
import { makeConvexSink } from "@/engine/convexSink";
import { channelPrefix } from "@/lib/storage";
import type { PipelineEntry } from "@/engine/types";

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is required");
  const convex = new ConvexHttpClient(url);
  const ownerId = "owner_smoke";

  registerAllBlocks();

  const channelId = await convex.mutation(api.channels.createChannel, {
    ownerId,
    slug: `smoke-${Date.now()}`,
    name: "Phase 1 Smoke Channel",
    identity: {
      persona: "lofi",
      bannedWords: [],
      requiredCallbacks: [],
      styleGrammar: "warm grain",
      palette: ["#2b2b3a"],
      thumbnailTemplate: "default",
      topicPool: ["study beats"],
      cadence: "daily",
    },
    template: "C",
    pipeline: [
      { block: "echo_seed", params: { topic: "spine-proof-topic" } },
      { block: "echo_sink" },
    ],
    budget: 1,
    status: "active",
  });
  console.log("created channel:", channelId);

  const runId = await convex.mutation(api.runs.createRun, {
    ownerId,
    channelId,
  });
  console.log("created run:", runId);

  const channel = await convex.query(api.channels.getChannel, { channelId });
  assert.ok(channel, "channel readback");
  const entries = channel!.pipeline as PipelineEntry[];

  const resolved = validatePipeline(entries);
  preflight(resolved, { budgetUsd: channel!.budget });

  const paramsByBlock: Record<string, Record<string, unknown>> = {};
  for (const e of entries) if (e.params) paramsByBlock[e.block] = e.params;

  await convex.mutation(api.runs.updateRun, { runId, status: "running" });
  const result = await runPipeline(resolved, {
    ownerId,
    runId,
    channelId,
    keyPrefix: channelPrefix(ownerId, channel!.slug),
    budgetUsd: channel!.budget,
    paramsByBlock,
    sink: makeConvexSink(convex, ownerId),
    log: (m, x) => console.log("  [runner]", m, x ?? ""),
  });
  assert.equal(result.ok, true, "pipeline ok");
  await convex.mutation(api.runs.updateRun, {
    runId,
    status: "ok",
    finishedAt: Date.now(),
  });

  // Query runStages BACK from Convex — the real evidence.
  const stages = await convex.query(api.runStages.listRunStages, { runId });
  console.log("\nrunStages read back from Convex:");
  for (const s of stages) {
    console.log(
      `  - ${s.block}: ${s.status}` +
        (s.outputs ? ` outputs=${JSON.stringify(s.outputs)}` : ""),
    );
  }
  const byBlock = Object.fromEntries(stages.map((s) => [s.block, s]));
  assert.equal(byBlock["echo_seed"]?.status, "ok", "echo_seed ok in Convex");
  assert.equal(byBlock["echo_sink"]?.status, "ok", "echo_sink ok in Convex");
  assert.equal(
    (byBlock["echo_sink"]?.outputs as { marker?: string })?.marker,
    `seen:spine-proof-topic@${runId}`,
    "marker persisted to Convex runStages",
  );

  const finalRun = await convex.query(api.runs.getRun, { runId });
  assert.equal(finalRun?.status, "ok", "run marked ok in Convex");

  console.log("\nLIVE-CONVEX SPINE TEST PASSED (runId=%s)", runId);
}

main().catch((e) => {
  console.error("LIVE-CONVEX TEST FAILED:", e);
  process.exit(1);
});
