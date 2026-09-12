import assert from "node:assert/strict";
import { runPipeline, type RunPipelineOptions } from "@/engine/runner";
import type { StageReuseReceipt } from "@/engine/stageReuseContract";
import type { Block, RunStageSink } from "@/engine/types";
import type { ResolvedPipeline } from "@/engine/validate";

export type CompletedStageFixture = {
  block: string;
  outputs: Record<string, unknown>;
  cost?: number;
};

/**
 * Produce real runner receipts for explicitly synthetic cached-stage fixtures.
 * The supplied registered contracts/params remain unchanged, but every selected
 * block's run implementation is replaced on a private clone. No original run,
 * provider import, rehydrator, remote dispatcher or persistence service executes.
 * This is fixture seeding, never a production/legacy receipt migration.
 */
export async function stageReuseFixtures(
  resolved: ResolvedPipeline,
  scope: Pick<RunPipelineOptions,
    "ownerId" | "runId" | "channelId" | "keyPrefix" | "budgetUsd" | "seedStore" | "paramsByBlock">,
  completed: readonly CompletedStageFixture[],
): Promise<Array<CompletedStageFixture & { reuseReceipt: StageReuseReceipt }>> {
  const fixtures = new Map(completed.map((fixture) => [fixture.block, fixture]));
  assert.equal(fixtures.size, completed.length, "fixture stage ids must be unique");
  const entries: ResolvedPipeline["entries"] = [];
  const blocks: ResolvedPipeline["blocks"] = [];
  const manifests: ResolvedPipeline["manifests"] = [];
  for (let index = 0; index < resolved.blocks.length; index++) {
    const original = resolved.blocks[index]!;
    const fixture = fixtures.get(original.id);
    if (!fixture) continue;
    const manifest = resolved.manifests[index]!;
    assert.equal(manifest.id, original.id, "fixture manifest must match its registered block");
    const run: Block["run"] = async (ctx) => {
      for (const key of Object.keys(manifest.consumes)) {
        assert.notEqual(ctx.store[key], undefined, `fixture ${original.id} requires its original input ${key}`);
      }
      return { ...structuredClone(fixture.outputs), __costUsd: fixture.cost ?? 0 };
    };
    const block = { ...original, run };
    entries.push(resolved.entries[index]!);
    blocks.push(block);
    manifests.push({ ...manifest, block, execute: run });
  }
  assert.equal(blocks.length, fixtures.size, "every fixture must name a resolved block");
  const saved = new Map<string, Parameters<RunStageSink["upsert"]>[0]>();
  const sink: RunStageSink = {
    async upsert(row) { saved.set(row.block, { ...saved.get(row.block), ...structuredClone(row) }); },
    async upsertArtifacts() {},
  };
  const result = await runPipeline({ ...resolved, entries, blocks, manifests }, {
    ...scope,
    seedStore: scope.seedStore === undefined ? undefined : structuredClone(scope.seedStore),
    paramsByBlock: scope.paramsByBlock === undefined ? undefined : structuredClone(scope.paramsByBlock),
    sink, resume: false, defaultRetries: 0,
  });
  assert.equal(result.ok, true, `fixture executions must produce genuine receipts: ${result.error}`);
  return completed.map(({ block }) => {
    const row = saved.get(block);
    assert.ok(row, `fixture ${block} did not persist a stage`);
    assert.equal(row.status, "ok", `fixture ${block} did not finish`);
    assert.ok(row.reuseReceipt, `fixture ${block} lacks a genuine runner receipt`);
    assert.ok(row.outputs && typeof row.outputs === "object" && !Array.isArray(row.outputs));
    return {
      block, outputs: row.outputs as Record<string, unknown>, cost: row.cost,
      reuseReceipt: row.reuseReceipt,
    };
  });
}
