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
  type ArtifactRef,
  type Block,
  type CostModelUsageKind,
  type ModelUsageCostSnapshot,
  type ResumeRehydrationRequest,
  type RunStageSink,
  type StageContext,
  type StageStatus,
} from "./types";
import type { ResolvedPipeline } from "./validate";
import type { VisualRepairSignal } from "./healer";
import { createHash } from "node:crypto";
import { artifactContract, validateArtifact } from "./artifactSchemas";
import {
  classifyExecutionError,
  executionRetryDelayMs,
  type ExecutionRetryScope,
} from "./executionErrors";
import { configuredMaxCostUsd, type ModuleManifest } from "./moduleManifest";
import { createModelUsageScope, type ModelUsageSummary } from "@/lib/modelUsage";
import { createImageUsageScope, type ImageUsageSummary } from "@/lib/imageUsage";
import type { RunExecutionLeaseFence } from "@/lib/runLease";

export interface RunPipelineOptions {
  ownerId: string;
  runId: string;
  channelId: string;
  /** Active generation required by Trigger-originated durable side effects. */
  executionLease?: RunExecutionLeaseFence;
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
   * Default true. Production supplies sink.getCompleted + rehydrate. If a
   * completed paid stage cannot be rehydrated, execution fails closed instead
   * of purchasing the provider output again.
   */
  resume?: boolean;
  /**
   * Make a completed block's persisted outputs usable again on a fresh worker —
   * re-download local files from their R2 keys. Returns ok:false if it can't;
   * only unpaid blocks may then regenerate automatically. Supplied by the
   * Trigger task (keeps the engine free of storage deps).
   */
  rehydrate?: (
    block: string,
    outputs: Record<string, unknown>,
    request?: ResumeRehydrationRequest,
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
  /**
   * Optional non-failure execution boundary. Once this exact sequential block
   * has written its durable `ok` stage, the runner returns `awaiting_review`
   * instead of starting any later block. A block that belongs to a parallel
   * group is deliberately rejected: there is no safe "after this member"
   * point while siblings can still be executing.
   */
  stopAfterBlockId?: string;
}

/**
 * Durable error marker shared with remote-child dispatch. A stage carrying it
 * may have accepted paid work whose exact receipt is not yet reconciled, so
 * resume and self-heal must never replay it automatically.
 */
export const PAID_STAGE_RECONCILIATION_MARKER = "PAID_STAGE_RECONCILIATION_REQUIRED";

/** Terminal runner state. `awaiting_review` is a successful, durable stop. */
export type RunResultStatus = "completed" | "awaiting_review" | "failed";

export interface RunResult {
  ok: boolean;
  /** Explicitly distinguishes normal completion from an approved safe stop. */
  status: RunResultStatus;
  store: Record<string, unknown>;
  failedBlock?: string;
  error?: string;
  /** Present only when `status === "awaiting_review"`. */
  stoppedAfterBlockId?: string;
  /**
   * A transient failure that must be re-entered by the durable task scheduler,
   * not retried in-process while an external lease remains live.
   */
  retryDirective?: {
    readonly scope: ExecutionRetryScope;
    readonly code?: string;
    readonly retryAfterMs?: number;
  };
  /** Bounded visual-review repair signals preserved across the runner boundary. */
  visualRepair?: VisualRepairSignal[];
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

/** Spend a provider adapter observed before throwing (for failed paid calls). */
function observedCostFromError(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const raw = (error as { observedCostUsd?: unknown }).observedCostUsd;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0
    ? raw
    : undefined;
}

/**
 * Paid work outside the model/image async scopes. Unlike observedCostUsd this
 * is supplemental, so it is added after scope reconciliation rather than used
 * as a competing whole-attempt total.
 */
function additionalObservedCostFromError(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const raw = (error as { additionalObservedCostUsd?: unknown }).additionalObservedCostUsd;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0
    ? raw
    : undefined;
}

function visualRepairFromError(error: unknown): VisualRepairSignal[] | undefined {
  if (!error || typeof error !== "object") return undefined;
  const raw = (error as { visualRepair?: unknown }).visualRepair;
  if (!Array.isArray(raw)) return undefined;
  const signals = raw.filter((signal): signal is VisualRepairSignal =>
    Boolean(
      signal &&
      typeof signal === "object" &&
      (signal as { schemaVersion?: unknown }).schemaVersion === 1 &&
      typeof (signal as { owner?: unknown }).owner === "string" &&
      typeof (signal as { action?: unknown }).action === "string",
    ),
  );
  return signals.length ? signals : undefined;
}

function trackedUsageForKinds(
  summary: ModelUsageSummary,
  kinds?: ReadonlySet<CostModelUsageKind>,
): ModelUsageCostSnapshot {
  return summary.groups.reduce<ModelUsageCostSnapshot>(
    (total, group) => {
      if (kinds && !kinds.has(group.kind)) return total;
      return {
        calls: total.calls + group.calls,
        cacheHits: total.cacheHits + group.cacheHits,
        costUsd: total.costUsd + group.costUsd,
        unpricedCalls: total.unpricedCalls + group.unpricedCalls,
      };
    },
    { calls: 0, cacheHits: 0, costUsd: 0, unpricedCalls: 0 },
  );
}

function trackedCostForKinds(
  summary: ModelUsageSummary,
  kinds: ReadonlySet<CostModelUsageKind>,
): number {
  return trackedUsageForKinds(summary, kinds).costUsd;
}

/**
 * Upgrade persisted outputs from module-contract versions that predate a
 * required field. A legacy thumbnail has no evidence that it passed the new
 * publishability contract, so migration is deliberately fail-closed.
 */
export function migrateCachedOutputsForResume(
  blockId: string,
  outputs: Record<string, unknown>,
): Record<string, unknown> {
  if (blockId !== "thumbnail_gen" || outputs["thumbnailPublishable"] !== undefined) {
    return outputs;
  }
  return { ...outputs, thumbnailPublishable: false };
}

function hasModelUsage(summary: ModelUsageSummary): boolean {
  return summary.calls > 0 || summary.cacheHits > 0 || summary.unpricedCalls > 0;
}

/** Bound operator/module retry knobs so malformed values cannot loop forever. */
function normalizeRetryCount(value: unknown, fallback: unknown): number {
  const fallbackNumber = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNumber)
    ? Math.max(0, Math.min(5, Math.floor(fallbackNumber)))
    : 2;
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.min(5, Math.floor(number)))
    : safeFallback;
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
      // Once a block reports accepted paid work, retrying the whole block can
      // purchase it again. Provider adapters must recover an accepted job in
      // place; otherwise leave the pipeline failed for persisted resume/heal.
      if ((additionalObservedCostFromError(err) ?? 0) > 0) throw err;
      const classification = classifyExecutionError(err);
      if (classification.retryable && classification.retryScope === "durable_task") {
        // A durable authority has told us exactly when work can become
        // claimable. Holding this worker for that lease wastes infrastructure
        // and can still expire before the next attempt; hand it to the task
        // scheduler instead.
        throw err;
      }
      attempt++;
      if (attempt > retries || !classification.retryable) throw err;
      const backoff = executionRetryDelayMs(classification, attempt);
      log(
        `block ${block.id}: transient error (retry ${attempt}/${retries} in ${backoff}ms): ${classification.message.slice(0, 160)}`,
        {
          errorKind: classification.kind,
          retryReason: classification.reason,
          ...(classification.status !== undefined ? { status: classification.status } : {}),
          ...(classification.code ? { code: classification.code } : {}),
        },
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
}

function stableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function artifactSummary(value: unknown): string {
  if (typeof value === "string") return value.length <= 300 ? value : `${value.slice(0, 300)}…[${value.length} chars]`;
  if (Array.isArray(value)) return `[array:${value.length}]`;
  if (value && typeof value === "object") return `[object:${Object.keys(value as object).length} keys]`;
  return String(value);
}

/** Build the only store view a module may observe. */
export function declaredArtifactStore(
  manifest: ModuleManifest,
  store: Record<string, unknown>,
  optionalFallbacks: Set<string>,
  log: (message: string) => void = () => {},
): Readonly<Record<string, unknown>> {
  const required = new Set(Object.keys(manifest.consumes));
  const optional = new Set(Object.keys(manifest.optionalConsumes));
  const allowed = new Set([...required, ...optional]);
  const assertAllowed = (property: PropertyKey): string | null => {
    if (typeof property === "symbol") return null;
    const key = String(property);
    if (!allowed.has(key)) {
      throw new Error(
        `module "${manifest.id}" attempted undeclared artifact read "${key}"; add it to consumes/optionalConsumes`,
      );
    }
    return key;
  };
  return new Proxy(store, {
    get(target, property, receiver) {
      const key = assertAllowed(property);
      if (key === null) return Reflect.get(target, property, receiver);
      if (optional.has(key) && !Reflect.has(target, key) && !optionalFallbacks.has(key)) {
        optionalFallbacks.add(key);
        log(`module ${manifest.id}: optional artifact "${key}" absent; deterministic fallback recorded`);
      }
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      const key = assertAllowed(property);
      return key === null ? Reflect.has(target, property) : Reflect.has(target, key);
    },
    ownKeys(target) {
      return [...allowed].filter((key) => Reflect.has(target, key));
    },
    getOwnPropertyDescriptor(target, property) {
      const key = assertAllowed(property);
      return key === null
        ? Reflect.getOwnPropertyDescriptor(target, property)
        : Reflect.getOwnPropertyDescriptor(target, key);
    },
    set() {
      throw new Error(`module "${manifest.id}" attempted to mutate the read-only artifact store`);
    },
    deleteProperty() {
      throw new Error(`module "${manifest.id}" attempted to delete from the read-only artifact store`);
    },
    defineProperty() {
      throw new Error(`module "${manifest.id}" attempted to redefine the read-only artifact store`);
    },
  });
}

function assertProduced(manifest: ModuleManifest, patch: Record<string, unknown>): void {
  const declared = new Set([
    ...Object.keys(manifest.produces),
    ...Object.keys(manifest.optionalProduces),
  ]);
  const extra = Object.keys(patch).filter((key) => key !== COST_PATCH_KEY && !declared.has(key));
  if (extra.length) {
    throw new Error(
      `module "${manifest.id}" returned undeclared artifact(s): ${extra.join(", ")}`,
    );
  }
  for (const [key, contract] of Object.entries(manifest.produces)) {
    const val = patch[key];
    if (val === undefined || val === null) {
      throw new Error(
        `module "${manifest.id}" declared it produces "${key}" but returned ${val === undefined ? "undefined" : "null"} (no silent fallbacks)`,
      );
    }
    try {
      validateArtifact(contract, val);
    } catch (error) {
      throw new Error(
        `module "${manifest.id}" returned invalid ${contract.type}@${contract.version} for "${key}": ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  for (const [key, contract] of Object.entries(manifest.optionalProduces)) {
    const value = patch[key];
    if (value === undefined || value === null) continue;
    try {
      validateArtifact(contract, value);
    } catch (error) {
      throw new Error(
        `module "${manifest.id}" returned invalid optional ${contract.type}@${contract.version} for "${key}": ${error instanceof Error ? error.message : error}`,
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
  const artifactRefs: Record<string, ArtifactRef> = {};
  for (const [key, value] of Object.entries(store)) {
    const contract = artifactContract(key);
    const payloadHash = hashPayload(value);
    artifactRefs[key] = {
      artifactId: `${opts.runId}:seed:${key}:${payloadHash.slice(0, 16)}`,
      key,
      type: contract.type,
      schemaVersion: contract.version,
      producerModule: "$seed",
      producerVersion: "1.0.0",
      payloadHash,
    };
  }
  const stages: { block: string; status: StageStatus }[] = [];
  let spentUsd = 0;

  /**
   * A review boundary is valid only at one known strictly-sequential entry.
   * Validate it before loading a resume snapshot or starting any block so an
   * unsafe request cannot accidentally advance provider work.
   */
  const requestedBoundary = opts.stopAfterBlockId?.trim();
  let boundaryIndex: number | undefined;
  if (opts.stopAfterBlockId !== undefined) {
    const matchingIndexes = requestedBoundary
      ? resolved.blocks
          .map((block, index) => (block.id === requestedBoundary ? index : -1))
          .filter((index) => index >= 0)
      : [];
    const boundaryError =
      !requestedBoundary
        ? "REVIEW_BOUNDARY_UNSAFE: stopAfterBlockId must be a non-empty block id"
        : matchingIndexes.length !== 1
          ? `REVIEW_BOUNDARY_UNSAFE: block "${requestedBoundary}" must occur exactly once in the resolved pipeline`
          : GROUP_OF.has(requestedBoundary)
            ? `REVIEW_BOUNDARY_UNSAFE: block "${requestedBoundary}" belongs to a parallel group and cannot be a review boundary`
            : undefined;
    if (boundaryError) {
      log(boundaryError);
      return {
        ok: false,
        status: "failed",
        store,
        failedBlock: requestedBoundary || undefined,
        error: boundaryError,
        costTotal: spentUsd,
        stages,
      };
    }
    boundaryIndex = matchingIndexes[0]!;
  }

  // Resume: load already-completed blocks' persisted outputs (skip + restore).
  // Their recorded COSTS seed spentUsd so (a) the budget ceiling covers the
  // WHOLE run, not just this invocation (heal cycles previously reset it and
  // could silently blow the channel budget), and (b) runs.costTotal reports
  // the cumulative truth.
  const completedMap: Record<string, Record<string, unknown>> = {};
  const priorStageMap = new Map<
    string,
    { status: string; cost?: number; startedAt?: number; error?: string }
  >();
  if (
    opts.resume !== false &&
    (opts.sink.getResumeState || opts.sink.getCompleted)
  ) {
    try {
      // Production uses one full-state read for both completed-output resume and
      // the interrupted-paid-stage fence. Keep getCompleted as a compatibility
      // fallback for small in-memory/test sinks.
      const rows: Array<{
        block: string;
        status: string;
        outputs?: unknown;
        cost?: number;
        startedAt?: number;
        error?: string;
      }> = opts.sink.getResumeState
        ? await opts.sink.getResumeState(opts.runId)
        : (await opts.sink.getCompleted!(opts.runId)).map((row) => ({
            ...row,
            status: "ok",
          }));
      for (const row of rows) {
        priorStageMap.set(row.block, {
          status: row.status,
          cost: row.cost,
          startedAt: row.startedAt,
          error: row.error,
        });
        if (row.status !== "ok") continue;
        if (row.outputs && typeof row.outputs === "object") {
          completedMap[row.block] = row.outputs as Record<string, unknown>;
          if (typeof row.cost === "number" && Number.isFinite(row.cost) && row.cost > 0) {
            spentUsd += row.cost;
          }
        }
      }
      const n = Object.keys(completedMap).length;
      if (n > 0) log(`resume: ${n} block(s) previously completed — will restore + skip (prior spend $${spentUsd.toFixed(2)} carried into the budget)`);
    } catch (e) {
      // Fail closed. Treating a persistence outage as "no completed stages"
      // silently re-runs every paid block and can double-charge a whole video.
      log(`resume: getCompleted failed — refusing to run fresh: ${e instanceof Error ? e.message : e}`);
      throw e;
    }
  }

  const declaredInputKeysAt = (blockIndex: number): Set<string> => {
    const manifest = resolved.manifests[blockIndex];
    const block = resolved.blocks[blockIndex];
    if (!manifest || !block) {
      throw new Error(`resolved block has no executable manifest at step ${blockIndex}`);
    }
    return new Set([
      ...manifest.block.consumes,
      ...Object.keys(manifest.consumes),
      ...Object.keys(manifest.optionalConsumes),
    ]);
  };

  /**
   * A remote render task reconstructs its own declared inputs from durable
   * stages, so the parent does not need to fetch those media files merely to
   * dispatch it. Only later blocks that will execute locally on THIS worker
   * require a local materialisation. The complete patch still stays in the
   * store, and the rehydrator validates omitted R2-backed paths cheaply. A
   * review boundary also cuts the demand plan there: do not download media for
   * blocks this invocation is guaranteed not to start.
   */
  const localConsumerKeysAfter = (blockIndex: number): Set<string> => {
    const needed = new Set<string>();
    const lastExecutableIndex = boundaryIndex ?? resolved.blocks.length - 1;
    for (let candidateIndex = blockIndex + 1; candidateIndex <= lastExecutableIndex; candidateIndex++) {
      const candidate = resolved.blocks[candidateIndex]!;
      if (completedMap[candidate.id]) continue;
      if (opts.remoteBlocks?.has(candidate.id) && opts.runRemoteBlock) continue;
      for (const key of declaredInputKeysAt(candidateIndex)) needed.add(key);
    }
    return needed;
  };

  /**
   * A completed local stage normally needs no upstream bytes at all. If its
   * own cache cannot be restored and an unpaid stage therefore falls back to
   * execution, restore only its declared cached inputs immediately before that
   * execution. This keeps the normal resume demand-driven while preserving the
   * old full-rehydration guarantee for the rare fallback path.
   */
  const rehydrateCachedInputsForLocalFallback = async (
    block: Block,
    blockIndex: number,
  ): Promise<void> => {
    if (!opts.rehydrate) return;
    const needed = declaredInputKeysAt(blockIndex);
    if (needed.size === 0) return;

    // Select the latest completed source for every input. Earlier producers
    // must not overwrite a later stage's value while the fallback is healed.
    const remaining = new Set(needed);
    const sources: Array<{ index: number; keys: Set<string> }> = [];
    for (let sourceIndex = blockIndex - 1; sourceIndex >= 0 && remaining.size > 0; sourceIndex--) {
      const source = resolved.blocks[sourceIndex]!;
      const sourceOutputs = completedMap[source.id];
      if (!sourceOutputs) continue;
      const supplied = new Set([...remaining].filter((key) => key in sourceOutputs));
      if (supplied.size === 0) continue;
      sources.push({ index: sourceIndex, keys: supplied });
      for (const key of supplied) remaining.delete(key);
    }

    for (const { index, keys } of sources.reverse()) {
      const source = resolved.blocks[index]!;
      const sourceOutputs = completedMap[source.id]!;
      // Preserve any path already materialised during this invocation. The
      // restore boundary receives the complete source patch for its durable
      // HEAD fence, but only the demanded keys are allowed to update the store.
      const candidate = { ...sourceOutputs };
      for (const key of keys) {
        if (key in store) candidate[key] = store[key];
        const base = key.replace(/(LocalPath|Url|Path)$/, "");
        const siblingKeys = [
          ...(base === key ? [] : [`${base}Key`]),
          ...(key.endsWith("Clips") ? [`${key.replace(/Clips$/, "")}Keys`] : []),
        ];
        for (const sibling of siblingKeys) {
          if (sibling in store) candidate[sibling] = store[sibling];
        }
      }
      const restored = await opts.rehydrate(source.id, candidate, {
        neededOutputKeys: keys,
      });
      if (!restored.ok) {
        throw new Error(
          `CACHED_INPUT_REHYDRATION_REQUIRED: cached upstream block "${source.id}" ` +
          `cannot materialize declared input(s) ${[...keys].sort().join(", ")} ` +
          `for fallback block "${block.id}"`,
        );
      }
      const outputs = migrateCachedOutputsForResume(source.id, restored.outputs);
      for (const key of keys) {
        if (key in outputs) store[key] = outputs[key];
      }
    }
  };

  const persistProducedArtifacts = async (
    manifest: ModuleManifest,
    patch: Record<string, unknown>,
    inputRefs: Readonly<Record<string, ArtifactRef>>,
    optionalFallbacks: Set<string>,
  ): Promise<void> => {
    const inputArtifactIds = [...new Set(Object.values(inputRefs).map((ref) => ref.artifactId))].sort();
    const sortedFallbacks = [...optionalFallbacks].sort();

    // Derive every artifact this block produced FIRST, then persist the whole
    // set in one round-trip. Blocks routinely produce 2-14 outputs and this
    // used to cost one Convex mutation per produced key.
    const produced: Array<{
      key: string;
      artifact: ArtifactRef;
      value: unknown;
      contract: ModuleManifest["produces"][string];
    }> = [];
    for (const [key, contract] of [
      ...Object.entries(manifest.produces),
      ...Object.entries(manifest.optionalProduces),
    ]) {
      const value = patch[key];
      if (value === undefined || value === null) continue;
      const payloadHash = hashPayload(value);
      const identityHash = hashPayload({
        payloadHash,
        inputArtifactIds,
        moduleId: manifest.id,
        moduleVersion: manifest.version,
        artifactKey: key,
      });
      const artifact: ArtifactRef = {
        artifactId: `${opts.runId}:${manifest.id}:${key}:${identityHash.slice(0, 16)}`,
        key,
        type: contract.type,
        schemaVersion: contract.version,
        producerModule: manifest.id,
        producerVersion: manifest.version,
        payloadHash,
      };
      produced.push({ key, artifact, value, contract });
    }
    if (produced.length === 0) return;

    if (opts.sink.upsertArtifacts) {
      // One timestamp for the block: these artifacts are written by a single
      // transaction, so they share a creation instant instead of drifting by
      // however long the loop took.
      const createdAt = Date.now();
      await opts.sink.upsertArtifacts({
        ownerId: opts.ownerId,
        channelId: opts.channelId,
        runId: opts.runId,
        artifacts: produced.map(({ artifact, value, contract }) => {
          const serialized = stableJson(value);
          const canInline = contract.persist !== "summary" && serialized.length <= 100_000;
          return {
            artifact,
            inputArtifactIds,
            optionalFallbacks: sortedFallbacks,
            persistence: canInline ? contract.persist : "summary",
            payload: canInline ? value : undefined,
            summary: canInline ? undefined : artifactSummary(value),
            createdAt,
          };
        }),
      });
    }
    // Only advertise refs once the batch is durable. The write is atomic, so
    // a throw above means NO artifact of this block was persisted and none
    // should be offered as lineage to a downstream block.
    for (const { key, artifact } of produced) artifactRefs[key] = artifact;
  };

  /**
   * Execute one block end-to-end (resume-restore | run+retry), persist its
   * stage, merge its patch into the shared store. Returns the outcome instead
   * of throwing so group execution can collect every member's result.
   */
  const executeBlock = async (
    block: Block,
    blockIndex: number,
  ): Promise<{
    status: "ok" | "failed";
    cost: number;
    error?: string;
    visualRepair?: VisualRepairSignal[];
    retryDirective?: RunResult["retryDirective"];
  }> => {
    const manifest = resolved.manifests[blockIndex];
    if (!manifest) {
      throw new Error(`resolved block "${block.id}" has no executable manifest`);
    }
    if (manifest.id !== block.id) {
      throw new Error(
        `resolved pipeline alignment mismatch at step ${blockIndex}: block=${block.id}, manifest=${manifest.id}`,
      );
    }
    const params = opts.paramsByBlock?.[block.id] ?? resolved.entries[blockIndex]?.params ?? {};
    const priorStage = priorStageMap.get(block.id);
    // Remote child work is normally keyed by Trigger's durable idempotency key;
    // a parent retry can reattach to that child instead of deadlocking itself.
    // A remote child marked as requiring reconciliation is different: it may
    // have accepted paid work, but the durable per-operation receipt ledger is
    // not authoritative yet. The marker (currently emitted for DocuMotion)
    // must fence replay exactly like an ambiguous inline paid stage. Keying
    // this on the marker rather than a block name also makes the safety
    // invariant hold if another remote paid child adopts the same protocol.
    const remotePaidFailureNeedsReconciliation =
      opts.remoteBlocks?.has(block.id) === true &&
      priorStage?.status === "failed" &&
      priorStage.error?.includes(PAID_STAGE_RECONCILIATION_MARKER) === true;
    const paidStageNeedsReconciliation =
      manifest.costAndLatency.paid &&
      (remotePaidFailureNeedsReconciliation ||
        (!opts.remoteBlocks?.has(block.id) &&
          (priorStage?.status === "running" ||
            (priorStage?.status === "failed" &&
              priorStage.error?.includes(PAID_STAGE_RECONCILIATION_MARKER)))));
    if (paidStageNeedsReconciliation) {
      const started = priorStage?.startedAt
        ? ` (started ${new Date(priorStage.startedAt).toISOString()})`
        : "";
      const message =
        `${PAID_STAGE_RECONCILIATION_MARKER}: paid block "${block.id}" was left ` +
        `${priorStage?.status ?? "unknown"}${started}; refusing automatic replay because the ` +
        "provider may already have accepted or completed the charge. Reconcile the provider receipt, then supersede the stage or start a new run.";
      await opts.sink.upsert({
        ownerId: opts.ownerId,
        runId: opts.runId,
        block: block.id,
        status: "failed",
        finishedAt: Date.now(),
        error: message,
      });
      stages.push({ block: block.id, status: "failed" });
      log(message);
      return { status: "failed", cost: 0, error: message };
    }
    // Debug snapshot only — SUMMARIZED. Persisting the full consumed values
    // (whole scripts, clip-path arrays, timing tables) shipped hundreds of KB
    // per stage transition to every open dashboard for zero consumer value.
    const summarize = (v: unknown): unknown => {
      if (v == null || typeof v === "number" || typeof v === "boolean") return v;
      if (typeof v === "string") return v.length <= 300 ? v : `${v.slice(0, 300)}…[${v.length} chars]`;
      if (Array.isArray(v)) return `[array:${v.length}]`;
      if (typeof v === "object") return `[object:${Object.keys(v as object).length} keys]`;
      return String(v);
    };
    const inputs = Object.fromEntries(block.consumes.map((k) => [k, summarize(store[k])]));

    const refusePaidCachedReplay = async (reason: string) => {
      const message =
        `${PAID_STAGE_RECONCILIATION_MARKER}: completed paid block "${block.id}" ` +
        `${reason}; refusing automatic regeneration because it would create a second charge. ` +
        "Restore the durable artifacts or explicitly supersede the stage after reconciliation.";
      await opts.sink.upsert({
        ownerId: opts.ownerId,
        runId: opts.runId,
        block: block.id,
        status: "failed",
        finishedAt: Date.now(),
        error: message,
      });
      stages.push({ block: block.id, status: "failed" });
      log(message);
      return { status: "failed" as const, cost: 0, error: message };
    };

    // RESUME: restore a previously-completed block instead of re-running it.
    // A confirmed-missing artifact may be regenerated only for an unpaid block;
    // completed paid work always requires explicit reconciliation/supersession.
    const cached = completedMap[block.id];
    let cachedFallbackToLocalRun = false;
    if (cached && !opts.rehydrate) {
      if (manifest.costAndLatency.paid) {
        return await refusePaidCachedReplay("has no configured artifact rehydrator");
      }
      log(`block ${block.id}: cached outputs cannot be rehydrated — re-running unpaid block`);
      cachedFallbackToLocalRun = true;
    } else if (cached && opts.rehydrate) {
      try {
        const restored = await opts.rehydrate(block.id, { ...cached }, {
          neededOutputKeys: localConsumerKeysAfter(blockIndex),
        });
        const outputs = migrateCachedOutputsForResume(block.id, restored.outputs);
        const { ok } = restored;
        if (ok) {
          delete outputs[COST_PATCH_KEY];
          assertProduced(manifest, outputs);
          const allowedInputs = new Set([
            ...Object.keys(manifest.consumes),
            ...Object.keys(manifest.optionalConsumes),
          ]);
          const inputRefs = Object.fromEntries(
            Object.entries(artifactRefs).filter(([key]) => allowedInputs.has(key)),
          );
          await persistProducedArtifacts(manifest, outputs, inputRefs, new Set());
          Object.assign(store, outputs);
          // NOTE: cost intentionally OMITTED — the upsert mutation skips
          // undefined fields, so the block's ORIGINAL recorded spend survives
          // the restore (a `cost: 0` here used to wipe it, destroying cost
          // accounting on every resume/heal).
          await opts.sink.upsert({
            ownerId: opts.ownerId,
            runId: opts.runId,
            block: block.id,
            status: "ok",
            finishedAt: Date.now(),
            outputs,
          });
          stages.push({ block: block.id, status: "ok" });
          log(`block resumed (cached, no re-spend): ${block.id}`);
          return { status: "ok", cost: 0 };
        }
        if (manifest.costAndLatency.paid) {
          return await refusePaidCachedReplay("has missing or non-rehydratable durable outputs");
        }
        log(`block ${block.id}: cached outputs not rehydratable — re-running unpaid block`);
        cachedFallbackToLocalRun = true;
      } catch (e) {
        // A thrown rehydrate error means storage/auth/transport itself failed,
        // not that this artifact is known missing. Re-running a paid producer
        // under an R2 outage converts an infrastructure incident into spend.
        log(`block ${block.id}: rehydrate infrastructure failed — refusing paid re-run: ${e instanceof Error ? e.message : e}`);
        throw e;
      }
    }

    // Reserve only for work that will actually execute. Restored stages already
    // contributed their persisted cost above and need no second envelope.
    let configuredEnvelope: number | undefined;
    if (manifest.costAndLatency.paid && manifest.costAndLatency.maxCostUsd !== undefined) {
      configuredEnvelope = configuredMaxCostUsd(manifest, params, {
        entries: resolved.entries,
        index: blockIndex,
        store,
      });
      if (
        opts.budgetUsd > 0 &&
        spentUsd + configuredEnvelope > opts.budgetUsd + Number.EPSILON
      ) {
        const message =
          `budget reservation rejected before paid block "${block.id}": ` +
          `$${spentUsd.toFixed(2)} spent + $${configuredEnvelope.toFixed(2)} reserved > ` +
          `$${opts.budgetUsd.toFixed(2)} budget`;
        await opts.sink.upsert({
          ownerId: opts.ownerId,
          runId: opts.runId,
          block: block.id,
          status: "failed",
          finishedAt: Date.now(),
          error: message,
        });
        stages.push({ block: block.id, status: "failed" });
        log(message);
        return { status: "failed", cost: 0, error: message };
      }
    }

    /**
     * A deterministic planning block can emit an exact bounded cost only after
     * the run has begun. Let the first subsequent paid renderer re-evaluate all
     * still-pending envelopes against that durable store before it calls a
     * provider. This complements compile-time preflight; it never replaces it.
     */
    const assertRemainingBudgetReservation: NonNullable<StageContext["assertRemainingBudgetReservation"]> = (
      args = {},
    ) => {
      const blockIds: string[] = [];
      let reservedMaxCostUsd = 0;
      for (let candidateIndex = blockIndex; candidateIndex < resolved.blocks.length; candidateIndex++) {
        const candidate = resolved.blocks[candidateIndex]!;
        if (candidateIndex !== blockIndex && completedMap[candidate.id]) continue;
        const candidateManifest = resolved.manifests[candidateIndex];
        if (!candidateManifest) {
          throw new Error(`remaining budget reservation lost manifest alignment at step ${candidateIndex}`);
        }
        if (!candidateManifest.costAndLatency.paid) continue;
        const candidateParams =
          opts.paramsByBlock?.[candidate.id] ?? resolved.entries[candidateIndex]?.params ?? {};
        const candidateEnvelope =
          candidateIndex === blockIndex && configuredEnvelope !== undefined
            ? configuredEnvelope
            : configuredMaxCostUsd(candidateManifest, candidateParams, {
                entries: resolved.entries,
                index: candidateIndex,
                store,
              });
        reservedMaxCostUsd += candidateEnvelope;
        blockIds.push(candidate.id);
      }
      const required = args.requiredFuturePaidBlockIds ?? [];
      const missing = required.filter((id) => !blockIds.includes(id));
      if (missing.length > 0) {
        throw new Error(
          `remaining budget reservation requires pending paid block(s) ${missing.join(", ")}, but found ${blockIds.join(", ") || "none"}`,
        );
      }
      if (
        opts.budgetUsd > 0 &&
        spentUsd + reservedMaxCostUsd > opts.budgetUsd + Number.EPSILON
      ) {
        const reason = args.reason ? ` (${args.reason})` : "";
        throw new Error(
          `budget reservation rejected before paid block "${block.id}"${reason}: ` +
            `$${spentUsd.toFixed(2)} spent + $${reservedMaxCostUsd.toFixed(2)} remaining reserved ` +
            `for ${blockIds.join(", ")} > $${opts.budgetUsd.toFixed(2)} budget`,
        );
      }
      return { reservedMaxCostUsd, blockIds };
    };

    await opts.sink.upsert({
      ownerId: opts.ownerId,
      runId: opts.runId,
      block: block.id,
      status: "running",
      startedAt: Date.now(),
      inputs,
    });

    const optionalFallbacks = new Set<string>();
    const allowedInputs = new Set([
      ...Object.keys(manifest.consumes),
      ...Object.keys(manifest.optionalConsumes),
    ]);
    const inputRefs = Object.fromEntries(
      Object.entries(artifactRefs).filter(([key]) => allowedInputs.has(key)),
    );
    const checkpointVisualArtifactAttempts: NonNullable<
      StageContext["checkpointVisualArtifactAttempts"]
    > = async (attempts) => {
      if (attempts.length === 0) return [];
      if (attempts.length > 64) {
        throw new Error(
          `visual artifact attempt checkpoint for "${block.id}" exceeds the 64-record batch limit`,
        );
      }
      // Unlike normal block outputs, an attempt is an audit event rather than
      // a store value. It must be durable before a caller requests another
      // candidate, and it must not be advertised through artifactRefs.
      if (!opts.sink.upsertArtifacts) {
        throw new Error(
          `visual artifact attempt checkpoint for "${block.id}" requires a durable artifact sink`,
        );
      }
      const contract = artifactContract("visualArtifactAttempt");
      if (contract.opaque || contract.persist !== "reference") {
        throw new Error("visual artifact attempt contract must be a typed reference artifact");
      }
      const inputArtifactIds = [
        ...new Set(Object.values(inputRefs).map((ref) => ref.artifactId)),
      ].sort();
      const optionalFallbackSnapshot = [...optionalFallbacks].sort();
      const seenAttemptFingerprints = new Set<string>();
      const createdAt = Date.now();
      const artifacts = attempts.map((attempt) => {
        const value = validateArtifact(contract, attempt);
        const serialized = stableJson(value);
        if (serialized.length > 100_000) {
          // A summary would erase the exact rejected/accepted evidence that
          // makes this checkpoint useful, so fail closed instead.
          throw new Error("visual artifact attempt checkpoint exceeds durable payload limit");
        }
        const payloadHash = hashPayload(value);
        if (seenAttemptFingerprints.has(payloadHash)) {
          throw new Error("visual artifact attempt checkpoint repeats an identical attempt");
        }
        seenAttemptFingerprints.add(payloadHash);
        const identityHash = hashPayload({
          payloadHash,
          inputArtifactIds,
          moduleId: manifest.id,
          moduleVersion: manifest.version,
          artifactKey: "visualArtifactAttempt",
        });
        const artifact: ArtifactRef = {
          artifactId: `${opts.runId}:${manifest.id}:visualArtifactAttempt:${identityHash.slice(0, 16)}`,
          key: "visualArtifactAttempt",
          type: contract.type,
          schemaVersion: contract.version,
          producerModule: manifest.id,
          producerVersion: manifest.version,
          payloadHash,
        };
        return {
          artifact,
          inputArtifactIds,
          optionalFallbacks: optionalFallbackSnapshot,
          persistence: "reference" as const,
          payload: value,
          createdAt,
        };
      });
      await opts.sink.upsertArtifacts({
        ownerId: opts.ownerId,
        channelId: opts.channelId,
        runId: opts.runId,
        artifacts,
      });
      return artifacts.map((entry) => entry.artifact);
    };
    const usageScope = createModelUsageScope();
    const imageUsageScope = createImageUsageScope();
    const ctx: StageContext = {
      ownerId: opts.ownerId,
      runId: opts.runId,
      channelId: opts.channelId,
      ...(opts.executionLease ? { executionLease: opts.executionLease } : {}),
      keyPrefix: opts.keyPrefix,
      params,
      store: declaredArtifactStore(manifest, store, optionalFallbacks, log),
      artifactRefs: inputRefs,
      budgetUsd: opts.budgetUsd,
      ...(configuredEnvelope === undefined ? {} : { stageBudgetUsd: configuredEnvelope }),
      assertRemainingBudgetReservation,
      modelUsageCostUsd: (kinds) => {
        const summary = usageScope.snapshot();
        return kinds === undefined
          ? summary.costUsd
          : trackedCostForKinds(summary, new Set<CostModelUsageKind>(kinds));
      },
      modelUsageAccounting: (kinds) =>
        trackedUsageForKinds(
          usageScope.snapshot(),
          kinds === undefined ? undefined : new Set<CostModelUsageKind>(kinds),
        ),
      imageUsageAccounting: () => imageUsageScope.snapshot(),
      checkpointVisualArtifactAttempts,
      log,
    };

    let observedCost = 0;
    let costAccounted = false;
    let usageReported = false;
    let imageUsageReported = false;
    const reportUsage = (): ModelUsageSummary => {
      const summary = usageScope.snapshot();
      if (!usageReported && hasModelUsage(summary)) {
        usageReported = true;
        log(`block model usage: ${block.id}`, {
          modelUsage: summary,
          ...(summary.unpricedCalls > 0
            ? { accountingWarning: `${summary.unpricedCalls} model call(s) have an unpriced component` }
            : {}),
        });
      }
      return summary;
    };
    const reportImageUsage = (): ImageUsageSummary => {
      const summary = imageUsageScope.snapshot();
      if (!imageUsageReported && (summary.calls > 0 || summary.cacheHits > 0)) {
        imageUsageReported = true;
        log(`block image usage: ${block.id}`, { imageUsage: summary });
      }
      return summary;
    };
    try {
      if (
        cachedFallbackToLocalRun &&
        !(opts.remoteBlocks?.has(block.id) && opts.runRemoteBlock)
      ) {
        await rehydrateCachedInputsForLocalFallback(block, blockIndex);
      }
      const retries = normalizeRetryCount(params["retries"], opts.defaultRetries);
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
          const r = await opts.rehydrate(block.id, { ...patch }, {
            neededOutputKeys: localConsumerKeysAfter(blockIndex),
          });
          patch = r.outputs;
          if (!r.ok) log(`remote block ${block.id}: partial rehydrate (downstream-consumed outputs restored; a heal-only sibling may be absent)`);
        }
      } else {
        // Keep one scope across the block's bounded retry loop. Provider
        // wrappers can then reuse a valid response if a later operation fails,
        // while every actual successful provider response is charged once.
        patch = await usageScope.run(() =>
          imageUsageScope.run(() => runBlockWithRetry(block, ctx, retries, log)),
        );
      }
      const hasExplicitCost = Object.prototype.hasOwnProperty.call(patch, COST_PATCH_KEY);
      const explicitCost = takeCost(patch);
      const modelUsage = reportUsage();
      const imageUsage = reportImageUsage();
      // Existing composite paid blocks already include their model/vision
      // allowance in __costUsd. Treat that patch as authoritative to prevent
      // double counting; text-only blocks without a patch receive exact
      // provider-token cost from this scope.
      const cost = hasExplicitCost
        ? explicitCost
        : explicitCost + modelUsage.costUsd + imageUsage.costUsd;
      observedCost = cost;
      spentUsd += cost;
      costAccounted = true;
      if (
        configuredEnvelope !== undefined &&
        cost > configuredEnvelope + Number.EPSILON
      ) {
        throw new Error(
          `module "${block.id}" reported $${cost.toFixed(4)} spend above its ` +
          `$${configuredEnvelope.toFixed(4)} configured envelope`,
        );
      }
      assertProduced(manifest, patch);
      await persistProducedArtifacts(manifest, patch, inputRefs, optionalFallbacks);
      Object.assign(store, patch);

      // Publish-grade receipts can be intentionally complete enough for R2
      // while exceeding a Convex stage document. A block may project only its
      // durable stage summary after artifact persistence; the full in-memory
      // patch remains available to immediate downstream blocks in this run.
      const persistedStageOutputs = block.persistStageOutputs?.(patch) ?? patch;

      await opts.sink.upsert({
        ownerId: opts.ownerId,
        runId: opts.runId,
        block: block.id,
        status: "ok",
        finishedAt: Date.now(),
        cost,
        outputs: persistedStageOutputs,
      });
      stages.push({ block: block.id, status: "ok" });
      log(`block ok: ${block.id}`, { produced: block.produces, costUsd: cost });
      return { status: "ok", cost };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!costAccounted) {
        const modelUsage = reportUsage();
        const imageUsage = reportImageUsage();
        const reportedFailureCost = observedCostFromError(err);
        const additionalFailureCost = additionalObservedCostFromError(err) ?? 0;
        // observedCostUsd is an adapter's authoritative whole-attempt spend
        // (for example TTS plus its audio judge). Otherwise preserve the exact
        // known token cost of provider responses received before the failure.
        observedCost =
          Math.max(
            reportedFailureCost ?? 0,
            modelUsage.costUsd + imageUsage.costUsd,
          ) + additionalFailureCost;
        spentUsd += observedCost;
        costAccounted = true;
      }
      await opts.sink.upsert({
        ownerId: opts.ownerId,
        runId: opts.runId,
        block: block.id,
        status: "failed",
        finishedAt: Date.now(),
        ...(observedCost > 0 ? { cost: observedCost } : {}),
        error: message,
      });
      stages.push({ block: block.id, status: "failed" });
      log(`block failed: ${block.id}`, { error: message });
      const classification = classifyExecutionError(err);
      return {
        status: "failed",
        cost: observedCost,
        error: message,
        ...(classification.retryable && classification.retryScope === "durable_task"
          ? {
              retryDirective: {
                scope: classification.retryScope,
                ...(classification.code ? { code: classification.code } : {}),
                ...(classification.retryAfterMs === undefined
                  ? {}
                  : { retryAfterMs: classification.retryAfterMs }),
              },
            }
          : {}),
        ...(visualRepairFromError(err) ? { visualRepair: visualRepairFromError(err) } : {}),
      };
    }
  };

  const fail = (
    block: string,
    error: string,
    visualRepair?: VisualRepairSignal[],
    retryDirective?: RunResult["retryDirective"],
  ): RunResult => ({
    ok: false,
    status: "failed",
    store,
    failedBlock: block,
    error,
    ...(retryDirective ? { retryDirective } : {}),
    ...(visualRepair?.length ? { visualRepair } : {}),
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
        const results = await Promise.all(group.map((b, offset) => executeBlock(b, i + offset)));
        for (let k = 0; k < group.length; k++) {
          if (results[k].status === "failed") {
            return fail(
              group[k].id,
              results[k].error ?? "block failed",
              results[k].visualRepair,
              results[k].retryDirective,
            );
          }
        }
        const ob = overBudget(group[group.length - 1].id);
        if (ob) return ob;
        i = j;
        continue;
      }
    }

    const res = await executeBlock(block, i);
    if (res.status === "failed") {
      return fail(block.id, res.error ?? "block failed", res.visualRepair, res.retryDirective);
    }
    const ob = overBudget(block.id);
    if (ob) return ob;
    if (requestedBoundary === block.id) {
      log(`review boundary reached after durable stage: ${block.id}`);
      return {
        ok: true,
        status: "awaiting_review",
        stoppedAfterBlockId: block.id,
        store,
        costTotal: spentUsd,
        stages,
      };
    }
    i++;
  }

  return { ok: true, status: "completed", store, costTotal: spentUsd, stages };
}
