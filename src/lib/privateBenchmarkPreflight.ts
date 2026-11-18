import { assertAutomationNarrationPolicy } from "@/engine/automationNarrationPolicy";
import { ExecutionError } from "@/engine/executionErrors";
import { MODULE_CONTRACTS } from "@/engine/moduleContracts";
import { NARRATION_TTS_MODULE_COST_CEILING_USD } from "@/engine/narrationTtsCost";
import { completePipelineForPolicy, materializeRuntimePipelineParams, PipelinePolicyError } from "@/engine/pipelineCompiler";
import { mergeRuntimeModuleConfig } from "@/engine/runtimeModuleConfig";
import type { PipelineEntry } from "@/engine/types";
import { snapshotParamsByBlock } from "@/lib/pipelineInvocationSnapshot";
import { buildRouteQualificationBenchmarkPipeline } from "@/lib/routeQualificationBenchmark";
import { buildManualPrivateVideoPipeline } from "@/lib/manualPrivateVideoPipeline";

type Channel = {
  pipeline: PipelineEntry[];
  moduleConfig?: unknown;
  budget?: number;
  identity?: { voiceId?: string; programBrief?: unknown; programRoute?: unknown };
  family?: unknown;
  contentLane?: unknown;
};

/** Read-only structural and narration check; runtime revalidates before spend. */
export function privatePipelineConfigurationPreflight(
  channel: Channel,
  requestCeilingUsd?: number,
  mode: "manual-private-video" | "qualification-benchmark" = "manual-private-video",
) {
  const blockers: string[] = [];
  let removedDeliveryBlocks: string[] = [];
  let prepared: null | { entries: PipelineEntry[]; inserted: string[]; retired: string[]; skippedModuleConfig: string[] } = null;
  try {
    const benchmarkPipeline = buildRouteQualificationBenchmarkPipeline(channel.pipeline);
    const privatePipeline = mode === "manual-private-video"
      ? buildManualPrivateVideoPipeline(channel.pipeline)
      : benchmarkPipeline;
    const privateBlocks = new Set(benchmarkPipeline.map(entry => entry.block));
    removedDeliveryBlocks = [...new Set(channel.pipeline.map(entry => entry.block).filter(block => !privateBlocks.has(block)))];
    const completed = completePipelineForPolicy(privatePipeline, { manifestSource: "structural" });
    const merged = mergeRuntimeModuleConfig({ entries: completed.entries, paramsByBlock: snapshotParamsByBlock(completed.entries), moduleConfig: channel.moduleConfig });
    const effective = materializeRuntimePipelineParams(completed.entries, merged.paramsByBlock);
    assertAutomationNarrationPolicy(effective, { voiceId: channel.identity?.voiceId }, { YOUTUBE_AUTOMATION_PRIVATE: "1" });
    prepared = { entries: effective, inserted: [...completed.inserted], retired: [...completed.retired], skippedModuleConfig: [...merged.skippedBlockIds] };
    const index = effective.findIndex(entry => entry.block === "narration_tts");
    if (index >= 0) {
      const narration = effective[index]!;
      const estimate = MODULE_CONTRACTS.narration_tts?.maxCostUsdFor?.(narration.params ?? {}, { entries: effective, index });
      if (typeof estimate !== "number" || !Number.isFinite(estimate) || estimate < 0) {
        blockers.push("The narration spending reservation could not be calculated.");
      } else if (estimate > NARRATION_TTS_MODULE_COST_CEILING_USD + Number.EPSILON) {
        blockers.push(`The conservative narration reservation is $${estimate.toFixed(2)}, above the $${NARRATION_TTS_MODULE_COST_CEILING_USD.toFixed(2)} narration limit. This is a reservation, not a bill; the saved duration has not been shortened.`);
      } else if (typeof channel.budget === "number" && Number.isFinite(channel.budget) && estimate > channel.budget + Number.EPSILON) {
        blockers.push(`The conservative narration reservation is $${estimate.toFixed(2)}, above the $${channel.budget.toFixed(2)} channel budget. This is a reservation, not a bill; the saved duration has not been shortened.`);
      } else if (typeof requestCeilingUsd === "number" && Number.isFinite(requestCeilingUsd) && estimate > requestCeilingUsd + Number.EPSILON) {
        blockers.push(`The conservative narration reservation is $${estimate.toFixed(2)}, above this request's $${requestCeilingUsd.toFixed(2)} ceiling. This is a reservation, not a bill; the saved duration has not been shortened.`);
      }
    }
  } catch (error) {
    blockers.push(error instanceof ExecutionError || (error instanceof PipelinePolicyError && error.message.startsWith("explicit executable version for ")) ? error.message : "The saved pipeline or module settings could not be prepared for this private benchmark.");
  }
  return { blockers, removedDeliveryBlocks, prepared };
}

/** Read-only assessment of the existing benchmark path, not a run admission. */
export function privateBenchmarkPreflight(channel: Channel) {
  const { blockers, removedDeliveryBlocks } = privatePipelineConfigurationPreflight(channel, undefined, "qualification-benchmark");
  if (!channel.identity?.programBrief || !channel.identity?.programRoute) {
    blockers.push("This qualification benchmark requires a sealed, eligible channel route. A private video can be requested separately.");
  }
  return { blockers, removedDeliveryBlocks, preflightReceiptChecked: false, providerReadinessChecked: false };
}
