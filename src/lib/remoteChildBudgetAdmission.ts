/**
 * Frozen admission and budget reservation for a remote render child.
 *
 * A child is a separate worker, so it must not trust the parent task payload
 * as budget authority. It rebuilds the exact signed pipeline first, then
 * calculates this stage and every still-pending paid envelope against the
 * rehydrated frozen store before a provider-facing block can run.
 */
import {
  compilePipeline,
  PRIVATE_PROBE_CONTRACT_POLICY,
  type PipelineCompilation,
} from "@/engine/pipelineCompiler";
import { configuredMaxCostUsd, type ModuleManifest } from "@/engine/moduleManifest";
import type { PipelineEntry, StageContext } from "@/engine/types";
import { preflight, validatePipeline, type ResolvedPipeline } from "@/engine/validate";
import {
  assertPipelineInvocationCompilation,
  normalizePipelineInvocationSnapshot,
  type PipelineInvocationSnapshot,
} from "@/lib/pipelineInvocationSnapshot";

export interface RemoteChildCompletedStage {
  readonly block: string;
  readonly cost?: number;
}

export interface FrozenRemoteChildPipeline {
  readonly snapshot: PipelineInvocationSnapshot;
  readonly resolved: ResolvedPipeline;
  readonly compilation: PipelineCompilation;
}

export interface FrozenRemoteChildStageAdmission {
  readonly blockIndex: number;
  readonly entry: PipelineEntry;
  readonly manifest: ModuleManifest;
  /** Present exactly for paid stages; never substituted from the run budget. */
  readonly stageBudgetUsd?: number;
  /** Recorded completed-stage spend carried into the child reservation. */
  readonly knownSpentUsd: number;
  /** The reservation checked immediately before the child receives its context. */
  readonly initialReservation: { reservedMaxCostUsd: number; blockIds: readonly string[] };
  readonly assertRemainingBudgetReservation: NonNullable<
    StageContext["assertRemainingBudgetReservation"]
  >;
}

/**
 * Rebuild the complete signed parent plan using the worker's current module
 * catalog. A revoked or drifted route/configuration fails before rehydration or
 * provider work; the child never treats the parent payload as executable truth.
 */
export function reconstructFrozenRemoteChildPipeline(
  snapshot: PipelineInvocationSnapshot,
): FrozenRemoteChildPipeline {
  const frozen = normalizePipelineInvocationSnapshot(snapshot);
  const resolved = validatePipeline(frozen.entries, Object.keys(frozen.seedStore));
  const compilation = compilePipeline(
    resolved,
    frozen.budgetAdmission ? PRIVATE_PROBE_CONTRACT_POLICY : undefined,
  );
  assertPipelineInvocationCompilation(frozen, compilation);
  preflight(resolved, { budgetUsd: frozen.budgetUsd });
  return { snapshot: frozen, resolved, compilation };
}

function exactFrozenStage(
  resolved: ResolvedPipeline,
  blockId: string,
): { blockIndex: number; entry: PipelineEntry; manifest: ModuleManifest } {
  const matches = resolved.entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.block === blockId);
  if (matches.length !== 1) {
    throw new Error(`remote child frozen module entry for "${blockId}" is missing or ambiguous`);
  }
  const { index: blockIndex, entry } = matches[0]!;
  const manifest = resolved.manifests[blockIndex];
  if (!manifest || manifest.id !== blockId || resolved.blocks[blockIndex]?.id !== blockId) {
    throw new Error(`remote child frozen module alignment is invalid for "${blockId}"`);
  }
  return { blockIndex, entry, manifest };
}

function knownCompletedSpend(rows: readonly RemoteChildCompletedStage[]): number {
  return rows.reduce((total, row) => {
    if (row.cost === undefined) return total;
    if (!Number.isFinite(row.cost) || row.cost < 0) {
      throw new Error(`remote child completed stage "${row.block}" has an invalid recorded cost`);
    }
    return total + row.cost;
  }, 0);
}

