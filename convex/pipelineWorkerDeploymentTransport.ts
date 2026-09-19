import { v } from "convex/values";
import { pipelineInvocationSha256 } from "../src/lib/pipelineInvocationHash";
import {
  normalizePipelineInvocationSnapshot,
  type PipelineInvocationSnapshot,
} from "../src/lib/pipelineInvocationSnapshot";

export const workerDeploymentValidator = v.object({
  version: v.string(),
  projectId: v.string(),
  environmentId: v.string(),
});

export type WorkerDeploymentFields = Pick<PipelineInvocationSnapshot, "workerDeployment">;

/** Only the immutable invocation, never a separate row field, selects a worker. */
export function verifiedWorkerDeploymentFields(run: {
  _id: string;
  ownerId: string;
  channelId: string;
  pipelineInvocationSnapshot?: unknown;
  pipelineInvocationSha256?: string;
}): WorkerDeploymentFields {
  if (run.pipelineInvocationSnapshot === undefined && run.pipelineInvocationSha256 === undefined) {
    return {};
  }
  if (run.pipelineInvocationSnapshot === undefined || run.pipelineInvocationSha256 === undefined) {
    throw new Error("worker deployment transport requires a complete invocation snapshot/hash pair");
  }
  const invocation = normalizePipelineInvocationSnapshot(
    run.pipelineInvocationSnapshot as PipelineInvocationSnapshot,
  );
  if (
    invocation.ownerId !== run.ownerId ||
    invocation.channelId !== String(run.channelId) ||
    invocation.runId !== String(run._id) ||
    pipelineInvocationSha256(invocation) !== run.pipelineInvocationSha256
  ) {
    throw new Error("worker deployment transport invocation identity/hash mismatch");
  }
  return invocation.workerDeployment === undefined ? {} : { workerDeployment: invocation.workerDeployment };
}
