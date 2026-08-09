import type { PipelineEntry } from "@/engine/types";
import { stableJson } from "@/lib/publishingPolicy";

export const PIPELINE_INVOCATION_SNAPSHOT_VERSION = 1 as const;
export const MAX_PIPELINE_INVOCATION_SNAPSHOT_BYTES = 750_000;

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
  budgetAdmission?: {
    kind: "channel-inception-probe";
    maximumCostUsd: number;
    receiptFingerprint: string;
    subject: string;
    pipelineOverrideFingerprint: string;
    dispatchEnvelopeFingerprint: string;
  };
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
    snapshot.remoteBlocks.some(
      (block) => block !== "timeline_assemble" && block !== "documotion_short",
    ) ||
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
  let budgetAdmission: PipelineInvocationSnapshot["budgetAdmission"];
  if (snapshot.budgetAdmission !== undefined) {
    const admission = snapshot.budgetAdmission;
    if (admission.kind !== "channel-inception-probe") {
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
    budgetAdmission = {
      kind: admission.kind,
      maximumCostUsd: admission.maximumCostUsd,
      receiptFingerprint,
      subject: requiredText(admission.subject, "budget admission subject"),
      pipelineOverrideFingerprint,
      dispatchEnvelopeFingerprint,
    };
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
