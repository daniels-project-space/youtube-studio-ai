const RETRYABLE_PIPELINE_RUN_STATUSES = new Set(["queued", "running", "failed"]);

export interface DurablePipelineRunIdentity {
  _id: string;
  ownerId: string;
  channelId: string;
  status: string;
  planItemId?: string;
}

/**
 * Reject a forged/cross-tenant task payload and terminal replay before the
 * pipeline status changes or any paid block can start. Failed is deliberately
 * admitted because Trigger retries resume a run after the first task attempt
 * has durably marked it failed.
 */
export function assertRunPipelineAdmission(args: {
  run: DurablePipelineRunIdentity | null | undefined;
  runId: string;
  ownerId: string;
  channelId: string;
  scheduledPlanItemId?: string;
}): asserts args is typeof args & { run: DurablePipelineRunIdentity } {
  const run = args.run;
  if (!run) throw new Error(`run-pipeline run not found: ${args.runId}`);
  if (
    String(run._id) !== args.runId ||
    run.ownerId !== args.ownerId ||
    String(run.channelId) !== args.channelId
  ) {
    throw new Error("run-pipeline run ownership/channel mismatch");
  }
  if (!RETRYABLE_PIPELINE_RUN_STATUSES.has(run.status)) {
    throw new Error(`run-pipeline refuses terminal run status: ${run.status}`);
  }

  const durablePlanItemId = run.planItemId ? String(run.planItemId) : undefined;
  if (durablePlanItemId !== args.scheduledPlanItemId) {
    throw new Error("run-pipeline scheduled-plan payload/run mismatch");
  }
}
