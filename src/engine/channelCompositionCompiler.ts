/**
 * Certified channel-composition materializer.
 *
 * This is deliberately a narrow, pure layer between a validated family /
 * capability selection and the existing pipeline policy compiler. It may only
 * apply operations sealed into a composition definition; it does not register
 * blocks, select providers, reserve spend, or replace any admission gate.
 */
import {
  assertCapabilityCompositionOperationCompatibility,
  capabilityCompositionPlanMaterialization,
  assertChannelCompositionReceiptBinding,
  certifiedChannelCompositionMaterialization,
  resolveChannelCapabilityCompositionPlan,
  resolveCertifiedChannelComposition,
  type ChannelCompositionBinding,
  type ChannelCompositionMaterialization,
  type ChannelCompositionPipelineOperation,
} from "./channelCompositionCatalog";
import {
  creativeCapabilityCompositionFragmentVersionBindings,
  validateCreativeCapabilitySelections,
  type CreativeCapabilityIntent,
} from "./creative/creativeCapabilityCatalog";
import type { FamilyKey } from "./families";
import type { PipelineEntry } from "./types";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export const CHANNEL_COMPOSITION_COMPILER_VERSION = "certified-channel-composition-compiler/v1" as const;

export interface CompileCertifiedChannelCompositionInput {
  family: FamilyKey;
  /** Original, canonical creator intent required when selecting a capability. */
  intent?: CreativeCapabilityIntent;
  /** The same fingerprint-bound selections accepted at the creator boundary. */
  capabilitySelections: unknown;
  /**
   * Existing advanced-editor params. A composition consumes only explicit,
   * bounded overrides declared beside its operation; all other keys are ignored
   * by this layer.
   */
  parameterOverrides?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  pipeline: readonly PipelineEntry[];
}

export interface CertifiedChannelCompositionCompilation {
  version: typeof CHANNEL_COMPOSITION_COMPILER_VERSION;
  /** The one sealed composition authority used by this compilation. */
  compositionBinding: ChannelCompositionBinding;
  /** Undefined for identity-only compositions with no declared operations. */
  materialization?: ChannelCompositionMaterialization;
  /** Exact sealed operations that were materialized into `pipeline`. */
  operations: readonly ChannelCompositionPipelineOperation[];
  pipeline: PipelineEntry[];
  /** Stable evidence of receipt + operation set + resulting executable graph. */
  fingerprint: string;
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, cloneJsonValue(nested)]),
    );
  }
  return value;
}

function cloneParams(params: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, cloneJsonValue(value)]),
  );
}

function clonePipeline(pipeline: readonly PipelineEntry[]): PipelineEntry[] {
  return pipeline.map((entry) => ({
    block: entry.block,
    ...(entry.params ? { params: cloneParams(entry.params) } : {}),
  }));
}

function operationKind(operation: unknown): string {
  if (operation && typeof operation === "object" && typeof (operation as { kind?: unknown }).kind === "string") {
    return (operation as { kind: string }).kind;
  }
  return "<missing>";
}

function failUnsupportedOperationKind(operation: unknown): never {
  throw new Error(`unsupported certified composition operation kind ${operationKind(operation)}`);
}

function cloneOperation(operation: ChannelCompositionPipelineOperation): ChannelCompositionPipelineOperation {
  switch (operationKind(operation)) {
    case "ensure_block_before": {
      const ordered = operation as Extract<ChannelCompositionPipelineOperation, { kind: "ensure_block_before" }>;
      return {
        kind: ordered.kind,
        block: ordered.block,
        beforeBlock: ordered.beforeBlock,
      };
    }
    case "ensure_block_between": {
      const ordered = operation as Extract<ChannelCompositionPipelineOperation, { kind: "ensure_block_between" }>;
      return {
        kind: ordered.kind,
        block: ordered.block,
        afterBlocks: [...ordered.afterBlocks],
        ...(ordered.optionalAfterBlocks
          ? { optionalAfterBlocks: [...ordered.optionalAfterBlocks] }
          : {}),
        beforeBlock: ordered.beforeBlock,
      };
    }
    case "merge_block_params": {
      const merged = operation as Extract<ChannelCompositionPipelineOperation, { kind: "merge_block_params" }>;
      return {
        kind: merged.kind,
        block: merged.block,
        params: cloneParams(merged.params),
        ...(merged.numericOverrides
          ? { numericOverrides: merged.numericOverrides.map((override) => ({ ...override })) }
          : {}),
      };
    }
    default:
      return failUnsupportedOperationKind(operation);
  }
}

