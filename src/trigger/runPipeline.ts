/**
 * `run-pipeline` Trigger task (MASTER-PLAN §D).
 *
 * Input: { channelId, runId }. It:
 *   1. loads the channel from Convex,
 *   2. resolves + validates its pipeline (topological consumes/produces),
 *   3. preflights (budget + required keys),
 *   4. runs the blocks via the engine runner, writing a runStage per block
 *      (Convex-backed sink), and
 *   5. marks the run ok/failed and fires a Telegram alert on failure.
 *
 * Idempotency: paid/heavy blocks carry `idempotencyKey = runId:block` so a
 * resumed run never double-spends (decision A.4). In P1 the blocks are trivial
 * and run inline; in P2 each heavy block becomes a child task triggered with
 * that key.
 */
import { task, idempotencyKeys } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { registerAllBlocks } from "@/engine/blocks";
import { validatePipeline, preflight } from "@/engine/validate";
import { runPipeline as runEngine } from "@/engine/runner";
import { makeConvexSink } from "@/engine/convexSink";
import { makeRunLogSink, teeLog } from "@/engine/runLogSink";
import { channelPrefix } from "@/lib/storage";
import { alertFailure } from "@/lib/telegram";
import { bootstrapSecrets } from "@/lib/bootstrap";
import type { PipelineEntry } from "@/engine/types";

export interface RunPipelineInput {
  channelId: string;
  runId: string;
}

export const runPipelineTask = task({
  id: "run-pipeline",
  // Video encodes (ffmpeg concat/loop at 1080p) need real memory — the default
  // small machine OOM-kills on multi-minute renders.
  machine: "large-1x",
  maxDuration: 3000,
  run: async (payload: RunPipelineInput) => {
    registerAllBlocks();
    await bootstrapSecrets((m, x) =>
      console.log(`[run-pipeline] ${m}`, x ?? ""),
    );

    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
    const convex = new ConvexHttpClient(url);

    const channel = await convex.query(api.channels.getChannel, {
      channelId: payload.channelId as Id<"channels">,
    });
    if (!channel) throw new Error(`channel not found: ${payload.channelId}`);

    const ownerId = channel.ownerId;
    const entries = (channel.pipeline ?? []) as PipelineEntry[];

    // Per-block idempotency keys (used when blocks become child tasks in P2).
    const blockKeys: Record<string, string> = {};
    for (const e of entries) {
      blockKeys[e.block] = await idempotencyKeys.create(
        `${payload.runId}:${e.block}`,
      );
    }

    await convex.mutation(api.runs.updateRun, {
      runId: payload.runId as Id<"runs">,
      status: "running",
    });

    // Live log sink — tees every ctx.log line into the runLogs table so the
    // run detail page can stream a console. Best-effort: never crashes the run.
    const logSink = makeRunLogSink(convex, ownerId, payload.runId);
    const log = teeLog(logSink, (msg, extra) =>
      console.log(`[run-pipeline] ${msg}`, extra ?? ""),
    );

    try {
      const resolved = validatePipeline(entries);
      preflight(resolved, { budgetUsd: channel.budget ?? 0 });

      const paramsByBlock: Record<string, Record<string, unknown>> = {};
      for (const e of entries) {
        if (e.params) paramsByBlock[e.block] = e.params as Record<string, unknown>;
      }

      // Seed channel identity into the store so blocks can read style/topics.
      const seedStore: Record<string, unknown> = {
        topicPool: channel.identity?.topicPool ?? [],
        styleGrammar: channel.identity?.styleGrammar ?? "",
        channelName: channel.name,
        palette: channel.identity?.palette ?? [],
        persona: channel.identity?.persona ?? "",
        niche: channel.identity?.niche ?? "",
      };

      const sink = makeConvexSink(convex, ownerId);
      const result = await runEngine(resolved, {
        ownerId,
        runId: payload.runId,
        channelId: payload.channelId,
        keyPrefix: channelPrefix(ownerId, channel.slug),
        budgetUsd: channel.budget ?? 0,
        paramsByBlock,
        seedStore,
        sink,
        log,
      });

      // Drain any buffered log lines before resolving the run state.
      await logSink.flush();

      if (!result.ok) {
        await convex.mutation(api.runs.updateRun, {
          runId: payload.runId as Id<"runs">,
          status: "failed",
          finishedAt: Date.now(),
          costTotal: result.costTotal,
          error: result.error,
        });
        await safeAlert(
          `run-pipeline failed (${channel.slug}/${result.failedBlock})`,
          result.error ?? "unknown error",
        );
        return { ok: false, failedBlock: result.failedBlock, error: result.error };
      }

      await convex.mutation(api.runs.updateRun, {
        runId: payload.runId as Id<"runs">,
        status: "ok",
        finishedAt: Date.now(),
        costTotal: result.costTotal,
      });
      return { ok: true, stages: result.stages, costTotal: result.costTotal };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`run aborted: ${message}`);
      await logSink.flush();
      await convex.mutation(api.runs.updateRun, {
        runId: payload.runId as Id<"runs">,
        status: "failed",
        finishedAt: Date.now(),
        error: message,
      });
      await safeAlert(`run-pipeline aborted (${payload.runId})`, message);
      throw err;
    }
  },
});

/** Fire a Telegram alert but never let alerting failures mask the real error. */
async function safeAlert(context: string, error: string): Promise<void> {
  try {
    await alertFailure(context, error);
  } catch (e) {
    console.error(
      "[run-pipeline] telegram alert failed:",
      e instanceof Error ? e.message : e,
    );
  }
}
