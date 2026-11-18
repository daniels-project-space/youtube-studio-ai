import { mergeRuntimeModuleConfig } from "../engine/runtimeModuleConfig";
import { materializeRuntimePipelineParams } from "../engine/materializeRuntimePipelineParams";
import type { PipelineEntry } from "../engine/types";
import { snapshotParamsByBlock } from "./pipelineInvocationSnapshot";
import { canonicalJson } from "./canonicalJson";

/** Proves only materialization reproducible without worker-only transformations. */
export function assertCandidateBenchmarkMaterialization(
  entries: readonly PipelineEntry[], moduleConfig: unknown, actual: readonly PipelineEntry[],
): void {
  const merged = mergeRuntimeModuleConfig({ entries, paramsByBlock: snapshotParamsByBlock(entries), moduleConfig });
  const expected = materializeRuntimePipelineParams(entries, merged.paramsByBlock);
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new Error("candidate benchmark materialization cannot be proven from its private pipeline");
  }
}
