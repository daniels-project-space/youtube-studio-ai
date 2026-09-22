import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { api } from "../../convex/_generated/api";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { assertPipelineWorkerDeployment, pipelineWorkerDeploymentDispatchOptions, type PipelineWorkerDeployment } from "@/lib/pipelineWorkerDeployment";

const continuationApi = (api as unknown as { yue2Continuations: { prepareDispatch: never; recordDispatch: never } }).yue2Continuations;
export type YuE2ContinuationReceipt = { channelId: string; runId: string; invocationSha256: string; attempt: number;
  workerDeployment?: PipelineWorkerDeployment;
  yue2AuditionResume: { checkpointId: string; checkpointFingerprint: string; approvalFingerprint: string; invocationSha256: string } };

/** Called by the existing music recovery tick; no extra cron or idle task. */
export async function dispatchPendingYuE2Continuations(input: {
  ownerId: string; convex: StudioConvexHttpClient; log: (message: string) => void;
  dispatchContext?: Pick<PipelineWorkerDeployment, "projectId" | "environmentId">;
  preparedReceipts?: readonly YuE2ContinuationReceipt[];
}) {
  const receipts = input.preparedReceipts ?? await input.convex.mutation(continuationApi.prepareDispatch, { ownerId: input.ownerId } as never) as unknown as YuE2ContinuationReceipt[];
  if (!Array.isArray(receipts) || receipts.length > 25) throw new Error("YuE2 continuation batch must contain at most 25 receipts");
  let triggered = 0;
  let failed = 0;
  async function dispatchReceipt(receipt: YuE2ContinuationReceipt) {
    const { attempt, workerDeployment, ...payload } = receipt;
    const resume = payload.yue2AuditionResume;
    const acknowledgement = { ownerId: input.ownerId, channelId: payload.channelId, runId: payload.runId, resume, attempt };
    let triggerRunId: string;
    let submitted = false;
    try {
      if (workerDeployment) {
        if (!input.dispatchContext) throw new Error("YuE2 continuation requires verified dispatch context");
        assertPipelineWorkerDeployment(workerDeployment, { ...input.dispatchContext, version: workerDeployment.version });
      }
      const seed = ["yue2-audition-resume/v1", payload.runId, resume.checkpointId, resume.checkpointFingerprint,
        resume.approvalFingerprint, payload.invocationSha256, attempt].join(":");
      const idempotencyKey = await idempotencyKeys.create(seed, { scope: "global" });
      submitted = true;
      const result = await tasks.trigger("run-pipeline", payload, {
        ...pipelineWorkerDeploymentDispatchOptions(workerDeployment), concurrencyKey: payload.channelId,
        idempotencyKey, idempotencyKeyTTL: "24h",
      });
      if (typeof result?.id !== "string" || !result.id.trim()) throw new Error("Missing Trigger delivery identity");
      triggerRunId = result.id;
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
      const rejected = typeof status === "number" && [400, 401, 403, 404, 422].includes(status);
      const ambiguous = submitted && !rejected;
      await input.convex.mutation(continuationApi.recordDispatch, {
        ...acknowledgement, ...(ambiguous ? { ambiguous: true } : {}),
      } as never);
      input.log(`YuE2 continuation enqueue ${ambiguous ? "uncertain" : "failed"} for ${payload.runId}`);
      return;
    }
    // A failed acknowledgement retries the same idempotency key, not a new take.
    await input.convex.mutation(continuationApi.recordDispatch, { ...acknowledgement, triggerRunId } as never);
    triggered++;
  }
  for (const receipt of receipts) {
    try {
      await dispatchReceipt(receipt);
    } catch {
      // An uncertain acknowledgement must not prevent other channels from resuming.
      failed++;
    }
  }
  if (failed) throw new Error(`YuE2 continuation recovery failed for ${failed} of ${receipts.length} receipts`);
  return { pending: receipts.length, triggered };
}
