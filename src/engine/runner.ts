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
  /**
   * Resume: skip blocks that already completed "ok" for this runId (restoring
   * their persisted outputs) so a retried run never re-spends on paid blocks.
   * Default true. Requires sink.getCompleted + rehydrate.
   */
  resume?: boolean;
  /**
   * Make a completed block's persisted outputs usable again on a fresh worker —
   * re-download local files from their R2 keys. Returns ok:false if it can't
   * (then the block is re-run). Supplied by the Trigger task (keeps the engine
   * free of storage deps).
   */
  rehydrate?: (
    block: string,
    outputs: Record<string, unknown>,
  ) => Promise<{ ok: boolean; outputs: Record<string, unknown> }>;
  /** Default per-block retries on TRANSIENT errors (block param `retries` wins). */
  defaultRetries?: number;
  /**
   * Blocks to execute on a dedicated CHILD task instead of inline — e.g. the
   * memory-heavy render on large-2x while the orchestrator + idle-waiting blocks
   * (LLM/TTS/footage) run on a cheaper machine. The orchestrator SUSPENDS
   * (unbilled) during the child, so it stops paying the big-machine rate to wait
   * on external APIs. The child returns the block's patch (R2-keyed outputs).
   */
  remoteBlocks?: Set<string>;
  runRemoteBlock?: (
    blockId: string,
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
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

/** Transient (worth retrying) vs deterministic (gate/QA) failures. */
function isTransient(msg: string): boolean {
  return /(\b(429|408|425|500|502|503|504)\b|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|timed?\s?out|fetch failed|network|rate.?limit|overloaded|temporarily|unavailable|too many requests)/i.test(
    msg,
  );
}

/** Run a block, retrying TRANSIENT errors with exponential backoff. */
async function runBlockWithRetry(
  block: Block,
  ctx: StageContext,
  retries: number,
  log: (msg: string, extra?: Record<string, unknown>) => void,
): Promise<Record<string, unknown>> {
  let attempt = 0;
  for (;;) {
    try {
      return await block.run(ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      attempt++;
      if (attempt > retries || !isTransient(msg)) throw err;
      const backoff = Math.min(30_000, 1000 * 2 ** (attempt - 1));
      log(
        `block ${block.id}: transient error (retry ${attempt}/${retries} in ${backoff}ms): ${msg.slice(0, 160)}`,
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
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

/**
 * VERIFIED parallel groups: contiguous pipeline blocks proven (by reading their
 * store access, not just `consumes`) to never read each other's products. These
 * are the ONLY blocks the runner co-schedules — everything else stays strictly
 * sequential, because blocks may read store keys beyond their declared
 * consumes (e.g. quote_overlays reads introSec; visual_inserts reads the quote
 * windows), so a general inferred-DAG scheduler would be unsound here.
 */
const PARALLEL_GROUPS: string[][] = [
  ["director_brief", "dp_brief", "editor_brief", "composer_brief", "critic_spec"],
  ["qa_script", "originality_gate", "compliance_check"],
  ["stock_footage", "entity_imagery", "music", "intro_card"],
];
const GROUP_OF = new Map<string, number>();
PARALLEL_GROUPS.forEach((g, i) => g.forEach((id) => GROUP_OF.set(id, i)));

export async function runPipeline(
  resolved: ResolvedPipeline,
  opts: RunPipelineOptions,
): Promise<RunResult> {
  const log = opts.log ?? (() => {});
  const store: Record<string, unknown> = { ...(opts.seedStore ?? {}) };
  const stages: { block: string; status: StageStatus }[] = [];
  let spentUsd = 0;

  // Resume: load already-completed blocks' persisted outputs (skip + restore).
  const completedMap: Record<string, Record<string, unknown>> = {};
  if (opts.resume !== false && opts.sink.getCompleted) {
    try {
      for (const row of await opts.sink.getCompleted(opts.runId)) {
        if (row.outputs && typeof row.outputs === "object") {
          completedMap[row.block] = row.outputs as Record<string, unknown>;
        }
      }
      const n = Object.keys(completedMap).length;
      if (n > 0) log(`resume: ${n} block(s) previously completed — will restore + skip`);
    } catch (e) {
      log(`resume: getCompleted failed (running fresh): ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * Execute one block end-to-end (resume-restore | run+retry), persist its
   * stage, merge its patch into the shared store. Returns the outcome instead
   * of throwing so group execution can collect every member's result.
   */
  const executeBlock = async (
    block: Block,
  ): Promise<{ status: "ok" | "failed"; cost: number; error?: string }> => {
    const params = opts.paramsByBlock?.[block.id] ?? {};
    const inputs = Object.fromEntries(block.consumes.map((k) => [k, store[k]]));

    // RESUME: restore a previously-completed block instead of re-running it
    // (no double-spend on paid blocks). Re-run if its files can't be rehydrated.
    const cached = completedMap[block.id];
    if (cached && opts.rehydrate) {
      try {
        const { ok, outputs } = await opts.rehydrate(block.id, { ...cached });
        if (ok) {
          delete outputs[COST_PATCH_KEY];
          assertProduced(block, outputs);
          Object.assign(store, outputs);
          await opts.sink.upsert({
            ownerId: opts.ownerId,
            runId: opts.runId,
            block: block.id,
            status: "ok",
            finishedAt: Date.now(),
            cost: 0,
            outputs,
          });
          stages.push({ block: block.id, status: "ok" });
          log(`block resumed (cached, no re-spend): ${block.id}`);
          return { status: "ok", cost: 0 };
        }
        log(`block ${block.id}: cached outputs not rehydratable — re-running`);
      } catch (e) {
        log(`block ${block.id}: rehydrate failed — re-running: ${e instanceof Error ? e.message : e}`);
      }
    }

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
      const retries = Number(params["retries"] ?? opts.defaultRetries ?? 2);
      let patch: Record<string, unknown>;
      if (opts.remoteBlocks?.has(block.id) && opts.runRemoteBlock) {
        // Dispatch to a child task (large-2x render). Orchestrator suspends here.
        log(`block remote-dispatch: ${block.id}`);
        patch = await opts.runRemoteBlock(block.id, params);
        // The child uploaded its outputs to R2 and returned R2 keys; materialize
        // local paths so downstream blocks on THIS worker can consume them. Take
        // the BEST-EFFORT restored outputs even when rehydrate reports ok:false:
        // it restores each file independently (videoLocalPath←videoKey succeeds),
        // and a not-fully-restorable sibling (e.g. preOverlayLocalPath, used only
        // by timeline_assemble's own surgical heal) must not discard the real
        // render output that downstream blocks consume.
        if (opts.rehydrate) {
          const r = await opts.rehydrate(block.id, { ...patch });
          patch = r.outputs;
          if (!r.ok) log(`remote block ${block.id}: partial rehydrate (downstream-consumed outputs restored; a heal-only sibling may be absent)`);
        }
      } else {
        patch = await runBlockWithRetry(block, ctx, retries, log);
      }
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
      return { status: "ok", cost };
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
      return { status: "failed", cost: 0, error: message };
    }
  };

  const fail = (block: string, error: string): RunResult => ({
    ok: false,
    store,
    failedBlock: block,
    error,
    costTotal: spentUsd,
    stages,
  });

  /** Budget ceiling check — abort before any further paid block can spend. */
  const overBudget = (after: string): RunResult | null => {
    if (opts.budgetUsd > 0 && spentUsd > opts.budgetUsd) {
      const message = `budget ceiling exceeded: spent $${spentUsd.toFixed(2)} > budget $${opts.budgetUsd.toFixed(2)} after block "${after}" — aborting before further paid blocks`;
      log(message);
      return fail(after, message);
    }
    return null;
  };

  let i = 0;
  while (i < resolved.blocks.length) {
    const block = resolved.blocks[i];
    const gid = GROUP_OF.get(block.id);

    // Maximal contiguous run of same-group blocks → co-schedule. Members that
    // fail don't cancel siblings: completed work persists for resume/heal.
    if (gid !== undefined) {
      const group: Block[] = [];
      let j = i;
      while (j < resolved.blocks.length && GROUP_OF.get(resolved.blocks[j].id) === gid) {
        group.push(resolved.blocks[j]);
        j++;
      }
      if (group.length > 1) {
        log(`parallel group: ${group.map((b) => b.id).join(" ∥ ")}`);
        const results = await Promise.all(group.map((b) => executeBlock(b)));
        for (let k = 0; k < group.length; k++) {
          if (results[k].status === "failed") {
            return fail(group[k].id, results[k].error ?? "block failed");
          }
        }
        const ob = overBudget(group[group.length - 1].id);
        if (ob) return ob;
        i = j;
        continue;
      }
    }

    const res = await executeBlock(block);
    if (res.status === "failed") return fail(block.id, res.error ?? "block failed");
    const ob = overBudget(block.id);
    if (ob) return ob;
    i++;
  }

  return { ok: true, store, costTotal: spentUsd, stages };
}
