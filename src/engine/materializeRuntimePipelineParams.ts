import type { PipelineEntry } from "./types";

/** Freeze the parameter set the runner will execute before validation and fingerprinting. */
export function materializeRuntimePipelineParams(
  entries: readonly PipelineEntry[],
  paramsByBlock: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): PipelineEntry[] {
  return entries.map((entry) => {
    const effectiveParams = paramsByBlock[entry.block];
    return effectiveParams ? { ...entry, params: { ...effectiveParams } } : entry;
  });
}
