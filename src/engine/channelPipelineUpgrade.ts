import type { PipelineEntry } from "./types";
import {
  compilePipeline,
  completePipelineForPolicy,
  type PipelineCompilation,
} from "./pipelineCompiler";
import { validatePipeline } from "./validate";
import { comparablePipeline } from "./channelPipelineComparable";
import { familyDurationContract, familyTimeScalingContract } from "./families";
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
  const blocks = new Set(source.map((entry) => entry.block));
  const isMusicLoop = blocks.has("scene_planner")
    && blocks.has("keyframes")
    && blocks.has("loop_clips")
    && blocks.has("assemble")
    && !blocks.has("timeline_assemble");
  let prepared = [...source];
  if (isMusicLoop) {
    const scaling = familyTimeScalingContract("music_loop");
    const duration = familyDurationContract("music_loop");
    if (scaling.method !== "stream_loop") {
      throw new Error("music-loop pipeline upgrade has no stream-loop scaling contract");
    }
    prepared = prepared.map((entry) => {
      if (entry.block !== "scene_planner" && entry.block !== "loop_clips" && entry.block !== "assemble") return entry;
      const params = { ...(entry.params ?? {}) };
      if (entry.block === "scene_planner") params.clipDurationSec = scaling.sourceSegmentSeconds;
      if (entry.block === "loop_clips") {
        params.segmentCount = scaling.sourceSegmentCount;
        params.clipDurationSec = scaling.sourceSegmentSeconds;
        params.loopMode = scaling.loopMode;
        params.flfCrossfadeSec = 0.4;
        delete params.crossfadeSec;
      }
      if (entry.block === "assemble") {
        const requested = Number(params.durationSec);
        if (
          !Number.isFinite(requested)
          || requested < duration.minimumSeconds
          || requested > duration.maximumSeconds
          || (requested - duration.minimumSeconds) % duration.stepSeconds !== 0
        ) {
          params.durationSec = duration.defaultSeconds;
        }
      }
      return { ...entry, params };
    });
  }
  const completed = completePipelineForPolicy(prepared);
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
