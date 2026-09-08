import {
  LIVE_PIPELINE_PHASE_LABEL,
  livePipelinePhaseForBlock,
  type LivePipelinePhase,
} from "@/lib/livePipelinePresentation";

export type PipelineTopologyInput = {
  block: string;
  params?: unknown;
};

export type PipelineTopologyModule = PipelineTopologyInput & {
  index: number;
  controlCount: number;
};

export type PipelineTopologyBand = {
  phase: LivePipelinePhase;
  label: string;
  startIndex: number;
  endIndex: number;
  modules: PipelineTopologyModule[];
};

export function pipelineControlCount(params: unknown): number {
  if (!params || typeof params !== "object" || Array.isArray(params)) return 0;
  return Object.keys(params).length;
}

/**
 * Turn an exact executable route into compact, contiguous phase bands without
 * changing its order. A phase may appear twice (for example music after visual
 * sourcing); retaining that second band is important because grouping by name
 * would falsely reorder the runtime graph.
 */
export function buildPipelineTopology(
  pipeline: readonly PipelineTopologyInput[],
): PipelineTopologyBand[] {
  const bands: PipelineTopologyBand[] = [];
  for (const [offset, entry] of pipeline.entries()) {
    const index = offset + 1;
    const phase = livePipelinePhaseForBlock(entry.block);
    const topologyModule: PipelineTopologyModule = {
      ...entry,
      index,
      controlCount: pipelineControlCount(entry.params),
    };
    const current = bands.at(-1);
    if (current?.phase === phase) {
      current.modules.push(topologyModule);
      current.endIndex = index;
      continue;
    }
    bands.push({
      phase,
      label: LIVE_PIPELINE_PHASE_LABEL[phase],
      startIndex: index,
      endIndex: index,
      modules: [topologyModule],
    });
  }
  return bands;
}
