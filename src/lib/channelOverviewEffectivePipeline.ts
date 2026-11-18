import { mergeRuntimeModuleConfig } from "@/engine/runtimeModuleConfig";
import { materializeRuntimePipelineParams } from "@/engine/materializeRuntimePipelineParams";
import type { PipelineEntry } from "@/engine/types";
import { snapshotParamsByBlock } from "@/lib/pipelineInvocationSnapshot";

/** Resolve the same saved overrides as execution; null means the settings are invalid. */
export function channelOverviewEffectivePipeline(pipeline: PipelineEntry[], moduleConfig: unknown): readonly PipelineEntry[] | null {
  try {
    const merged = mergeRuntimeModuleConfig({ entries: pipeline, paramsByBlock: snapshotParamsByBlock(pipeline), moduleConfig });
    return materializeRuntimePipelineParams(pipeline, merged.paramsByBlock);
  } catch {
    return null;
  }
}
