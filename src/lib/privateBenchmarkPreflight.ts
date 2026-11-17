import { assertAutomationNarrationPolicy } from "@/engine/automationNarrationPolicy";
import { ExecutionError } from "@/engine/executionErrors";
import { completePipelineForPolicy, materializeRuntimePipelineParams } from "@/engine/pipelineCompiler";
import { mergeRuntimeModuleConfig } from "@/engine/runtimeModuleConfig";
import type { PipelineEntry } from "@/engine/types";
import { snapshotParamsByBlock } from "@/lib/pipelineInvocationSnapshot";
import { buildRouteQualificationBenchmarkPipeline } from "@/lib/routeQualificationBenchmark";

type Channel = {
  pipeline: PipelineEntry[];
  moduleConfig?: unknown;
  identity?: { voiceId?: string; programBrief?: unknown; programRoute?: unknown };
  family?: unknown;
  contentLane?: unknown;
};

/** Read-only structural and narration check; runtime revalidates before spend. */
export function privatePipelineConfigurationPreflight(channel: Channel) {
  const blockers: string[] = [];
  let removedDeliveryBlocks: string[] = [];
  try {
    const privatePipeline = buildRouteQualificationBenchmarkPipeline(channel.pipeline);
    const privateBlocks = new Set(privatePipeline.map(entry => entry.block));
    removedDeliveryBlocks = [...new Set(channel.pipeline.map(entry => entry.block).filter(block => !privateBlocks.has(block)))];
    const completed = completePipelineForPolicy(privatePipeline, { manifestSource: "structural" });
    const merged = mergeRuntimeModuleConfig({ entries: completed.entries, paramsByBlock: snapshotParamsByBlock(completed.entries), moduleConfig: channel.moduleConfig });
    const effective = materializeRuntimePipelineParams(completed.entries, merged.paramsByBlock);
    assertAutomationNarrationPolicy(effective, { voiceId: channel.identity?.voiceId }, { YOUTUBE_AUTOMATION_PRIVATE: "1" });
  } catch (error) {
    blockers.push(error instanceof ExecutionError ? error.message : "The saved pipeline or module settings could not be prepared for this private benchmark.");
  }
  return { blockers, removedDeliveryBlocks };
}

/** Read-only assessment of the existing benchmark path, not a run admission. */
export function privateBenchmarkPreflight(channel: Channel) {
  const { blockers, removedDeliveryBlocks } = privatePipelineConfigurationPreflight(channel);
  if (!channel.identity?.programBrief || !channel.identity?.programRoute) {
    blockers.push("This benchmark requires a sealed, eligible channel route. A general private run for legacy pipelines is not available yet.");
  }
  return { blockers, removedDeliveryBlocks, preflightReceiptChecked: false, providerReadinessChecked: false };
}
