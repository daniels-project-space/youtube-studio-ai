/**
 * A run becomes part of current operational reporting only after its immutable
 * pipeline receipt has been persisted. Older imported rows remain available in
 * the legacy archive, but cannot truthfully be presented as an execution of
 * the current modular pipeline.
 */
export type PipelineProvenanceRecord = {
  readonly pipelineInvocationSnapshot?: unknown;
  readonly pipelineInvocationSha256?: unknown;
};

export function hasFrozenPipelineProvenance(
  run: PipelineProvenanceRecord,
): boolean {
  return run.pipelineInvocationSnapshot !== undefined &&
    typeof run.pipelineInvocationSha256 === "string" &&
    run.pipelineInvocationSha256.trim().length > 0;
}
