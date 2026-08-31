/**
 * Shared body of the remote render child tasks.
 *
 * Two Trigger tasks wrap this one function so they can be billed on different
 * machine tiers (see `renderBlockMachineClass`):
 *   - `render-block`       (large-2x) — timeline_assemble / documotion_short,
 *     which composite media locally and genuinely need the 16GB worker.
 *   - `render-block-light` (medium-1x) — novita_render_images / _video, whose
 *     GPU work runs off-machine on the Novita fleet while the task
 *     checkpoint-waits unbilled.
 *
 * The logic lives HERE, not duplicated per task: rehydration filtering,
 * admission, artifact merging and error classification are correctness-
 * sensitive, and two copies would drift. The tasks differ only in `id`,
 * `machine`, and which block class they accept.
 */
import { logger } from "@trigger.dev/sdk/v3";
import { createHash } from "node:crypto";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { registerAllBlocks } from "@/engine/blocks";
import { makeConvexSink } from "@/engine/convexSink";
import { artifactContract, validateArtifact } from "@/engine/artifactSchemas";
import { rehydrateOutputs, selectRehydrationSubset } from "@/lib/rehydrate";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { taskErrorForRetryPolicy } from "@/trigger/taskRetryPolicy";
import type { ArtifactRef, RunStageSink, StageContext } from "@/engine/types";
import {
  assertRenderBlockAdmission,
  assertRenderBlockInvocation,
} from "@/lib/renderBlockAdmission";
import {
  renderBlockMachineClass,
  type RenderBlockMachineClass,
} from "@/lib/pipelineInvocationSnapshot";
import {
  admitFrozenRemoteChildStage,
  reconstructFrozenRemoteChildPipeline,
} from "@/lib/remoteChildBudgetAdmission";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { assertPipelineVideoRuntimeReady } from "@/engine/runtimeCapability";
import {
  assertReviewedLtxRuntimeSeedStillActive,
  REVIEWED_LTX_RUNTIME_SEED_KEY,
} from "@/engine/reviewedLtxRuntimeTarget";
import { resolveOwnerReviewedLtxRuntime } from "@/lib/reviewedLtxRuntimeStateRuntime";
import { requireInternalQuerySecret } from "@/lib/youtubeConnector";
import { RENDER_CHILD_HEARTBEAT_RENEW_INTERVAL_MS } from "@/lib/renderChildLease";

export interface RenderBlockInput {
  runId: string;
  ownerId: string;
  channelId: string;
  leaseOwner: string;
  executionLeaseToken: number;
  dispatchKey: string;
  keyPrefix: string;
  blockId: string;
  params: Record<string, unknown>;
  budgetUsd: number;
  seedStore: Record<string, unknown>;
}

