import assert from "node:assert/strict";
import { manifestFromBlock } from "@/engine/moduleManifest";
import { _clear, registerManifest } from "@/engine/registry";
import { runPipeline } from "@/engine/runner";
import { validatePipeline } from "@/engine/validate";
import { resolveScriptNarrationTiming } from "@/lib/narrationTimingPlan";
import type { Block, RunStageSink } from "@/engine/types";

async function main() {
  _clear();
  let observed: unknown;
  let calls = 0;
  const blocks: Block[] = [
    { id: "script_gen", consumes: ["topic"], produces: ["narrationText"], run: async () => ({ narrationText: "A synthetic narration." }) },
    { id: "narration_tts", consumes: ["narrationText"], produces: ["narrationDurationSec"], paid: true,
      run: async ctx => { calls++; observed = ctx.params.scriptNarrationTiming; return { narrationDurationSec: 1 }; } },
  ];
  for (const block of blocks) registerManifest(manifestFromBlock(block));
  const entries = [{ block: "script_gen", params: { maxSeconds: 1200, genre: "meditation" } },
    { block: "narration_tts", params: {} }];
  const before = JSON.stringify(entries);
  const resolved = validatePipeline(entries, ["topic"]);
  type Row = Awaited<ReturnType<NonNullable<RunStageSink["getResumeState"]>>>[number];
  const rows = new Map<string, Row>();
  const sink: RunStageSink = {
    async upsert(args) { rows.set(args.block, structuredClone({ ...(rows.get(args.block) ?? { block: args.block, status: "queued" }),
      ...Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)) })); },
    async getResumeState() { return structuredClone([...rows.values()]); },
    async upsertArtifacts() {},
  };
  const options = { ownerId: "synthetic-owner", runId: "synthetic-run", channelId: "synthetic-channel",
    keyPrefix: "synthetic/", budgetUsd: 1, defaultRetries: 0, sink, seedStore: { topic: "Synthetic topic" },
    rehydrate: async (_id: string, outputs: Record<string, unknown>) => ({ ok: true, outputs }) };
  const result = await runPipeline(resolved, options);
  assert.equal(result.ok, true, result.error);
  assert.equal(resolveScriptNarrationTiming(observed, "history", undefined).restBudgetSec, 120);
  assert.equal(JSON.stringify(entries), before, "legacy snapshot input stays unchanged");
  const replay = await runPipeline(resolved, options);
  assert.equal(replay.ok, true, replay.error);
  assert.equal(calls, 1, "replay reuses the admitted stage instead of running it twice");
  const changed = await runPipeline(resolved, { ...options, paramsByBlock: { script_gen: { maxSeconds: 600, genre: "meditation" } } });
  assert.equal(changed.ok, false, "changed timing cannot reuse a previously admitted narration");
  assert.equal(calls, 1, "a timing conflict cannot launch a replacement take");
  console.log("Real runner derives frozen timing and reuses a synthetic narration stage without provider calls");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
