import { idempotencyKeys, schedules, tasks } from "@trigger.dev/sdk";
import { deliveryRecoveryMode } from "@/lib/deliveryRecoveryMode";
import { dispatchPendingYuE2Continuations, type YuE2ContinuationReceipt } from "./yue2ContinuationDispatcher";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { musicAuditionResumeSchedule } from "@/lib/musicAuditionResume";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { assertPipelineWorkerDeployment, pipelineWorkerDeploymentDispatchOptions, type PipelineWorkerDeployment } from "@/lib/pipelineWorkerDeployment";

const MUSIC_AUDITION_CONTINUATION_LIMIT = 25;

type PendingMusicAuditionResume = {
  runId: string; channelId: string; invocationSha256: string; checkpointId: string;
  checkpointFingerprint: string; qualityReceiptFingerprint: string; approvalFingerprint: string; attempt: number;
  workerDeployment?: PipelineWorkerDeployment;
};

const musicAuditionCheckpointsApi = (api as unknown as {
  readonly musicAuditionCheckpoints: {
    readonly prepareResumeDispatch: never;
    readonly markResumeQueued: never; readonly recordResumeEnqueueFailure: never;
  };
}).musicAuditionCheckpoints;

/** Delivers exactly one already owner-approved native-audio receipt. It never
 * generates, edits, or substitutes audio; it only hands the immutable receipt
 * to the normal run worker and records its bounded delivery state. */
export async function dispatchPendingMusicAuditionContinuations(input?: {
  ownerId?: string; convex?: ConvexHttpClient; log?: (message: string) => void;
  dispatchContext?: Pick<PipelineWorkerDeployment, "projectId" | "environmentId">;
}): Promise<{ pending: number; triggered: number }> {
  const ownerId = input?.ownerId ?? process.env.STUDIO_OWNER_ID ?? "owner_daniel";
  const log = input?.log ?? (message => console.log(`[music-audition-continuation-dispatcher] ${message}`));
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url && !input?.convex) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  const convex = input?.convex ?? new ConvexHttpClient(url!);
  const { recovery, pending, yue2Pending } = await convex.mutation(musicAuditionCheckpointsApi.prepareResumeDispatch, {
    ownerId, now: Date.now(), limit: MUSIC_AUDITION_CONTINUATION_LIMIT, includeYuE2: true,
  } as never) as unknown as { recovery: { requeued: number; blocked: number }; pending: PendingMusicAuditionResume[]; yue2Pending: YuE2ContinuationReceipt[] };
  if (!Array.isArray(yue2Pending) || yue2Pending.length > 25) throw new Error("Music recovery lacks bounded YuE2 preparation evidence");
  if (recovery.requeued || recovery.blocked) log(`music-audition queued delivery recovery: ${recovery.requeued} reissued, ${recovery.blocked} manual-blocked`);
  let triggered = 0;
  for (const receipt of pending.slice(0, MUSIC_AUDITION_CONTINUATION_LIMIT)) {
    const request = musicAuditionResumeSchedule({
      channelId: receipt.channelId, runId: receipt.runId, invocationSha256: receipt.invocationSha256,
      musicAuditionResume: {
        checkpointId: receipt.checkpointId, checkpointFingerprint: receipt.checkpointFingerprint,
        qualityReceiptFingerprint: receipt.qualityReceiptFingerprint, approvalFingerprint: receipt.approvalFingerprint,
        invocationSha256: receipt.invocationSha256,
      },
    }, { deliveryAttempt: receipt.attempt + 1 });
    try {
      const deploymentOptions = pipelineWorkerDeploymentDispatchOptions(receipt.workerDeployment);
      if (receipt.workerDeployment) {
        if (!input?.dispatchContext) throw new Error("bound music resume requires verified dispatch project/environment");
        assertPipelineWorkerDeployment(receipt.workerDeployment, { ...input.dispatchContext, version: receipt.workerDeployment.version });
      }
      const idempotencyKey = await idempotencyKeys.create(request.idempotencySeed, { scope: "global" });
      const triggeredRun = await tasks.trigger("run-pipeline", request.payload, { ...deploymentOptions, concurrencyKey: request.concurrencyKey, idempotencyKey });
      const triggerRunId = typeof (triggeredRun as { id?: unknown }).id === "string"
        ? (triggeredRun as { id: string }).id : request.idempotencySeed;
      try {
        await convex.mutation(musicAuditionCheckpointsApi.markResumeQueued, {
          ownerId, channelId: receipt.channelId as Id<"channels">, runId: receipt.runId as Id<"runs">,
          checkpointId: receipt.checkpointId as Id<"musicAuditionCheckpoints">,
          checkpointFingerprint: receipt.checkpointFingerprint, qualityReceiptFingerprint: receipt.qualityReceiptFingerprint,
          approvalFingerprint: receipt.approvalFingerprint, triggerRunId, queuedAt: Date.now(),
        } as never);
        triggered++; log(`queued music-audition continuation ${receipt.runId} (${triggerRunId})`);
      } catch (stateError) {
        log(`music-audition acknowledgement pending for ${receipt.runId}: ${stateError instanceof Error ? stateError.message : String(stateError)}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await convex.mutation(musicAuditionCheckpointsApi.recordResumeEnqueueFailure, {
          ownerId, channelId: receipt.channelId as Id<"channels">, runId: receipt.runId as Id<"runs">,
          checkpointId: receipt.checkpointId as Id<"musicAuditionCheckpoints">,
          checkpointFingerprint: receipt.checkpointFingerprint, qualityReceiptFingerprint: receipt.qualityReceiptFingerprint,
          approvalFingerprint: receipt.approvalFingerprint, error: message, failedAt: Date.now(),
        } as never);
      } catch (stateError) {
        log(`music-audition failure state write failed for ${receipt.runId}: ${stateError instanceof Error ? stateError.message : String(stateError)}`);
      }
      log(`music-audition continuation enqueue failed for ${receipt.runId}: ${message}`);
    }
  }
  const yue2 = await dispatchPendingYuE2Continuations({ ownerId, convex, log, dispatchContext: input?.dispatchContext, preparedReceipts: yue2Pending });
  return { pending: pending.length + yue2.pending, triggered: triggered + yue2.triggered };
}

export const musicAuditionContinuationDispatcher = schedules.task({
  id: "music-audition-continuation-dispatcher",
  ...(deliveryRecoveryMode() === "individual" ? { cron: "* * * * *" } : {}),
  maxDuration: 120, retry: { maxAttempts: 1 },
  run: async (_payload, options) => {
    if (deliveryRecoveryMode() !== "individual") return { skipped: "shared-delivery-recovery" };
    return dispatchPendingMusicAuditionContinuations({
      dispatchContext: options?.ctx ? { projectId: options.ctx.project.id, environmentId: options.ctx.environment.id } : undefined,
    });
  },
});
