import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { normalizePipelineInvocationSnapshot, type PipelineInvocationSnapshot } from "@/lib/pipelineInvocationSnapshot";
import { ROUTE_QUALIFICATION_BENCHMARK_INPUT_V3, type RouteQualificationBenchmarkInput } from "@/lib/routeQualificationBenchmark";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Excludes the signed admission itself to avoid a signature/envelope hash cycle. */
export function candidateBenchmarkExecutionFingerprint(snapshot: PipelineInvocationSnapshot): string {
  const { budgetAdmission: _admission, ...execution } = normalizePipelineInvocationSnapshot(snapshot);
  return sha256Hex(canonicalJson({ version: "candidate-benchmark-execution/v1", execution }));
}

/** Called only after the ordinary signed benchmark admission has been verified. */
export function assertCandidateBenchmarkExecutionBinding(input: { benchmark: RouteQualificationBenchmarkInput; frozenInput: unknown; candidateTarget?: unknown; snapshot: PipelineInvocationSnapshot }): void {
  if (input.benchmark.version !== ROUTE_QUALIFICATION_BENCHMARK_INPUT_V3) return;
  const binding = input.benchmark.candidateExecutionBinding;
  const frozen = input.frozenInput;
  if (!binding || !record(frozen) || !record(frozen.body) || !record(frozen.body.candidate) || !record(input.candidateTarget) || canonicalJson(input.candidateTarget) !== canonicalJson(frozen.body.candidate) || typeof frozen.fingerprint !== "string" || sha256Hex(canonicalJson(frozen.body)) !== frozen.fingerprint || frozen.fingerprint !== binding.invocationInputFingerprint || frozen.body.candidate.candidateId !== binding.candidateId || frozen.body.candidate.fingerprint !== binding.candidateFingerprint || frozen.body.candidate.baselineFingerprint !== binding.baselineFingerprint || frozen.body.ownerId !== input.snapshot.ownerId || frozen.body.channelId !== input.snapshot.channelId || frozen.body.runId !== input.snapshot.runId || frozen.body.maximumCostUsd !== input.snapshot.budgetUsd || canonicalJson(frozen.body.productionPipeline) !== canonicalJson(input.benchmark.productionPipeline) || canonicalJson(frozen.body.benchmarkPipeline) !== canonicalJson(input.benchmark.benchmarkPipeline) || canonicalJson(frozen.body.moduleConfigOverride) !== canonicalJson(input.benchmark.moduleConfigOverride) || !input.snapshot.workerDeployment || candidateBenchmarkExecutionFingerprint(input.snapshot) !== binding.executionFingerprint) throw new Error("candidate benchmark compiled execution or final seeds do not match the approved input");
}