export interface RenderBlockRunnerOptions {
  /** Log prefix + task identity, e.g. "render-block" / "render-block-light". */
  taskLabel: string;
  /** The block class this task's machine tier is provisioned for. */
  machineClass: RenderBlockMachineClass;
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

/**
 * Remote blocks execute outside the normal engine runner, but their reviewed
 * visual candidates still need the identical durable, fenced checkpoint
 * before a replacement/provider attempt can begin.
 */
function makeVisualArtifactAttemptCheckpoint(args: {
  sink: RunStageSink;
  ownerId: string;
  channelId: string;
  runId: string;
  moduleId: string;
  moduleVersion: string;
  loadInputArtifactRefs: () => Promise<Readonly<Record<string, ArtifactRef>>>;
}): NonNullable<StageContext["checkpointVisualArtifactAttempts"]> {
  return async (attempts) => {
    if (attempts.length === 0) return [];
    if (attempts.length > 64) {
      throw new Error(`visual artifact attempt checkpoint for "${args.moduleId}" exceeds the 64-record batch limit`);
    }
    if (!args.sink.upsertArtifacts) {
      throw new Error(
        `visual artifact attempt checkpoint for "${args.moduleId}" requires a durable artifact sink`,
      );
    }
    const contract = artifactContract("visualArtifactAttempt");
    if (contract.opaque || contract.persist !== "reference") {
      throw new Error("visual artifact attempt contract must be a typed reference artifact");
    }
    const inputArtifactRefs = await args.loadInputArtifactRefs();
    const inputArtifactIds = [
      ...new Set(Object.values(inputArtifactRefs).map((ref) => ref.artifactId)),
    ].sort();
    const seenAttemptFingerprints = new Set<string>();
    const createdAt = Date.now();
    const artifacts = attempts.map((attempt) => {
      const value = validateArtifact(contract, attempt);
      const serialized = stableJson(value);
      if (serialized.length > 100_000) {
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
        moduleId: args.moduleId,
        moduleVersion: args.moduleVersion,
        artifactKey: "visualArtifactAttempt",
      });
      const artifact: ArtifactRef = {
        artifactId: `${args.runId}:${args.moduleId}:visualArtifactAttempt:${identityHash.slice(0, 16)}`,
        key: "visualArtifactAttempt",
        type: contract.type,
        schemaVersion: contract.version,
        producerModule: args.moduleId,
        producerVersion: args.moduleVersion,
        payloadHash,
      };
      return {
        artifact,
        inputArtifactIds,
        optionalFallbacks: [] as string[],
        persistence: "reference" as const,
        payload: value,
        createdAt,
      };
    });
    await args.sink.upsertArtifacts({
      ownerId: args.ownerId,
      channelId: args.channelId,
      runId: args.runId,
      artifacts,
    });
    return artifacts.map((entry) => entry.artifact);
  };
}

