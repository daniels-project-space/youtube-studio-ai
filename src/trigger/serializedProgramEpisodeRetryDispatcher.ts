import { idempotencyKeys, schedules, tasks } from "@trigger.dev/sdk";
import { deliveryRecoveryMode } from "@/lib/deliveryRecoveryMode";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import {
  serializedProgramEpisodeBusyRetrySchedule,
} from "@/lib/serializedProgramEpisode";
import type { ScheduledPlanRunPayload } from "@/lib/scheduledPlanRuntime";
import type { RunPipelineInput } from "./runPipeline";
import { assertPipelineWorkerDeployment, pipelineWorkerDeploymentDispatchOptions, type PipelineWorkerDeployment } from "@/lib/pipelineWorkerDeployment";

const SERIALIZED_PROGRAM_EPISODE_RETRY_DISPATCH_LIMIT = 50;
const SERIALIZED_PROGRAM_EPISODE_RETRY_CONCURRENCY = 4;

type DueRetryReceipt = {
  runId: string;
  channelId: string;
  invocationSha256: string;
  retryAt: number;
  attempt: number;
  scheduledPlan?: ScheduledPlanRunPayload;
  workerDeployment?: PipelineWorkerDeployment;
};

/**
 * Re-dispatch already-admitted serialized episode retries when a Trigger
 * enqueue was lost after the Convex receipt committed. This is intentionally
 * independent of the autopilot gate: it cannot admit new work, and it must
 * preserve a frozen same-run invocation that was already allowed to spend.
 */
export async function dispatchDueSerializedProgramEpisodeRetries(input?: {
  ownerId?: string;
  now?: number;
  dispatchContext?: Pick<PipelineWorkerDeployment, "projectId" | "environmentId">;
}): Promise<{ due: number; triggered: number }> {
  // Delivery needs only deployed Convex/Trigger credentials, not generation providers.
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  const ownerId = input?.ownerId ?? process.env.STUDIO_OWNER_ID ?? "owner_daniel";
  const now = input?.now ?? Date.now();
  const convex = new ConvexHttpClient(url, { requestTimeoutMs: 30_000 });
  const due = (await convex.query(api.runs.listDueSerializedProgramEpisodeRetries, {
    ownerId,
    now,
  })) as DueRetryReceipt[];

  let triggered = 0;
  const dispatch = async (receipt: DueRetryReceipt) => {
    const deploymentOptions = pipelineWorkerDeploymentDispatchOptions(receipt.workerDeployment);
    if (receipt.workerDeployment) {
      if (!input?.dispatchContext) throw new Error("bound serialized resume requires verified dispatch project/environment");
      assertPipelineWorkerDeployment(receipt.workerDeployment, { ...input.dispatchContext, version: receipt.workerDeployment.version });
    }
    const payload: RunPipelineInput = {
      channelId: receipt.channelId,
      runId: receipt.runId,
      invocationSha256: receipt.invocationSha256,
      ...(receipt.scheduledPlan ? { scheduledPlan: receipt.scheduledPlan } : {}),
    };
    const request = serializedProgramEpisodeBusyRetrySchedule({
      payload,
      channelId: receipt.channelId,
      runId: receipt.runId,
      retryAt: receipt.retryAt,
      attempt: receipt.attempt,
    });
    // Original task, early task, and this outbox dispatcher are different
    // Trigger parents. The durable receipt itself is therefore global, not
    // run-scoped, idempotency.
    const idempotencyKey = await idempotencyKeys.create(request.idempotencySeed, {
      scope: "global",
    });
    await tasks.trigger("run-pipeline", request.payload, {
      ...deploymentOptions,
      // Mirror the original durable enqueue's not-before fence. Even a clock
      // edge must never let this global receipt complete successfully early.
      delay: new Date(request.retryAt),
      concurrencyKey: request.concurrencyKey,
      idempotencyKey,
    }, { retry: { maxAttempts: 1 } });
    triggered++;
  };
  const batch = due.slice(0, SERIALIZED_PROGRAM_EPISODE_RETRY_DISPATCH_LIMIT);
  let next = 0;
  const failures: unknown[] = [];
  // A bad receipt cannot starve other channels. Bound active delivery calls,
  // and settle all started work before reporting failure to the scheduler.
  await Promise.all(Array.from({ length: Math.min(batch.length, SERIALIZED_PROGRAM_EPISODE_RETRY_CONCURRENCY) }, async () => {
    while (next < batch.length) {
      const receipt = batch[next++];
      try { await dispatch(receipt); }
      catch (error) { failures.push(error); }
    }
  }));
  if (failures.length) throw failures[0];
  return { due: due.length, triggered };
}

export const serializedProgramEpisodeRetryDispatcher = schedules.task({
  id: "serialized-program-episode-retry-dispatcher",
  // A durable outbox retry must recover well before the queued-run lease can
  // expire. This performs only one indexed Convex read when no receipt exists.
  ...(deliveryRecoveryMode() === "individual" ? { cron: "* * * * *" } : {}),
  run: async (_payload, options) => {
    if (deliveryRecoveryMode() !== "individual") return { skipped: "shared-delivery-recovery" };
    return dispatchDueSerializedProgramEpisodeRetries({
      dispatchContext: options?.ctx ? { projectId: options.ctx.project.id, environmentId: options.ctx.environment.id } : undefined,
    });
  },
});
