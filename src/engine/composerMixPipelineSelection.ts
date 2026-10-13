import type { PipelineEntry } from "./types";

export const COMPOSER_MIX_ASSEMBLY_VERSION = "2.0.0-composer-mix";

/** Select the optional music handoff only for an unpinned, ordered shared-music route. */
export function selectComposerMixAssembly(source: readonly PipelineEntry[]): PipelineEntry[] {
  const musicIndexes = source.flatMap((entry, index) => entry.block === "music" ? [index] : []);
  const assemblyIndexes = source.flatMap((entry, index) => entry.block === "timeline_assemble" ? [index] : []);
  if (musicIndexes.length !== 1 || assemblyIndexes.length !== 1) return source.map((entry) => ({ ...entry }));

  const musicIndex = musicIndexes[0];
  const assemblyIndex = assemblyIndexes[0];
  if (musicIndex >= assemblyIndex || source[assemblyIndex].version !== undefined) {
    return source.map((entry) => ({ ...entry }));
  }

  return source.map((entry, index) => index === assemblyIndex
    ? { ...entry, version: COMPOSER_MIX_ASSEMBLY_VERSION }
    : { ...entry });
}
