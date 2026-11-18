import type { PipelineInvocationSnapshot } from "@/lib/pipelineInvocationSnapshot";
import { assertRouteQualificationBenchmarkDispatchEnvelope, ROUTE_QUALIFICATION_BENCHMARK_INPUT_V2, ROUTE_QUALIFICATION_BENCHMARK_INPUT_V3, routeQualificationBenchmarkApprovalSubject } from "@/lib/routeQualificationBenchmark";
import { assertCandidateBenchmarkExecutionBinding } from "@/lib/candidateBenchmarkExecutionBinding";

/** Revalidates new benchmark snapshots against their durable signed handoff before storage. */
export function assertRouteQualificationBenchmarkInvocationBinding(input: { ownerId: string; channelId: string; runId: string; envelope: unknown; storedEnvelopeFingerprint?: string; snapshot: PipelineInvocationSnapshot; candidateInvocationInput?: unknown; candidateTarget?: unknown }) {
  if (input.envelope === undefined) {
    if (input.snapshot.budgetAdmission?.kind === "route-qualification-benchmark") throw new Error("Benchmark invocation has no durable envelope.");
    return;
  }
  assertRouteQualificationBenchmarkDispatchEnvelope(input.envelope);
  const envelope = input.envelope;
  if (envelope.ownerId !== input.ownerId || envelope.channelId !== input.channelId || envelope.runId !== input.runId || envelope.dispatchEnvelopeFingerprint !== input.storedEnvelopeFingerprint) throw new Error("Benchmark invocation envelope identity mismatch.");
  if (envelope.input.version !== ROUTE_QUALIFICATION_BENCHMARK_INPUT_V2 && envelope.input.version !== ROUTE_QUALIFICATION_BENCHMARK_INPUT_V3) return;
  const admission = input.snapshot.budgetAdmission;
  const subject = routeQualificationBenchmarkApprovalSubject({ ownerId: input.ownerId, channelId: input.channelId, runId: input.runId, benchmarkInput: envelope.input, maximumCostUsd: envelope.maximumCostUsd });
  if (!admission || admission.kind !== "route-qualification-benchmark" || admission.maximumCostUsd !== envelope.maximumCostUsd || admission.receiptFingerprint !== envelope.approvalFingerprint || envelope.approval.subject !== subject || admission.subject !== subject || admission.pipelineOverrideFingerprint !== envelope.input.benchmarkPipelineFingerprint || admission.dispatchEnvelopeFingerprint !== envelope.dispatchEnvelopeFingerprint || admission.productionPipelineFingerprint !== envelope.input.productionPipelineFingerprint || admission.preflightReceiptFingerprint !== envelope.input.preflightReceiptFingerprint || input.snapshot.budgetUsd !== envelope.maximumCostUsd || input.snapshot.source !== "override" || input.snapshot.keyPrefix !== envelope.input.invocationContext.keyPrefix || !input.snapshot.workerDeployment) throw new Error("Benchmark invocation is not bound to its admission and worker release.");
  assertCandidateBenchmarkExecutionBinding({ benchmark: envelope.input, frozenInput: input.candidateInvocationInput, candidateTarget: input.candidateTarget, snapshot: input.snapshot });
}