/**
 * Derive the exact stage envelope only after declared upstream inputs have
 * been rehydrated, then reserve every pending frozen paid stage. This mirrors
 * the engine runner's late-bound reservation rail without falling back to the
 * aggregate run budget in the child.
 */
export function admitFrozenRemoteChildStage(args: {
  readonly resolved: ResolvedPipeline;
  readonly blockId: string;
  readonly store: Readonly<Record<string, unknown>>;
  readonly budgetUsd: number;
  readonly completedStages: readonly RemoteChildCompletedStage[];
}): FrozenRemoteChildStageAdmission {
  if (!Number.isFinite(args.budgetUsd) || args.budgetUsd < 0) {
    throw new Error("remote child frozen budget is invalid");
  }
  const { blockIndex, entry, manifest } = exactFrozenStage(args.resolved, args.blockId);
  const completedBlockIds = new Set(args.completedStages.map((row) => row.block));
  if (completedBlockIds.has(args.blockId)) {
    throw new Error(`remote child paid stage "${args.blockId}" is already completed; refusing replay`);
  }
  const knownSpentUsd = knownCompletedSpend(args.completedStages);
  const stageBudgetUsd = manifest.costAndLatency.paid
    ? configuredMaxCostUsd(manifest, entry.params ?? {}, {
        entries: args.resolved.entries,
        index: blockIndex,
        store: args.store,
      })
    : undefined;

  const assertRemainingBudgetReservation: NonNullable<
    StageContext["assertRemainingBudgetReservation"]
  > = (reservationArgs = {}) => {
    const blockIds: string[] = [];
    let reservedMaxCostUsd = 0;
    for (let candidateIndex = blockIndex; candidateIndex < args.resolved.blocks.length; candidateIndex++) {
      const candidate = args.resolved.blocks[candidateIndex]!;
      if (candidateIndex !== blockIndex && completedBlockIds.has(candidate.id)) continue;
      const candidateManifest = args.resolved.manifests[candidateIndex];
      const candidateEntry = args.resolved.entries[candidateIndex];
      if (!candidateManifest || !candidateEntry || candidateManifest.id !== candidate.id) {
        throw new Error(`remote child remaining reservation lost manifest alignment at step ${candidateIndex}`);
      }
      if (!candidateManifest.costAndLatency.paid) continue;
      const envelope = candidateIndex === blockIndex && stageBudgetUsd !== undefined
        ? stageBudgetUsd
        : configuredMaxCostUsd(candidateManifest, candidateEntry.params ?? {}, {
            entries: args.resolved.entries,
            index: candidateIndex,
            store: args.store,
          });
      reservedMaxCostUsd += envelope;
      blockIds.push(candidate.id);
    }
    const required = reservationArgs.requiredFuturePaidBlockIds ?? [];
    const missing = required.filter((id) => !blockIds.includes(id));
    if (missing.length > 0) {
      throw new Error(
        `remote child remaining budget reservation requires pending paid block(s) ${missing.join(", ")}, ` +
          `but found ${blockIds.join(", ") || "none"}`,
      );
    }
    if (
      reservedMaxCostUsd > 0 &&
      (args.budgetUsd <= 0 || knownSpentUsd + reservedMaxCostUsd > args.budgetUsd + Number.EPSILON)
    ) {
      const reason = reservationArgs.reason ? ` (${reservationArgs.reason})` : "";
      throw new Error(
        `remote child budget reservation rejected before paid block "${args.blockId}"${reason}: ` +
          `$${knownSpentUsd.toFixed(2)} spent + $${reservedMaxCostUsd.toFixed(2)} remaining reserved ` +
          `for ${blockIds.join(", ")} > $${args.budgetUsd.toFixed(2)} frozen budget`,
      );
    }
    return { reservedMaxCostUsd, blockIds };
  };

  return {
    blockIndex,
    entry,
    manifest,
    ...(stageBudgetUsd === undefined ? {} : { stageBudgetUsd }),
    knownSpentUsd,
    initialReservation: assertRemainingBudgetReservation({ reason: "remote child admission" }),
    assertRemainingBudgetReservation,
  };
}
