import type { PipelineEntry } from "@/engine/types";
import { stableJson } from "@/lib/publishingPolicy";

export const PIPELINE_INVOCATION_SNAPSHOT_VERSION = 1 as const;
export const MAX_PIPELINE_INVOCATION_SNAPSHOT_BYTES = 750_000;
/** The only child-task render stages that may appear in a frozen invocation. */
export const REMOTE_RENDER_BLOCK_IDS = [
  "timeline_assemble",
  "documotion_short",
  "novita_render_images",
  "novita_render_video",
] as const;

const REMOTE_RENDER_BLOCK_ID_SET = new Set<string>(REMOTE_RENDER_BLOCK_IDS);

/**
 * Machine-class split of the remote render blocks.
 *
 * `large-2x` exists for exactly one reason: compositing media ON the worker
 * OOMs a smaller box. Only these two blocks actually do that here —
 *   - timeline_assemble: the ffmpeg overlay + xfade pass over the full timeline
 *     (the original OOM/SYSTEM_FAILURE incident render-block.ts documents),
 *   - documotion_short:  renders 1080p geo_map/parallax frames through a
 *     concurrency pool and ffmpeg-composites the 9:16 master. See
 *     src/lib/documotion.ts, whose own comment warns that the default pool
 *     "can OOM a shared box".
 */
export const HEAVY_RENDER_BLOCK_IDS = ["timeline_assemble", "documotion_short"] as const;

/**
 * Remote render blocks whose expensive work happens OFF this machine: they
 * submit to the Novita RTX 4090 fleet and then checkpoint-wait — unbilled, via
 * `wait.for()` in src/lib/novitaPollWait.ts — while the GPU renders. The billed
 * local work is job submission, manifest validation and QA sampling (one ffprobe
 * plus three single-frame grabs per shot), which does not need large-2x.
 */
export const OFFLOADED_RENDER_BLOCK_IDS = ["novita_render_images", "novita_render_video"] as const;

const HEAVY_RENDER_BLOCK_ID_SET = new Set<string>(HEAVY_RENDER_BLOCK_IDS);
const OFFLOADED_RENDER_BLOCK_ID_SET = new Set<string>(OFFLOADED_RENDER_BLOCK_IDS);

export type RenderBlockMachineClass = "heavy" | "offloaded";

/**
 * Single source of truth for which child task renders a block. Both the
 * orchestrator's dispatch and each child task's own admission guard read this,
 * so a misroute fails loudly instead of silently paying (or OOMing) on the
 * wrong machine tier.
 */
export function renderBlockMachineClass(blockId: string): RenderBlockMachineClass {
  if (HEAVY_RENDER_BLOCK_ID_SET.has(blockId)) return "heavy";
  if (OFFLOADED_RENDER_BLOCK_ID_SET.has(blockId)) return "offloaded";
  throw new Error(`renderBlockMachineClass: "${blockId}" is not a remote render block`);
}

export type PipelineInvocationBudgetAdmission =
  | {
      kind: "channel-inception-probe";
      maximumCostUsd: number;
      receiptFingerprint: string;
      subject: string;
      pipelineOverrideFingerprint: string;
      dispatchEnvelopeFingerprint: string;
    }
  | {
      /** Full private final-master benchmark; it never has upload authority. */
      kind: "route-qualification-benchmark";
      maximumCostUsd: number;
      receiptFingerprint: string;
      subject: string;
      pipelineOverrideFingerprint: string;
      dispatchEnvelopeFingerprint: string;
      productionPipelineFingerprint: string;
      preflightReceiptFingerprint: string;
    };

export interface PipelineInvocationSnapshot {
  version: typeof PIPELINE_INVOCATION_SNAPSHOT_VERSION;
  ownerId: string;
  runId: string;
  channelId: string;
  source: "channel" | "override" | "bundle-reuse";
  entries: PipelineEntry[];
  seedStore: Record<string, unknown>;
  budgetUsd: number;
  keyPrefix: string;
  remoteBlocks: string[];
  defaultRetries: number;
  compilationFingerprint: string;
  compilationPolicyId: string;
  compilationPolicyVersion: string;
  compilationModules: unknown;
  compilationCapabilities: string[];
  reservedMaxCostUsd: number;
  /**
   * Present for newly admitted modular channels. Optional solely for durable
   * historical runs that predate Channel Show Profile v1.
   */
  showProfileFingerprint?: string;
  /**
   * Present when the channel's canonical program brief resolves to a sealed
   * Program Route. Optional solely for durable invocations that predate the
   * route receipt; route-bearing fresh runs must also carry its seed-store
   * counterpart before execution begins.
   */
  programRouteFingerprint?: string;
  budgetAdmission?: PipelineInvocationBudgetAdmission;
}