function exactEntryIndex(
  pipeline: readonly PipelineEntry[],
  block: string,
  operation: ChannelCompositionPipelineOperation,
): number {
  const indexes = pipeline
    .map((entry, index) => entry.block === block ? index : -1)
    .filter((index) => index >= 0);
  if (indexes.length !== 1) {
    throw new Error(
      `certified composition operation ${operation.kind} requires exactly one ${block} block; found ${indexes.length}`,
    );
  }
  return indexes[0]!;
}

function ensureBlockBefore(
  pipeline: PipelineEntry[],
  operation: Extract<ChannelCompositionPipelineOperation, { kind: "ensure_block_before" }>,
): void {
  const anchorIndex = exactEntryIndex(pipeline, operation.beforeBlock, operation);
  const existingIndexes = pipeline
    .map((entry, index) => entry.block === operation.block ? index : -1)
    .filter((index) => index >= 0);
  if (existingIndexes.length > 1) {
    throw new Error(
      `certified composition operation ${operation.kind} requires at most one ${operation.block} block; found ${existingIndexes.length}`,
    );
  }
  if (existingIndexes.length === 0) {
    pipeline.splice(anchorIndex, 0, { block: operation.block });
    return;
  }
  if (existingIndexes[0]! > anchorIndex) {
    const [entry] = pipeline.splice(existingIndexes[0]!, 1);
    const refreshedAnchorIndex = exactEntryIndex(pipeline, operation.beforeBlock, operation);
    pipeline.splice(refreshedAnchorIndex, 0, entry!);
  }
}

function optionalEntryIndex(
  pipeline: readonly PipelineEntry[],
  block: string,
  operation: ChannelCompositionPipelineOperation,
): number | undefined {
  const indexes = pipeline
    .map((entry, index) => entry.block === block ? index : -1)
    .filter((index) => index >= 0);
  if (indexes.length > 1) {
    throw new Error(
      `certified composition operation ${operation.kind} requires at most one optional ${block} block; found ${indexes.length}`,
    );
  }
  return indexes[0];
}

function ensureBlockBetween(
  pipeline: PipelineEntry[],
  operation: Extract<ChannelCompositionPipelineOperation, { kind: "ensure_block_between" }>,
): void {
  const anchorIndex = exactEntryIndex(pipeline, operation.beforeBlock, operation);
  const requiredPredecessorIndexes = operation.afterBlocks.map((block) => (
    exactEntryIndex(pipeline, block, operation)
  ));
  const optionalPredecessorIndexes = operation.optionalAfterBlocks
    ?.map((block) => optionalEntryIndex(pipeline, block, operation))
    .filter((index): index is number => index !== undefined) ?? [];
  if ([...requiredPredecessorIndexes, ...optionalPredecessorIndexes].some((index) => index >= anchorIndex)) {
    throw new Error(
      `certified composition operation ${operation.kind} requires every predecessor before ${operation.beforeBlock}`,
    );
  }
  const existingIndexes = pipeline
    .map((entry, index) => entry.block === operation.block ? index : -1)
    .filter((index) => index >= 0);
  if (existingIndexes.length > 1) {
    throw new Error(
      `certified composition operation ${operation.kind} requires at most one ${operation.block} block; found ${existingIndexes.length}`,
    );
  }
  const latestPredecessorIndex = Math.max(...requiredPredecessorIndexes, ...optionalPredecessorIndexes);
  const existingIndex = existingIndexes[0];
  if (existingIndex !== undefined && existingIndex > latestPredecessorIndex && existingIndex < anchorIndex) {
    return;
  }
  const [existing] = existingIndex === undefined ? [] : pipeline.splice(existingIndex, 1);
  const refreshedAnchorIndex = exactEntryIndex(pipeline, operation.beforeBlock, operation);
  pipeline.splice(refreshedAnchorIndex, 0, existing ?? { block: operation.block });
}

