/**
 * Render child task (P1→P2 split).
 *
 * The memory-heavy video render (timeline_assemble — large-1x OOMs on its
 * overlay+xfade pass) runs HERE on large-2x, dispatched by run-pipeline through
 * the engine's `remoteBlocks` hook. The run-pipeline orchestrator runs every
 * other block (LLM/TTS/footage/idle waits) on a cheaper machine and SUSPENDS
 * (unbilled) while this child renders — so it stops paying the large-2x rate to
 * sit idle waiting on external APIs (~50% of every run was idle-billing).
 *
 * This task rebuilds the engine store from the run's already-completed upstream
 * blocks (rehydrated from R2 onto THIS worker — footage via footageKeys, intro
 * via introCardKey, narration via narrationKey, etc.), runs the single render
 * block, and returns its patch. Isolating the render on its own 16GB worker also
 * cuts the overlay/xfade OOMs (SYSTEM_FAILURE) the shared monolith was hitting.
 */
import { task, logger } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { registerAllBlocks } from "@/engine/blocks";
import { get } from "@/engine/registry";
import { makeConvexSink } from "@/engine/convexSink";
import { rehydrateOutputs } from "@/lib/rehydrate";
import { bootstrapSecrets } from "@/lib/bootstrap";
import type { StageContext } from "@/engine/types";

export interface RenderBlockInput {
  runId: string;
  ownerId: string;
  channelId: string;
  keyPrefix: string;
  blockId: string;
  params: Record<string, unknown>;
  budgetUsd: number;
  seedStore: Record<string, unknown>;
}

export const renderBlockTask = task({
  id: "render-block",
  machine: "large-2x",
  // Wall-clock ceiling for the render (matches the orchestrator's old budget).
  maxDuration: 5400,
  // OOM/crash retry — the render block re-runs cleanly (it re-reads its inputs).
  retry: { maxAttempts: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 30000, factor: 2 },
  run: async (payload: RenderBlockInput) => {
    registerAllBlocks();
    await bootstrapSecrets((m, x) => console.log(`[render-block] ${m}`, x ?? ""), { required: [] });

    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("render-block: NEXT_PUBLIC_CONVEX_URL not configured");
    const convex = new ConvexHttpClient(url);

    const block = get(payload.blockId);
    if (!block) throw new Error(`render-block: unknown block "${payload.blockId}"`);

    // Rebuild the store this block reads: channel seeds + every completed
    // upstream block's outputs, rehydrated from R2 to local files on THIS worker.
    const store: Record<string, unknown> = { ...(payload.seedStore ?? {}) };
    const sink = makeConvexSink(convex, payload.ownerId);
    if (!sink.getCompleted) throw new Error("render-block: sink lacks getCompleted (cannot rebuild store)");
    const completed = await sink.getCompleted(payload.runId);
    let restored = 0;
    for (const row of completed) {
      if (row.block === payload.blockId) continue;
      // Best-effort: rehydrate each upstream block's outputs to local files on
      // THIS worker. If a block has a local-only output that ISN'T R2-backed, we
      // still merge its raw values — the render only fails if it actually reads a
      // missing file (which would mean a render input still needs R2-backing).
      const r = await rehydrateOutputs(
        row.block,
        { ...((row.outputs ?? {}) as Record<string, unknown>) },
        payload.runId,
      );
      if (!r.ok) {
        logger.warn(`[render-block] block "${row.block}" outputs not fully rehydratable — merging raw (ok if render doesn't read them)`);
      }
      Object.assign(store, r.outputs);
      restored++;
    }
    logger.info(`[render-block] store rebuilt from ${restored} upstream block(s) → running ${payload.blockId}`);

    const ctx: StageContext = {
      ownerId: payload.ownerId,
      runId: payload.runId,
      channelId: payload.channelId,
      keyPrefix: payload.keyPrefix,
      params: payload.params ?? {},
      store,
      budgetUsd: payload.budgetUsd ?? 0,
      log: (msg: string, extra?: Record<string, unknown>) => logger.info(`[render-block] ${msg}`, extra),
    };

    const patch = await block.run(ctx);
    return { patch };
  },
});