/**
 * Route-bearing invocations carry their own immutable route seed and must not
 * inspect mutable channel identity on retry. Earlier durable snapshots have
 * no route receipt, so they retain the historical show-profile guard.
 */
export function pipelineInvocationUsesCurrentShowProfileGuard(
  snapshot?: Pick<PipelineInvocationSnapshot, "programRouteFingerprint">,
): boolean {
  return snapshot === undefined || snapshot.programRouteFingerprint === undefined;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`pipeline invocation ${label} is invalid`);
  }
  return value;
}

function jsonClone<T>(value: T): T {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch (error) {
    throw new Error(
      `pipeline invocation snapshot is not JSON-safe: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!encoded) {
    throw new Error("pipeline invocation snapshot is not JSON-safe");
  }
  if (encoded.length > MAX_PIPELINE_INVOCATION_SNAPSHOT_BYTES) {
    throw new Error(
      `pipeline invocation snapshot exceeds ${MAX_PIPELINE_INVOCATION_SNAPSHOT_BYTES} bytes`,
    );
  }
  return JSON.parse(encoded) as T;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`pipeline invocation ${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

export function normalizePipelineInvocationSnapshot(
  value: PipelineInvocationSnapshot,
): PipelineInvocationSnapshot {
  const snapshot = jsonClone(value);
  if (snapshot.version !== PIPELINE_INVOCATION_SNAPSHOT_VERSION) {
    throw new Error(`unsupported pipeline invocation snapshot version: ${String(snapshot.version)}`);
  }
  const ownerId = requiredText(snapshot.ownerId, "owner id");
  const runId = requiredText(snapshot.runId, "run id");
  const channelId = requiredText(snapshot.channelId, "channel id");
  if (!["channel", "override", "bundle-reuse"].includes(snapshot.source)) {
    throw new Error("pipeline invocation source is invalid");
  }
  const keyPrefix = requiredText(snapshot.keyPrefix, "key prefix");
  const compilationFingerprint = requiredText(
    snapshot.compilationFingerprint,
    "compilation fingerprint",
  );
  if (!/^[a-f0-9]{64}$/.test(compilationFingerprint)) {
    throw new Error("pipeline invocation compilation fingerprint is invalid");
  }
  const compilationPolicyId = requiredText(
    snapshot.compilationPolicyId,
    "compilation policy id",
  );
  const compilationPolicyVersion = requiredText(
    snapshot.compilationPolicyVersion,
    "compilation policy version",
  );
  if (!Number.isFinite(snapshot.budgetUsd) || snapshot.budgetUsd < 0) {
    throw new Error("pipeline invocation budget is invalid");
  }
  if (
    !Number.isInteger(snapshot.defaultRetries) ||
    snapshot.defaultRetries < 0 ||
    snapshot.defaultRetries > 5
  ) {
    throw new Error("pipeline invocation retry contract is invalid");
  }
  if (
    !Array.isArray(snapshot.remoteBlocks) ||
    snapshot.remoteBlocks.some((block) => !REMOTE_RENDER_BLOCK_ID_SET.has(block)) ||
    new Set(snapshot.remoteBlocks).size !== snapshot.remoteBlocks.length
  ) {
    throw new Error("pipeline invocation remote block routing is invalid");
  }
  if (
    !Number.isFinite(snapshot.reservedMaxCostUsd) ||
    snapshot.reservedMaxCostUsd < 0
  ) {
    throw new Error("pipeline invocation cost reservation is invalid");
  }
  if (!Array.isArray(snapshot.entries) || snapshot.entries.length < 1) {
    throw new Error("pipeline invocation entries are empty");
  }
  const entries = snapshot.entries.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("pipeline invocation entry is invalid");
    }
    const block = requiredText(entry.block, "block id");
    return {
      block,
      ...(entry.params !== undefined
        ? { params: record(entry.params, `params for ${block}`) }
        : {}),
    };
  });
  const seedStore = record(snapshot.seedStore, "seed store");
  if (!Array.isArray(snapshot.compilationModules)) {
    throw new Error("pipeline invocation compiled modules are invalid");
  }
  if (!Array.isArray(snapshot.compilationCapabilities)) {
    throw new Error("pipeline invocation capabilities are invalid");
  }
  const compilationCapabilities = snapshot.compilationCapabilities.map((value) =>
    requiredText(value, "capability")
  );
  const showProfileFingerprint = snapshot.showProfileFingerprint === undefined
    ? undefined
    : requiredText(snapshot.showProfileFingerprint, "channel show profile fingerprint");
  if (showProfileFingerprint !== undefined && !/^[a-f0-9]{64}$/.test(showProfileFingerprint)) {
    throw new Error("pipeline invocation channel show profile fingerprint is invalid");
  }
  const programRouteFingerprint = snapshot.programRouteFingerprint === undefined
    ? undefined
    : requiredText(snapshot.programRouteFingerprint, "channel program route fingerprint");
  if (programRouteFingerprint !== undefined && !/^[a-f0-9]{64}$/.test(programRouteFingerprint)) {
    throw new Error("pipeline invocation channel program route fingerprint is invalid");
  }
  let budgetAdmission: PipelineInvocationSnapshot["budgetAdmission"];
  if (snapshot.budgetAdmission !== undefined) {
    const admission = snapshot.budgetAdmission;
    if (
      admission.kind !== "channel-inception-probe" &&
      admission.kind !== "route-qualification-benchmark"
    ) {
      throw new Error("pipeline invocation budget admission kind is invalid");
    }
    if (
      !Number.isFinite(admission.maximumCostUsd) ||
      admission.maximumCostUsd <= 0 ||
      admission.maximumCostUsd > 100
    ) {
      throw new Error("pipeline invocation admitted cost ceiling is invalid");
    }
    const receiptFingerprint = requiredText(
      admission.receiptFingerprint,
      "budget admission receipt fingerprint",
    );
    const pipelineOverrideFingerprint = requiredText(
      admission.pipelineOverrideFingerprint,
      "budget admission pipeline fingerprint",
    );
    const dispatchEnvelopeFingerprint = requiredText(
      admission.dispatchEnvelopeFingerprint,
      "budget admission dispatch envelope fingerprint",
    );
    if (
      !/^[a-f0-9]{64}$/.test(receiptFingerprint) ||
      !/^[a-f0-9]{64}$/.test(pipelineOverrideFingerprint) ||
      !/^[a-f0-9]{64}$/.test(dispatchEnvelopeFingerprint)
    ) {
      throw new Error("pipeline invocation budget admission fingerprint is invalid");
    }
    const common = {
      kind: admission.kind,
      maximumCostUsd: admission.maximumCostUsd,
      receiptFingerprint,
      subject: requiredText(admission.subject, "budget admission subject"),
      pipelineOverrideFingerprint,
      dispatchEnvelopeFingerprint,
    };
    if (admission.kind === "route-qualification-benchmark") {
      const productionPipelineFingerprint = requiredText(
        admission.productionPipelineFingerprint,
        "benchmark production pipeline fingerprint",
      );
      const preflightReceiptFingerprint = requiredText(
        admission.preflightReceiptFingerprint,
        "benchmark preflight receipt fingerprint",
      );
      if (!/^[a-f0-9]{64}$/.test(productionPipelineFingerprint) || !/^[a-f0-9]{64}$/.test(preflightReceiptFingerprint)) {
        throw new Error("pipeline invocation benchmark binding fingerprint is invalid");
      }
      budgetAdmission = {
        ...common,
        kind: "route-qualification-benchmark",
        productionPipelineFingerprint,
        preflightReceiptFingerprint,
      };
    } else {
      budgetAdmission = { ...common, kind: "channel-inception-probe" };
    }
  }

  return {
    version: PIPELINE_INVOCATION_SNAPSHOT_VERSION,
    ownerId,
    runId,
    channelId,
    source: snapshot.source,
    entries,
    seedStore,
    budgetUsd: snapshot.budgetUsd,
    keyPrefix,
    remoteBlocks: [...snapshot.remoteBlocks],
    defaultRetries: snapshot.defaultRetries,
    compilationFingerprint,
    compilationPolicyId,
    compilationPolicyVersion,
    compilationModules: jsonClone(snapshot.compilationModules),
    compilationCapabilities,
    reservedMaxCostUsd: snapshot.reservedMaxCostUsd,
    ...(showProfileFingerprint ? { showProfileFingerprint } : {}),
    ...(programRouteFingerprint ? { programRouteFingerprint } : {}),
    ...(budgetAdmission ? { budgetAdmission } : {}),
  };
}

export function pipelineInvocationSnapshotsEqual(
  left: PipelineInvocationSnapshot,
  right: PipelineInvocationSnapshot,
): boolean {
  return stableJson(normalizePipelineInvocationSnapshot(left)) ===
    stableJson(normalizePipelineInvocationSnapshot(right));
}

export function decidePipelineInvocationClaim(args: {
  run: {
    ownerId: string;
    channelId: string;
    runId: string;
    status: string;
    snapshot?: PipelineInvocationSnapshot;
    sha256?: string;
    hasExecutionHistory: boolean;
  };
  ownerId: string;
  channelId: string;
  runId: string;
  snapshot: PipelineInvocationSnapshot;
  sha256: string;
}): {
  kind: "new" | "reused";
  snapshot: PipelineInvocationSnapshot;
  sha256: string;
} {
  if (
    args.run.ownerId !== args.ownerId ||
    args.run.channelId !== args.channelId ||
    args.run.runId !== args.runId
  ) {
    throw new Error("pipeline invocation snapshot ownership/channel mismatch");
  }
  if (!["queued", "running", "failed"].includes(args.run.status)) {
    throw new Error(
      `pipeline invocation snapshot refuses terminal run status: ${args.run.status}`,
    );
  }
  if (!/^[a-f0-9]{64}$/.test(args.sha256)) {
    throw new Error("pipeline invocation snapshot sha256 is invalid");
  }
  if ((args.run.snapshot === undefined) !== (args.run.sha256 === undefined)) {
    throw new Error("pipeline invocation durable snapshot/hash pair is incomplete");
  }
  const incoming = normalizePipelineInvocationSnapshot(args.snapshot);
  if (
    incoming.ownerId !== args.ownerId ||
    incoming.runId !== args.runId ||
    incoming.channelId !== args.channelId
  ) {
    throw new Error("pipeline invocation snapshot identity mismatch");
  }
  if (args.run.snapshot !== undefined) {
    const durable = normalizePipelineInvocationSnapshot(args.run.snapshot);
    if (!pipelineInvocationSnapshotsEqual(durable, incoming)) {
      throw new Error("pipeline invocation snapshot is immutable");
    }
    if (args.run.sha256 !== args.sha256) {
      throw new Error("pipeline invocation snapshot sha256 mismatch");
    }
    return { kind: "reused", snapshot: durable, sha256: args.sha256 };
  }
  if (args.run.hasExecutionHistory) {
    throw new Error(
      "pipeline invocation snapshot missing after execution began; legacy run requires manual recovery",
    );
  }
  return { kind: "new", snapshot: incoming, sha256: args.sha256 };
}

export function assertPipelineInvocationCompilation(
  snapshot: PipelineInvocationSnapshot,
  compilation: { fingerprint: string; policyId: string; policyVersion: string },
): void {
  const durable = normalizePipelineInvocationSnapshot(snapshot);
  if (
    durable.compilationFingerprint !== compilation.fingerprint ||
    durable.compilationPolicyId !== compilation.policyId ||
    durable.compilationPolicyVersion !== compilation.policyVersion
  ) {
    throw new Error("pipeline invocation module/policy fingerprint drift");
  }
}

export function snapshotParamsByBlock(
  entries: readonly PipelineEntry[],
): Record<string, Record<string, unknown>> {
  const params: Record<string, Record<string, unknown>> = {};
  for (const entry of entries) {
    if (entry.params) params[entry.block] = { ...entry.params };
  }
  return params;
}
