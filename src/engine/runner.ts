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
} from "./executionErrors";
import { configuredMaxCostUsd, type ModuleManifest } from "./moduleManifest";
import { createModelUsageScope, type ModelUsageSummary } from "@/lib/modelUsage";
import { createImageUsageScope, type ImageUsageSummary } from "@/lib/imageUsage";

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

const PAID_STAGE_RECONCILIATION_MARKER = "PAID_STAGE_RECONCILIATION_REQUIRED";

export interface RunResult {
  ok: boolean;
  store: Record<string, unknown>;
  failedBlock?: string;
  error?: string;
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

  const persistProducedArtifacts = async (
    manifest: ModuleManifest,
    patch: Record<string, unknown>,
    inputRefs: Readonly<Record<string, ArtifactRef>>,
    optionalFallbacks: Set<string>,
  ): Promise<void> => {
    const inputArtifactIds = [...new Set(Object.values(inputRefs).map((ref) => ref.artifactId))].sort();
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
      if (opts.sink.upsertArtifact) {
        const serialized = stableJson(value);
        const canInline = contract.persist !== "summary" && serialized.length <= 100_000;
        await opts.sink.upsertArtifact({
          ownerId: opts.ownerId,
          channelId: opts.channelId,
          runId: opts.runId,
          artifact,
          inputArtifactIds,
          optionalFallbacks: [...optionalFallbacks].sort(),
          persistence: canInline ? contract.persist : "summary",
          payload: canInline ? value : undefined,
          summary: canInline ? undefined : artifactSummary(value),
          createdAt: Date.now(),
        });
      }
      artifactRefs[key] = artifact;
    }
  };

  /**
   * Execute one block end-to-end (resume-restore | run+retry), persist its
   * stage, merge its patch into the shared store. Returns the outcome instead
   * of throwing so group execution can collect every member's result.
   */
  const executeBlock = async (
    block: Block,
    blockIndex: number,
  ): Promise<{ status: "ok" | "failed"; cost: number; error?: string; visualRepair?: VisualRepairSignal[] }> => {
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
    // Remote child work is already keyed by Trigger's durable idempotency key;
    // a parent retry must reattach to that child instead of deadlocking itself.
    // Inline provider calls have no equivalent process-crash receipt, so they
    // require explicit reconciliation when their persisted state is ambiguous.
    const paidStageNeedsReconciliation =
      manifest.costAndLatency.paid &&
      !opts.remoteBlocks?.has(block.id) &&
      (priorStage?.status === "running" ||
        (priorStage?.status === "failed" &&
          priorStage.error?.includes(PAID_STAGE_RECONCILIATION_MARKER)));
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
    if (cached && !opts.rehydrate) {
      if (manifest.costAndLatency.paid) {
        return await refusePaidCachedReplay("has no configured artifact rehydrator");
      }
      log(`block ${block.id}: cached outputs cannot be rehydrated — re-running unpaid block`);
    } else if (cached && opts.rehydrate) {
      try {
        const restored = await opts.rehydrate(block.id, { ...cached });
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
    const usageScope = createModelUsageScope();
    const imageUsageScope = createImageUsageScope();
    const ctx: StageContext = {
      ownerId: opts.ownerId,
      runId: opts.runId,
      channelId: opts.channelId,
      keyPrefix: opts.keyPrefix,
      params,
      store: declaredArtifactStore(manifest, store, optionalFallbacks, log),
      artifactRefs: inputRefs,
      budgetUsd: opts.budgetUsd,
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
          const r = await opts.rehydrate(block.id, { ...patch });
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
      return {
        status: "failed",
        cost: observedCost,
        error: message,
        ...(visualRepairFromError(err) ? { visualRepair: visualRepairFromError(err) } : {}),
      };
    }
  };

  const fail = (block: string, error: string, visualRepair?: VisualRepairSignal[]): RunResult => ({
    ok: false,
    store,
    failedBlock: block,
    error,
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
            return fail(group[k].id, results[k].error ?? "block failed", results[k].visualRepair);
          }
        }
        const ob = overBudget(group[group.length - 1].id);
        if (ob) return ob;
        i = j;
        continue;
      }
    }

    const res = await executeBlock(block, i);
    if (res.status === "failed") return fail(block.id, res.error ?? "block failed", res.visualRepair);
    const ob = overBudget(block.id);
    if (ob) return ob;
    i++;
  }

  return { ok: true, store, costTotal: spentUsd, stages };
}