export async function executeRenderBlock(
  payload: RenderBlockInput,
  options: RenderBlockRunnerOptions,
): Promise<{ patch: Record<string, unknown> }> {
  const { taskLabel, machineClass } = options;

  registerAllBlocks();
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error(`${taskLabel}: NEXT_PUBLIC_CONVEX_URL not configured`);
  const convex = new ConvexHttpClient(url);

  // This precedes secret bootstrap, registry/provider execution, and any R2
  // work. A child that sat in Trigger's queue past its parent's bounded wait
  // cannot spend or mutate a recovered execution.
  await convex.mutation(api.runs.assertRemoteChildWaitLease, {
    ownerId: payload.ownerId,
    channelId: payload.channelId as Id<"channels">,
    runId: payload.runId as Id<"runs">,
    leaseOwner: payload.leaseOwner,
    executionLeaseToken: payload.executionLeaseToken,
    blockId: payload.blockId,
    dispatchKey: payload.dispatchKey,
    now: Date.now(),
  });

  // Authenticate the complete execution tuple before rehydration, worker
  // billing, or block execution. The parent marks the run `running` before
  // dispatching this child, including on retries.
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
  const frozenInvocation = assertRenderBlockInvocation({
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

  // A child has a separate process and module registry. Rebuild the exact
  // signed route on THIS worker, then re-run compilation + preflight before it
  // touches R2 or a provider. Mutable payload values are only used above to
  // prove byte-for-byte equality with this frozen invocation.
  const frozenPipeline = reconstructFrozenRemoteChildPipeline(frozenInvocation);
  const frozenStageIndexes = frozenPipeline.resolved.entries
    .map((entry, index) => (entry.block === payload.blockId ? index : -1))
    .filter((index) => index >= 0);
  if (frozenStageIndexes.length !== 1) {
    throw new Error(`${taskLabel}: frozen route remote block "${payload.blockId}" is missing or ambiguous`);
  }
  const stageIndex = frozenStageIndexes[0]!;
  const manifest = frozenPipeline.resolved.manifests[stageIndex];
  if (!manifest || manifest.id !== payload.blockId) {
    throw new Error(`${taskLabel}: frozen route manifest alignment is invalid for "${payload.blockId}"`);
  }
  const frozenEntry = frozenPipeline.resolved.entries[stageIndex]!;
  const actualClass = renderBlockMachineClass(frozenEntry.block);
  if (actualClass !== machineClass) {
    throw new Error(
      `${taskLabel}: block "${frozenEntry.block}" is a "${actualClass}" render block and must not run on the "${machineClass}" task`,
    );
  }
  const frozenReviewedLtxRuntime = frozenInvocation.seedStore[REVIEWED_LTX_RUNTIME_SEED_KEY];
  const reviewedLtxRuntime = frozenReviewedLtxRuntime === undefined
    ? undefined
    : assertReviewedLtxRuntimeSeedStillActive({
        seed: frozenReviewedLtxRuntime,
        current: await resolveOwnerReviewedLtxRuntime({ client: convex, ownerId: payload.ownerId }),
      });
  assertPipelineVideoRuntimeReady(frozenPipeline.resolved.entries, reviewedLtxRuntime?.runtime);

  // Rehydration needs its storage credentials, but provider-facing execution
  // remains behind the frozen route and remaining-budget gates below.
  await bootstrapSecrets((m, x) => console.log(`[${taskLabel}] ${m}`, x ?? ""), { required: [] });

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
  const store: Record<string, unknown> = { ...frozenInvocation.seedStore };
  const executionLease = {
    leaseOwner: payload.leaseOwner,
    executionLeaseToken: payload.executionLeaseToken,
  };
  const sink = makeConvexSink(convex, payload.ownerId, executionLease);
  if (!sink.getCompleted) throw new Error(`${taskLabel}: sink lacks getCompleted (cannot rebuild store)`);
  const completed = await sink.getCompleted(payload.runId);
  const completedByBlock = new Map(completed.map((row) => [row.block, row]));
  const loadInputArtifactRefs = async (): Promise<Readonly<Record<string, ArtifactRef>>> => {
    const artifactRows = await convex.query(api.runArtifacts.listForRun, {
      secret: requireInternalQuerySecret(),
      ownerId: payload.ownerId,
      runId: payload.runId as Id<"runs">,
    });
    return Object.fromEntries(
      (artifactRows as Array<{
        artifactId: string;
        key: string;
        type: string;
        schemaVersion: string;
        producerModule: string;
        producerVersion: string;
        payloadHash: string;
      }>)
        .filter((row) => consumedKeys.has(row.key))
        .map((row) => [row.key, {
          artifactId: row.artifactId,
          key: row.key,
          type: row.type,
          schemaVersion: row.schemaVersion,
          producerModule: row.producerModule,
          producerVersion: row.producerVersion,
          payloadHash: row.payloadHash,
        } satisfies ArtifactRef]),
    ) as Record<string, ArtifactRef>;
  };
  let restored = 0;
  let fetched = 0;
  let skipped = 0;
  const requiredConsumedKeys = new Set<string>(Object.keys(manifest.consumes));
  for (let upstreamIndex = 0; upstreamIndex < stageIndex; upstreamIndex++) {
    const upstreamEntry = frozenPipeline.resolved.entries[upstreamIndex];
    if (!upstreamEntry) {
      throw new Error(`${taskLabel}: frozen route lost upstream entry ${upstreamIndex}`);
    }
    const row = completedByBlock.get(upstreamEntry.block);
    if (!row) continue;
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
    } else {
      fetched++;
    }
    // The shared rehydrator receives the complete patch so it can HEAD-check
    // skipped R2-backed media. It still streams only this declared subset to
    // local disk, preserving the full raw store without re-paying broad GETs.
    const r = await rehydrateOutputs(row.block, outputs, payload.runId, {
      neededOutputKeys: consumedKeys,
    });
    if (!r.ok) {
      if (Object.keys(outputs).some((key) => requiredConsumedKeys.has(key))) {
        throw new Error(
          `${taskLabel}: required frozen inputs from upstream block "${row.block}" are not rehydratable; ` +
            "refusing remote provider work",
        );
      }
      logger.warn(`[${taskLabel}] block "${row.block}" consumed outputs not fully rehydratable — merging raw (render fails if it reads them)`);
    }
    Object.assign(store, r.outputs);
  }
  logger.info(
    `[${taskLabel}] store rebuilt from ${restored} upstream block(s); rehydrated ${fetched}, skipped ${skipped} not consumed by ${payload.blockId} → running ${payload.blockId}`,
  );

  // The exact stage envelope is intentionally derived only now: several
  // production contracts size their provider work from a frozen upstream plan.
  // The helper immediately reserves this and every still-pending paid stage,
  // then exposes the same late-bound assertion to the block for its own
  // deterministic provider sub-plans.
  const budgetAdmission = admitFrozenRemoteChildStage({
    resolved: frozenPipeline.resolved,
    blockId: frozenEntry.block,
    store,
    budgetUsd: frozenInvocation.budgetUsd,
    completedStages: completed,
  });

  // The parent wait receipt is a short liveness lease, not a multi-hour blind
  // hold. Direct-Novita code calls this before every paid wave/create and from
  // its checkpoint polling loop. Polls may run concurrently for several GPU
  // workers, so coalesce them to one durable renewal per minute; provider work
  // is always a forced token check immediately before its next paid action.
  let lastPollLeaseRenewalAt = 0;
  let pendingPollLeaseRenewal: Promise<void> | undefined;
  const assertRemoteChildExecutionLease: NonNullable<
    StageContext["assertRemoteChildExecutionLease"]
  > = async (fenceArgs = {}) => {
    const isProviderAction =
      fenceArgs.reason === "paid_wave" || fenceArgs.reason === "worker_create";
    const now = Date.now();
    if (!isProviderAction && now - lastPollLeaseRenewalAt < RENDER_CHILD_HEARTBEAT_RENEW_INTERVAL_MS) {
      return;
    }
    const renew = async () => {
      await convex.mutation(api.runs.renewRemoteChildWaitLease, {
        ownerId: payload.ownerId,
        channelId: payload.channelId as Id<"channels">,
        runId: payload.runId as Id<"runs">,
        leaseOwner: payload.leaseOwner,
        executionLeaseToken: payload.executionLeaseToken,
        blockId: frozenEntry.block,
        dispatchKey: payload.dispatchKey,
        purpose: isProviderAction ? "provider" : "poll",
        now: Date.now(),
      });
      if (!isProviderAction) lastPollLeaseRenewalAt = Date.now();
    };
    if (isProviderAction) {
      await renew();
      return;
    }
    if (!pendingPollLeaseRenewal) {
      pendingPollLeaseRenewal = renew().finally(() => {
        pendingPollLeaseRenewal = undefined;
      });
    }
    await pendingPollLeaseRenewal;
  };

  const ctx: StageContext = {
    ownerId: payload.ownerId,
    runId: payload.runId,
    channelId: payload.channelId,
    executionLease,
    keyPrefix: frozenInvocation.keyPrefix,
    params: frozenEntry.params ?? {},
    store,
    budgetUsd: frozenInvocation.budgetUsd,
    ...(budgetAdmission.stageBudgetUsd === undefined
      ? {}
      : { stageBudgetUsd: budgetAdmission.stageBudgetUsd }),
    assertRemainingBudgetReservation: budgetAdmission.assertRemainingBudgetReservation,
    assertRemoteChildExecutionLease,
    remoteChildFence: {
      leaseOwner: payload.leaseOwner,
      executionLeaseToken: payload.executionLeaseToken,
      dispatchKey: payload.dispatchKey,
    },
    checkpointVisualArtifactAttempts: makeVisualArtifactAttemptCheckpoint({
      sink,
      ownerId: payload.ownerId,
      channelId: payload.channelId,
      runId: payload.runId,
      moduleId: manifest.id,
      moduleVersion: manifest.version,
      loadInputArtifactRefs,
    }),
    log: (msg: string, extra?: Record<string, unknown>) => logger.info(`[${taskLabel}] ${msg}`, extra),
  };

  try {
    const patch = await block.run(ctx);
    return { patch };
  } catch (error) {
    const taskError = taskErrorForRetryPolicy(error);
    const { classification } = taskError;
    logger.error(`[${taskLabel}] ${payload.blockId} failed`, {
      error: classification.message,
      errorKind: classification.kind,
      retryReason: classification.reason,
      ...(classification.status !== undefined ? { status: classification.status } : {}),
      ...(classification.code ? { code: classification.code } : {}),
    });
    // Trigger task retries are reserved for crashes/OOM and failures with a
    // concrete transient signal. Re-running malformed inputs, provider 4xx,
    // or a deterministic FFmpeg command just burns another attempt.
    throw taskError.error;
  }
}
