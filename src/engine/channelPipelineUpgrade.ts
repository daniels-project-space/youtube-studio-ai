import type { PipelineEntry } from "./types";
import {
  compilePipeline,
  completePipelineForPolicy,
  type PipelineCompilation,
} from "./pipelineCompiler";
import { validatePipeline } from "./validate";
import { comparablePipeline } from "./channelPipelineComparable";
export { comparablePipeline } from "./channelPipelineComparable";

export interface ChannelPipelineUpgradePlan {
  changed: boolean;
  entries: PipelineEntry[];
  inserted: string[];
  retired: string[];
  compilation: PipelineCompilation;
}

/**
 * Materialize the same production-policy completion used by the runtime.
 *
 * This deliberately upgrades the channel's selected flow instead of replacing
 * it with a generic archetype. Specialist engines (whiteboard, motion-comic,
 * finance inserts, lofi, and future channel-specific modules) therefore remain
 * selected while proven retired rows are removed and uniquely required
 * contract modules are inserted.
 */
export function planChannelPipelineUpgrade(
  source: readonly PipelineEntry[],
): ChannelPipelineUpgradePlan {
  const completed = completePipelineForPolicy(source);
  const resolved = validatePipeline(completed.entries);
  const compilation = compilePipeline(resolved);

  // The production policy rejects these already. Keep this explicit here so a
  // future policy relaxation can never turn a persisted-channel migration into
  // a legacy-module backdoor.
  const unsafe = compilation.modules.filter(
    (module) => module.certification === "legacy" || module.certification === "revoked",
  );
  if (unsafe.length) {
    throw new Error(
      `channel pipeline contains non-production modules: ${unsafe
        .map((module) => `${module.id}:${module.certification}`)
        .join(", ")}`,
    );
  }

  return {
    changed: comparablePipeline(source) !== comparablePipeline(completed.entries),
    entries: completed.entries,
    inserted: completed.inserted,
    retired: completed.retired,
    compilation,
  };
}
