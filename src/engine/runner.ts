/**
 * Pipeline runner (MASTER-PLAN §D).
 *
 * Executes an ordered, already-validated pipeline over a single StageContext
 * key/value store. For each block it:
 *   1. writes a runStage (running) via the sink,
 *   2. runs the block,
 *   3. asserts the block actually produced every key it declared (no silent
 *      None — fail loud per decision A.5),
 *   4. merges the patch into the shared store,
 *   5. writes a runStage (ok) — or (failed) and STOPS the whole run.
 */
import {
  COST_PATCH_KEY,
  type Block,
  type RunStageSink,
  type StageContext,
  type StageStatus,
} from "./types";
import type { ResolvedPipeline } from "./validate";

export interface RunPipelineOptions {
  ownerId: string;
  runId: string;
  channelId: string;
  keyPrefix: string;
  budgetUsd: number;
  /** Per-block params keyed by block id (from pipeline entries). */
  paramsByBlock?: Record<string, Record<string, unknown>>;
  /** Initial store seeds (channel config, etc.). */
  seedStore?: Record<string, unknown>;
  /** Persistence sink (Convex-backed in prod; in-memory for tests). */
  sink: RunStageSink;
  /** Optional structured logger. */
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface RunResult {
  ok: boolean;
  store: Record<string, unknown>;
  failedBlock?: string;
  error?: string;
  /** Sum of every block's reported spend (USD). */
  costTotal: number;
  stages: { block: string; status: StageStatus }[];
}

/** Pull a block's self-reported spend out of its patch (and off the store). */
function takeCost(patch: Record<string, unknown>): number {
  const raw = patch[COST_PATCH_KEY];
  delete patch[COST_PATCH_KEY];
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function assertProduced(block: Block, patch: Record<string, unknown>): void {
  for (const key of block.produces) {
    const val = patch[key];
    if (val === undefined || val === null) {
      throw new Error(
        `block "${block.id}" declared it produces "${key}" but returned ${val === undefined ? "undefined" : "null"} (no silent fallbacks)`,
      );
    }
  }
}

export async function runPipeline(
  resolved: ResolvedPipeline,
  opts: RunPipelineOptions,
): Promise<RunResult> {
  const log = opts.log ?? (() => {});
  const store: Record<string, unknown> = { ...(opts.seedStore ?? {}) };
  const stages: { block: string; status: StageStatus }[] = [];
  let spentUsd = 0;

  for (const block of resolved.blocks) {
    const params = opts.paramsByBlock?.[block.id] ?? {};
    const inputs = Object.fromEntries(
      block.consumes.map((k) => [k, store[k]]),
    );

    await opts.sink.upsert({
      ownerId: opts.ownerId,
      runId: opts.runId,
      block: block.id,
      status: "running",
      startedAt: Date.now(),
      inputs,
    });

    const ctx: StageContext = {
      ownerId: opts.ownerId,
      runId: opts.runId,
      channelId: opts.channelId,
      keyPrefix: opts.keyPrefix,
      params,
      store,
      budgetUsd: opts.budgetUsd,
      log,
    };

    try {
      const patch = await block.run(ctx);
      const cost = takeCost(patch);
      spentUsd += cost;
      assertProduced(block, patch);
      Object.assign(store, patch);

      await opts.sink.upsert({
        ownerId: opts.ownerId,
        runId: opts.runId,
        block: block.id,
        status: "ok",
        finishedAt: Date.now(),
        cost,
        outputs: patch,
      });
      stages.push({ block: block.id, status: "ok" });
      log(`block ok: ${block.id}`, { produced: block.produces, costUsd: cost });

      // Enforce the per-run budget ceiling. The block that tipped over has
      // already run; aborting here prevents every subsequent (paid) block from
      // spending more. A boolean preflight alone can't do this.
      if (opts.budgetUsd > 0 && spentUsd > opts.budgetUsd) {
        const message = `budget ceiling exceeded: spent $${spentUsd.toFixed(2)} > budget $${opts.budgetUsd.toFixed(2)} after block "${block.id}" — aborting before further paid blocks`;
        log(message);
        return {
          ok: false,
          store,
          failedBlock: block.id,
          error: message,
          costTotal: spentUsd,
          stages,
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await opts.sink.upsert({
        ownerId: opts.ownerId,
        runId: opts.runId,
        block: block.id,
        status: "failed",
        finishedAt: Date.now(),
        error: message,
      });
      stages.push({ block: block.id, status: "failed" });
      log(`block failed: ${block.id}`, { error: message });
      // Stop loud — do not continue the pipeline.
      return {
        ok: false,
        store,
        failedBlock: block.id,
        error: message,
        costTotal: spentUsd,
        stages,
      };
    }
  }

  return { ok: true, store, costTotal: spentUsd, stages };
}
