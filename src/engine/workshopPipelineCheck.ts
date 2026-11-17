import { registerAllBlocks } from "./blocks";
import { assertPipelineMatchesContentLane, contentLaneForFamily } from "./contentLane";
import { channelPipelineValidationSeedKeys } from "./channelPipelineSeedKeys";
import { compilePipeline } from "./pipelineCompiler";
import { validatePipeline } from "./validate";
import type { PipelineEntry } from "./types";

/** Structural and policy checks only: no provider, trial or release admission. */
export function checkWorkshopPipeline(family: string, entries: PipelineEntry[]) {
  const lane = contentLaneForFamily(family);
  if (!lane) throw new Error("Choose a supported video format before checking compatibility");
  registerAllBlocks();
  const resolved = validatePipeline(entries, channelPipelineValidationSeedKeys(lane, undefined, entries));
  assertPipelineMatchesContentLane(lane, entries);
  const compiled = compilePipeline(resolved);
  return {
    family, lane: lane.key, fingerprint: compiled.fingerprint,
    modules: compiled.modules.map(module => ({ id: module.id, version: module.version })),
    warnings: compiled.warnings,
    reservedMaxCostUsd: compiled.reservedMaxCostUsd,
    unpinnedModules: entries.filter(entry => !entry.version).map(entry => entry.block),
  };
}
