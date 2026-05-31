/**
 * Core block-engine contract (MASTER-PLAN §D).
 *
 * A block is a typed step that declares what keys it `consumes` and `produces`.
 * Blocks never pass file paths between processes; everything is addressed by
 * Convex ids + R2 keys carried in the StageContext key/value store.
 */

/** Outputs a block writes back into the shared store. */
export type BlockPatch = Record<string, unknown>;

/**
 * Execution context handed to every block. Carries run identity plus a
 * key/value store of outputs produced by upstream blocks. A block reads its
 * declared `consumes` keys from `store` and returns a patch of its `produces`.
 */
export interface StageContext {
  ownerId: string;
  runId: string;
  channelId: string;
  /** Per-channel R2 key prefix, e.g. `owner/<ownerId>/channel/<slug>/`. */
  keyPrefix: string;
  /** Block params from the channel's pipeline entry. */
  params: Record<string, unknown>;
  /** Accumulated outputs from upstream blocks (the produced key/value store). */
  store: Record<string, unknown>;
  /** Per-run budget ceiling in USD (preflight asserts this is set). */
  budgetUsd: number;
  /** Structured log sink; defaults to console in the local runner. */
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

/** A registered, executable pipeline step. */
export interface Block {
  /** Unique block id (matches `pipeline[].block`). */
  id: string;
  /** Store keys this block requires to exist before it runs. */
  consumes: string[];
  /** Store keys this block guarantees to write on success. */
  produces: string[];
  /** Paid blocks are preflighted (budget/key/credits) + idempotent. */
  paid?: boolean;
  /** Execute the block; return a patch of produced outputs. */
  run: (ctx: StageContext) => Promise<BlockPatch>;
}

/** One entry of a channel's ordered pipeline. */
export interface PipelineEntry {
  block: string;
  params?: Record<string, unknown>;
}

/** Stage status mirrors the Convex runStages.status enum. */
export type StageStatus = "queued" | "running" | "ok" | "failed" | "skipped";

/** Sink the runner uses to persist stage transitions (Convex-backed in prod). */
export interface RunStageSink {
  upsert(args: {
    ownerId: string;
    runId: string;
    block: string;
    status: StageStatus;
    startedAt?: number;
    finishedAt?: number;
    cost?: number;
    inputs?: unknown;
    outputs?: unknown;
    error?: string;
  }): Promise<void>;
}
