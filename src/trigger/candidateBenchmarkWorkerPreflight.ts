import type { ContentLane } from "@/engine/contentLane";
import type { PipelineEntry } from "@/engine/types";
import { compileWorkerPipeline } from "@/engine/workerPipelineMaterialization";
import { preflight } from "@/engine/validate";
import { canonicalJson } from "@/lib/canonicalJson";
import { assertCandidateBenchmarkExecutionBinding } from "@/lib/candidateBenchmarkExecutionBinding";
import { assertPipelineInvocationCompilation, REMOTE_RENDER_BLOCK_IDS, type PipelineInvocationSnapshot } from "@/lib/pipelineInvocationSnapshot";
import { ROUTE_QUALIFICATION_BENCHMARK_INPUT_V3, type RouteQualificationBenchmarkInput } from "@/lib/routeQualificationBenchmark";

/** Recheck the exact enriched v3 snapshot before credentials or provider work. */
export function preflightCandidateBenchmarkWorker(input: {
  benchmark: RouteQualificationBenchmarkInput; frozenInput: unknown; candidateTarget: unknown;
  snapshot: PipelineInvocationSnapshot; entries: PipelineEntry[]; seedStore: Record<string, unknown>; contentLane: ContentLane;
}) {
  if (input.benchmark.version !== ROUTE_QUALIFICATION_BENCHMARK_INPUT_V3) throw new Error("candidate worker requires a v3 benchmark");
  if (canonicalJson(input.snapshot.entries) !== canonicalJson(input.entries) || canonicalJson(input.snapshot.seedStore) !== canonicalJson(input.seedStore)) throw new Error("candidate worker entries or final seeds changed before preflight");
  const remoteBlocks = input.entries.filter(entry => (REMOTE_RENDER_BLOCK_IDS as readonly string[]).includes(entry.block)).map(entry => entry.block);
  if (input.snapshot.source !== "override" || input.snapshot.keyPrefix !== input.benchmark.invocationContext.keyPrefix || input.snapshot.defaultRetries !== 2 || canonicalJson(input.snapshot.remoteBlocks) !== canonicalJson(remoteBlocks)) throw new Error("candidate worker execution settings do not match the worker contract");
  assertCandidateBenchmarkExecutionBinding({ benchmark: input.benchmark, frozenInput: input.frozenInput, candidateTarget: input.candidateTarget, snapshot: input.snapshot });
  const { resolved, compilation } = compileWorkerPipeline({ entries: input.entries, contentLane: input.contentLane, seedStore: input.seedStore, privateAdmission: true });
  assertPipelineInvocationCompilation(input.snapshot, compilation);
  if (canonicalJson(input.snapshot.compilationModules) !== canonicalJson(compilation.modules) || canonicalJson(input.snapshot.compilationCapabilities) !== canonicalJson(compilation.capabilities) || input.snapshot.reservedMaxCostUsd !== compilation.reservedMaxCostUsd) throw new Error("candidate worker compiled module or cost metadata changed");
  preflight(resolved, { budgetUsd: input.snapshot.budgetUsd });
  return { resolved, compilation };
}