function mergeBlockParams(
  pipeline: PipelineEntry[],
  operation: Extract<ChannelCompositionPipelineOperation, { kind: "merge_block_params" }>,
  parameterOverrides: CompileCertifiedChannelCompositionInput["parameterOverrides"],
): void {
  const index = exactEntryIndex(pipeline, operation.block, operation);
  const entry = pipeline[index]!;
  const submitted = parameterOverrides?.[operation.block];
  const boundedOverrides = Object.fromEntries(
    (operation.numericOverrides ?? []).flatMap((override) => {
      const numeric = Number(submitted?.[override.key]);
      if (!Number.isFinite(numeric) || numeric < override.minimum || numeric > override.maximum) return [];
      return [[override.key, override.integer ? Math.round(numeric) : numeric]];
    }),
  );
  pipeline[index] = {
    block: entry.block,
    params: {
      ...(entry.params ? cloneParams(entry.params) : {}),
      ...cloneParams(operation.params),
      ...boundedOverrides,
    },
  };
}

function applyOperation(
  pipeline: PipelineEntry[],
  operation: ChannelCompositionPipelineOperation,
  parameterOverrides: CompileCertifiedChannelCompositionInput["parameterOverrides"],
): void {
  switch (operationKind(operation)) {
    case "ensure_block_before":
      ensureBlockBefore(
        pipeline,
        operation as Extract<ChannelCompositionPipelineOperation, { kind: "ensure_block_before" }>,
      );
      return;
    case "ensure_block_between":
      ensureBlockBetween(
        pipeline,
        operation as Extract<ChannelCompositionPipelineOperation, { kind: "ensure_block_between" }>,
      );
      return;
    case "merge_block_params":
      mergeBlockParams(
        pipeline,
        operation as Extract<ChannelCompositionPipelineOperation, { kind: "merge_block_params" }>,
        parameterOverrides,
      );
      return;
    default:
      return failUnsupportedOperationKind(operation);
  }
}

/**
 * An operation may consume a block inserted by a separately owned fragment.
 * The sealed catalog already rejects cycles; this runtime scheduler simply
 * waits for a producer operation when its required block is absent from the
 * starting pipeline and lets a ready optional-edge producer settle first. It
 * otherwise preserves declared order, so independent fragments remain
 * deterministic without forcing every block-level relationship to be
 * duplicated as a capability dependency.
 */
function operationCanApplyToPipeline(
  pipeline: readonly PipelineEntry[],
  operation: ChannelCompositionPipelineOperation,
): boolean {
  const hasBlock = (block: string) => pipeline.some((entry) => entry.block === block);
  switch (operationKind(operation)) {
    case "ensure_block_before": {
      const ordered = operation as Extract<ChannelCompositionPipelineOperation, { kind: "ensure_block_before" }>;
      return hasBlock(ordered.beforeBlock);
    }
    case "ensure_block_between": {
      const ordered = operation as Extract<ChannelCompositionPipelineOperation, { kind: "ensure_block_between" }>;
      return hasBlock(ordered.beforeBlock) &&
        ordered.afterBlocks.every((block) => hasBlock(block));
    }
    case "merge_block_params": {
      const merged = operation as Extract<ChannelCompositionPipelineOperation, { kind: "merge_block_params" }>;
      return hasBlock(merged.block);
    }
    default:
      return failUnsupportedOperationKind(operation);
  }
}

function operationProducesBlock(
  operation: ChannelCompositionPipelineOperation,
  block: string,
): boolean {
  return (operation.kind === "ensure_block_before" || operation.kind === "ensure_block_between") &&
    operation.block === block;
}

function operationDefersToReadyOptionalProducer(input: {
  readonly pipeline: readonly PipelineEntry[];
  readonly operation: ChannelCompositionPipelineOperation;
  readonly operationIndex: number;
  readonly pendingOperations: readonly ChannelCompositionPipelineOperation[];
}): boolean {
  if (input.operation.kind !== "ensure_block_between") return false;
  const optionalPredecessors = input.operation.optionalAfterBlocks ?? [];
  return optionalPredecessors.some((optionalBlock) => input.pendingOperations.some(
    (candidate, candidateIndex) =>
      candidateIndex !== input.operationIndex &&
      operationProducesBlock(candidate, optionalBlock) &&
      operationCanApplyToPipeline(input.pipeline, candidate),
  ));
}

