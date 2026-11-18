import type { PipelineEntry } from "@/engine/types";
import { mergeRuntimeModuleConfig } from "@/engine/runtimeModuleConfig";
import { compilePipeline, materializeRuntimePipelineParams, PRIVATE_PROBE_CONTRACT_POLICY, PRIVATE_PROBE_DEFERRED_THUMBNAIL_CONTRACT_POLICY } from "@/engine/pipelineCompiler";
import type { ContentLane } from "@/engine/contentLane";
import { channelPipelineValidationSeedKeys } from "@/engine/channelPipelineSeedKeys";
import { assertAutomationNarrationPolicy } from "@/engine/automationNarrationPolicy";
import { assertPrivateVideoHasNoDelivery } from "@/engine/privateVideoDelivery";
import { validatePipeline } from "@/engine/validate";
import { bindScriptNarrationTiming } from "@/lib/narrationTimingPlan";
import { snapshotParamsByBlock } from "@/lib/pipelineInvocationSnapshot";

/** The same module override merge used before a worker freezes its invocation. */
export function prepareWorkerModuleConfig(entries: PipelineEntry[], moduleConfig: Record<string, Record<string, unknown>> | undefined) {
  const paramsByBlock = snapshotParamsByBlock(entries);
  const merged = mergeRuntimeModuleConfig({ entries, paramsByBlock, moduleConfig });
  Object.assign(paramsByBlock, merged.paramsByBlock);
  return { paramsByBlock, merged };
}

/** Materialize and bind the exact params the worker will compile. */
export function materializeWorkerPipelineParams(entries: PipelineEntry[], paramsByBlock: ReturnType<typeof snapshotParamsByBlock>, madeForKids: boolean) {
  return bindScriptNarrationTiming(materializeRuntimePipelineParams(entries, paramsByBlock)).map((entry) =>
    entry.block === "upload_draft" && (madeForKids || typeof entry.params?.["madeForKids"] !== "boolean")
      ? { ...entry, params: { ...(entry.params ?? {}), madeForKids: madeForKids || entry.params?.["madeForKids"] === true } }
      : entry,
  );
}

/** Worker pre-provider validation and compilation, over its actual seed values. */
export function compileWorkerPipeline(input: { entries: PipelineEntry[]; contentLane: ContentLane; seedStore: Record<string, unknown>; privateAdmission: boolean; deferredThumbnail?: boolean; env?: Readonly<Record<string, string | undefined>> }) {
  if (input.privateAdmission) assertPrivateVideoHasNoDelivery(input.entries);
  assertAutomationNarrationPolicy(input.entries, input.seedStore, input.env);
  const seedKeys = channelPipelineValidationSeedKeys(input.contentLane, input.seedStore["channelProgramRoute"], input.entries);
  const resolved = validatePipeline(input.entries, seedKeys);
  const compilation = compilePipeline(resolved, input.privateAdmission ? input.deferredThumbnail ? PRIVATE_PROBE_DEFERRED_THUMBNAIL_CONTRACT_POLICY : PRIVATE_PROBE_CONTRACT_POLICY : undefined);
  return { seedKeys, resolved, compilation };
}
