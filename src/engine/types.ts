import type { ImageUsageSummary } from "@/lib/imageUsage";

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
 * Reserved patch key a block MAY include to report what it spent (USD). The
 * runner extracts it (it never lands in the store), records it on the block's
 * runStage `cost`, accumulates it into the run total, and enforces the per-run
 * budget ceiling. Blocks that omit it cost 0. See src/engine/pricing.ts.
 */
export const COST_PATCH_KEY = "__costUsd";

/** Model-call families a composite block can inspect in its exact usage scope. */
export type CostModelUsageKind =
  | "text"
  | "vision"
  | "audio"
  | "video"
  | "embedding"
  | "other";

export interface ModelUsageCostSnapshot {
  calls: number;
  cacheHits: number;
  costUsd: number;
  unpricedCalls: number;
}

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
  /** Declared, read-only inputs from upstream artifacts. Ambient reads throw. */
  store: Readonly<Record<string, unknown>>;
  /** Exact immutable artifact ids behind the values visible to this module. */
  artifactRefs?: Readonly<Record<string, ArtifactRef>>;
  /** Per-run budget ceiling in USD (preflight asserts this is set). */
  budgetUsd: number;
  /**
   * Exact compiler reservation for this individual paid block. It is absent
   * for unpaid blocks and intentionally absent in unauthenticated/direct
   * contexts; a provider-facing block must fail closed rather than substitute
   * the broader run budget.
   */
  stageBudgetUsd?: number;
  /**
   * Re-evaluate the remaining compiler envelopes against the live artifact
   * store before a provider starts. This is for deterministic late-bound
   * contracts whose exact bounded cost is only knowable after an unpaid plan
   * stage has completed (for example, a cinematic final-master review plan).
   */
  assertRemainingBudgetReservation?: (args?: {
    reason?: string;
    requiredFuturePaidBlockIds?: readonly string[];
  }) => { reservedMaxCostUsd: number; blockIds: readonly string[] };
  /** Exact provider-token spend observed in this block's runner scope so a
   * composite cost/checkpoint can include it without estimating or hiding it. */
  modelUsageCostUsd?: (kinds?: readonly CostModelUsageKind[]) => number;
  /** Per-kind accounting detail. `costUsd` contains only exact priced usage;
   * `unpricedCalls` lets a composite apply an explicit documented fallback. */
  modelUsageAccounting?: (
    kinds?: readonly CostModelUsageKind[],
  ) => ModelUsageCostSnapshot;
  /** Exact image-provider responses observed in this block's async-local
   * scope, including model route, output dimensions, and authoritative cost. */
  imageUsageAccounting?: () => ImageUsageSummary;
  /** Structured log sink; defaults to console in the local runner. */
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface ArtifactRef {
  artifactId: string;
  key: string;
  type: string;
  schemaVersion: string;
  producerModule: string;
  producerVersion: string;
  payloadHash: string;
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
  /**
   * Optional: return the persisted outputs of blocks that already completed "ok"
   * for this run, so a resumed run can skip them (no double-spend on paid blocks).
   */
  getCompleted?(runId: string): Promise<Array<{ block: string; outputs: unknown; cost?: number }>>;
  /**
   * Optional full resume snapshot. Production sinks should implement this so a
   * worker retry can distinguish a fresh stage from paid work that was already
   * started but whose provider response was lost with the previous process.
   * Implementations should return this from the same read used for completed
   * stages; the runner must not add a second persistence query for the fence.
   */
  getResumeState?(runId: string): Promise<
    Array<{
      block: string;
      status: string;
      outputs?: unknown;
      cost?: number;
      startedAt?: number;
      error?: string;
    }>
  >;
  /** Persist a first-class, content-addressed artifact and its exact lineage. */
  upsertArtifact?(args: {
    ownerId: string;
    channelId: string;
    runId: string;
    artifact: ArtifactRef;
    inputArtifactIds: string[];
    optionalFallbacks: string[];
    persistence: "inline" | "reference" | "summary";
    payload?: unknown;
    summary?: string;
    createdAt: number;
  }): Promise<void>;
}
