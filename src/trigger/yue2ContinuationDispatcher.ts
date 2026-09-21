import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { api } from "../../convex/_generated/api";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { assertPipelineWorkerDeployment, pipelineWorkerDeploymentDispatchOptions, type PipelineWorkerDeployment } from "@/lib/pipelineWorkerDeployment";

const continuationApi = (api as unknown as { yue2Continuations: { prepareDispatch: never; recordDispatch: never } }).yue2Continuations;
type Receipt = { channelId: string; runId: string; invocationSha256: string; attempt: number;
  workerDeployment?: PipelineWorkerDeployment;
  yue2AuditionResume: { checkpointId: string; checkpointFingerprint: string; approvalFingerprint: string; invocationSha256: string } };

/** Called by the existing music recovery tick; no extra cron or idle task. */
export async function dispatchPendingYuE2Continuations(input: {
  ownerId: string; convex: StudioConvexHttpClient; log: (message: string) => void;
  dispatchContext?: Pick<PipelineWorkerDeployment, "projectId" | "environmentId">;
}) {
  const receipts = await input.convex.mutation(continuationApi.prepareDispatch, { ownerId: input.ownerId } as never) as unknown as Receipt[];
  let triggered = 0;
  for (const receipt of receipts) {
    const { attempt, workerDeployment, ...payload } = receipt;
    const resume = payload.yue2AuditionResume;
    const acknowledgement = { ownerId: input.ownerId, channelId: payload.channelId, runId: payload.runId, resume, attempt };
    let triggerRunId: string;
    try {
      if (workerDeployment) {
        if (!input.dispatchContext) throw new Error("YuE2 continuation requires verified dispatch context");
        assertPipelineWorkerDeployment(workerDeployment, { ...input.dispatchContext, version: workerDeployment.version });
      }
      const seed = ["yue2-audition-resume/v1", payload.runId, resume.checkpointId, resume.checkpointFingerprint,
        resume.approvalFingerprint, payload.invocationSha256, attempt].join(":");
      const result = await tasks.trigger("run-pipeline", payload, {
        ...pipelineWorkerDeploymentDispatchOptions(workerDeployment), concurrencyKey: payload.channelId,
        idempotencyKey: await idempotencyKeys.create(seed, { scope: "global" }),
      });
      triggerRunId = result.id;
    } catch {
      await input.convex.mutation(continuationApi.recordDispatch, acknowledgement as never);
      input.log(`YuE2 continuation enqueue failed for ${payload.runId}`);
      continue;
    }
    // A failed acknowledgement retries the same idempotency key, not a new take.
    await input.convex.mutation(continuationApi.recordDispatch, { ...acknowledgement, triggerRunId } as never);
    triggered++;
  }
  return { pending: receipts.length, triggered };
}