function applyOperationsInMaterializationOrder(
  pipeline: PipelineEntry[],
  operations: readonly ChannelCompositionPipelineOperation[],
  parameterOverrides: CompileCertifiedChannelCompositionInput["parameterOverrides"],
): void {
  const pending = [...operations];
  while (pending.length > 0) {
    const readyIndex = pending.findIndex((operation, operationIndex) => (
      operationCanApplyToPipeline(pipeline, operation) &&
      !operationDefersToReadyOptionalProducer({
        pipeline,
        operation,
        operationIndex,
        pendingOperations: pending,
      })
    ));
    const fallbackReadyIndex = pending.findIndex((operation) => operationCanApplyToPipeline(pipeline, operation));
    if (readyIndex < 0 && fallbackReadyIndex < 0) {
      // Preserve the existing fail-closed, operation-specific diagnostic when
      // no remaining sealed operation can acquire its declared anchor.
      applyOperation(pipeline, pending[0]!, parameterOverrides);
      throw new Error("sealed composition operation scheduling made no progress");
    }
    const [operation] = pending.splice(readyIndex >= 0 ? readyIndex : fallbackReadyIndex, 1);
    applyOperation(pipeline, operation!, parameterOverrides);
  }
}

function compilationFingerprint(input: {
  compositionBinding: ChannelCompositionBinding;
  materialization?: ChannelCompositionMaterialization;
  operations: readonly ChannelCompositionPipelineOperation[];
  pipeline: readonly PipelineEntry[];
}): string {
  return sha256Hex(canonicalJson({
    version: CHANNEL_COMPOSITION_COMPILER_VERSION,
    compositionBinding: input.compositionBinding,
    ...(input.materialization ? { materialization: input.materialization } : {}),
    operations: input.operations,
    pipeline: input.pipeline,
  }));
}

/**
 * Revalidate the current selected capability route and materialize its sealed
 * authority. Empty selections retain the historical exact-catalog receipt;
 * selected capabilities use a base-plus-fragment plan. Callers must still run
 * existing policy completion, family/capability assertions, validation, and
 * executable pipeline compilation afterwards.
 */
export function compileCertifiedChannelComposition(
  input: CompileCertifiedChannelCompositionInput,
): CertifiedChannelCompositionCompilation {
  if (input.capabilitySelections !== undefined && !input.intent) {
    const candidateSelections = Array.isArray(input.capabilitySelections) ? input.capabilitySelections : [input.capabilitySelections];
    if (candidateSelections.length) {
      throw new Error("certified composition capability selections require canonical creator intent");
    }
  }
  const resolvedSelections = validateCreativeCapabilitySelections({
    family: input.family,
    selections: input.capabilitySelections,
    ...(input.intent ? { intent: input.intent } : {}),
  });
  const selectedCapabilityKeys = resolvedSelections
    .map(({ selection }) => selection.capability)
    .sort((left, right) => left.localeCompare(right));
  const expectedFragmentVersions =
    creativeCapabilityCompositionFragmentVersionBindings(resolvedSelections);
  const compositionBinding: ChannelCompositionBinding = selectedCapabilityKeys.length
    ? {
        kind: "capability_plan_v1",
        plan: resolveChannelCapabilityCompositionPlan({
          family: input.family,
          selectedCapabilityKeys,
          expectedFragmentVersions,
        }),
      }
    : (() => {
        const receipt = resolveCertifiedChannelComposition({
          family: input.family,
          selectedCapabilityKeys,
        });
        assertChannelCompositionReceiptBinding({
          receipt,
          family: input.family,
          selectedCapabilityKeys,
        });
        return { kind: "exact_catalog_v1" as const, receipt };
      })();
  const materialization = compositionBinding.kind === "capability_plan_v1"
    ? capabilityCompositionPlanMaterialization(compositionBinding.plan)
    : certifiedChannelCompositionMaterialization(compositionBinding.receipt);
  const operations = materialization?.operations.map(cloneOperation) ?? [];
  assertCapabilityCompositionOperationCompatibility(
    operations.map((operation) => ({ source: compositionBinding.kind, operation })),
  );
  const pipeline = clonePipeline(input.pipeline);
  applyOperationsInMaterializationOrder(pipeline, operations, input.parameterOverrides);
  return {
    version: CHANNEL_COMPOSITION_COMPILER_VERSION,
    compositionBinding,
    ...(materialization ? { materialization } : {}),
    operations,
    pipeline,
    fingerprint: compilationFingerprint({ compositionBinding, materialization, operations, pipeline }),
  };
}
