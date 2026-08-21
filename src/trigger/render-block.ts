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
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { registerAllBlocks } from "@/engine/blocks";
import { getManifest } from "@/engine/registry";
import { makeConvexSink } from "@/engine/convexSink";
import { rehydrateOutputs, selectRehydrationSubset } from "@/lib/rehydrate";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { taskErrorForRetryPolicy } from "@/trigger/taskRetryPolicy";
import type { StageContext } from "@/engine/types";
import {
  assertRenderBlockAdmission,
  assertRenderBlockInvocation,
} from "@/lib/renderBlockAdmission";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { assertPipelineVideoRuntimeReady } from "@/engine/runtimeCapability";

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
    // Fail before registry initialization, secret bootstrap, provider admission,
    // or large-worker execution when this individual block requires a video
    // runtime the frozen fleet cannot execute.
    assertPipelineVideoRuntimeReady([{ block: payload.blockId, params: payload.params }]);
    registerAllBlocks();
    await bootstrapSecrets((m, x) => console.log(`[render-block] ${m}`, x ?? ""), { required: [] });

    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("render-block: NEXT_PUBLIC_CONVEX_URL not configured");
    const convex = new ConvexHttpClient(url);

    // Authenticate the complete execution tuple before registry lookup,
    // rehydration, large-worker billing, or block execution. The parent marks
    // the run `running` before dispatching this child, including on retries.
    const [run, channel] = await Promise.all([
      convex.query(api.runs.getRun, { runId: payload.runId as Id<"runs"> }),
      convex.query(api.channels.getChannel, {
        channelId: payload.channelId as Id<"channels">,
      }),
    ]);
    const admission = {
      blockId: payload.blockId,
      run,
      channel,
      runId: payload.runId,
      ownerId: payload.ownerId,
      channelId: payload.channelId,
    };
    assertRenderBlockAdmission(admission);
    assertRenderBlockInvocation({
      blockId: payload.blockId,
      run: admission.run,
      runId: payload.runId,
      ownerId: payload.ownerId,
      channelId: payload.channelId,
      input: {
        keyPrefix: payload.keyPrefix,
        budgetUsd: payload.budgetUsd,
        params: payload.params,
        seedStore: payload.seedStore,
      },
    });

    const manifest = getManifest(payload.blockId);
    if (!manifest) throw new Error(`render-block: unknown block "${payload.blockId}"`);
    const block = manifest.block;

    // The declared input contract of the block we are about to run — the SAME
    // lookup validatePipeline uses. Union of all three sources because they can
    // legitimately disagree: a contract override may demote a `block.consumes`
    // key to optional (timeline_assemble does exactly this for entityClips and
    // introCardPath), and optional inputs are still read when upstream produced
    // them. Union = every key this block could possibly read, so the filter can
    // only ever skip artifacts it provably never touches.
    const consumedKeys = new Set<string>([
      ...manifest.block.consumes,
      ...Object.keys(manifest.consumes),
      ...Object.keys(manifest.optionalConsumes),
    ]);

    // Rebuild the store this block reads: channel seeds + every completed
    // upstream block's outputs, rehydrated from R2 to local files on THIS worker.
    const store: Record<string, unknown> = { ...(payload.seedStore ?? {}) };
    const sink = makeConvexSink(convex, payload.ownerId);
    if (!sink.getCompleted) throw new Error("render-block: sink lacks getCompleted (cannot rebuild store)");
    const completed = await sink.getCompleted(payload.runId);
    let restored = 0;
    let fetched = 0;
    let skipped = 0;
    for (const row of completed) {
      if (row.block === payload.blockId) continue;
      const outputs = { ...((row.outputs ?? {}) as Record<string, unknown>) };
      // Every upstream value is merged verbatim, exactly as before — the store
      // this block sees is unchanged. Filtering below decides only what we PAY
      // R2 to download, so an input read but not declared still resolves (it
      // just never needed a fetch: undeclared reads are plain values, never
      // R2-backed local paths — asserted in rehydrateSubsetContract.test.ts).
      Object.assign(store, outputs);
      restored++;
      // Only rehydrate artifacts this render block actually consumes. Pulling
      // every completed block's media onto a worker that will never open it was
      // 15-40 wasted R2 GETs per dispatch, re-paid on every retry.
      const subset = selectRehydrationSubset(outputs, consumedKeys);
      if (!subset) {
        skipped++;
        continue;
      }
      // Best-effort, unchanged for anything that survives the filter: if a
      // needed artifact isn't R2-restorable we still merge its raw value — the
      // render fails loud when it actually opens the missing file.
      const r = await rehydrateOutputs(row.block, subset, payload.runId);
      if (!r.ok) {
        logger.warn(`[render-block] block "${row.block}" consumed outputs not fully rehydratable — merging raw (render fails if it reads them)`);
      }
      Object.assign(store, r.outputs);
      fetched++;
    }
    logger.info(
      `[render-block] store rebuilt from ${restored} upstream block(s); rehydrated ${fetched}, skipped ${skipped} not consumed by ${payload.blockId} → running ${payload.blockId}`,
    );

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

    try {
      const patch = await block.run(ctx);
      return { patch };
    } catch (error) {
      const taskError = taskErrorForRetryPolicy(error);
      const { classification } = taskError;
      logger.error(`[render-block] ${payload.blockId} failed`, {
        error: classification.message,
        errorKind: classification.kind,
        retryReason: classification.reason,
        ...(classification.status !== undefined ? { status: classification.status } : {}),
        ...(classification.code ? { code: classification.code } : {}),
      });
      // Trigger task retries are reserved for crashes/OOM and failures with a
      // concrete transient signal. Re-running malformed inputs, provider 4xx,
      // or a deterministic FFmpeg command just burns another large-2x attempt.
      throw taskError.error;
    }
  },
});
