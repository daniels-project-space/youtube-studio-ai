import type { PipelineEntry } from "./types";

export const CHANNEL_AWARE_SCRIPT_QA_VERSION = "2.0.0-channel-aware";
export const CHANNEL_AWARE_SCRIPT_GEN_VERSION = "2.0.0-channel-identity";

/** Pin identity-grounded writing and critique together on new, ordered, unpinned routes. */
export function selectChannelAwareScriptQa(source: readonly PipelineEntry[]): PipelineEntry[] {
  const scriptIndexes = source.flatMap((entry, index) => entry.block === "script_gen" ? [index] : []);
  const qaIndexes = source.flatMap((entry, index) => entry.block === "qa_script" ? [index] : []);
  if (scriptIndexes.length !== 1 || qaIndexes.length !== 1) return source.map((entry) => ({ ...entry }));

  const scriptIndex = scriptIndexes[0];
  const qaIndex = qaIndexes[0];
  if (scriptIndex >= qaIndex || source[scriptIndex].version !== undefined || source[qaIndex].version !== undefined) {
    return source.map((entry) => ({ ...entry }));
  }

  return source.map((entry, index) => index === qaIndex
    ? { ...entry, version: CHANNEL_AWARE_SCRIPT_QA_VERSION }
    : index === scriptIndex
      ? { ...entry, version: CHANNEL_AWARE_SCRIPT_GEN_VERSION }
      : { ...entry });
}
