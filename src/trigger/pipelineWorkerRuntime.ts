import { taskContext } from "@trigger.dev/core/v3";
import type { Context } from "@trigger.dev/sdk/v3";
import type { PipelineInvocationSnapshot } from "@/lib/pipelineInvocationSnapshot";
import {
  assertPipelineWorkerDeployment,
  resolvePipelineWorkerDeployment,
} from "@/lib/pipelineWorkerDeployment";

export type PipelineWorkerContext = Pick<Context, "project" | "environment" | "run" | "deployment">;

export function currentPipelineWorkerDeployment(ctx: PipelineWorkerContext) {
  return resolvePipelineWorkerDeployment({
    workerVersion: taskContext.worker?.version,
    projectId: ctx.project.id,
    environmentId: ctx.environment.id,
    runVersion: ctx.run.version,
    deploymentVersion: ctx.deployment?.version,
  });
}

export function assertFrozenPipelineWorkerDeployment(
  snapshot: PipelineInvocationSnapshot,
  ctx?: PipelineWorkerContext,
): void {
  if (snapshot.workerDeployment === undefined) {
    if (snapshot.entries.some((entry) => entry.version !== undefined)) {
      throw new Error("versioned pipeline requires a frozen worker deployment");
    }
    // Historical unbound receipts retain their shape, not a claim of isolation.
    return;
  }
  if (!ctx) throw new Error("bound pipeline requires executing worker context");
  assertPipelineWorkerDeployment(snapshot.workerDeployment, currentPipelineWorkerDeployment(ctx));
}
