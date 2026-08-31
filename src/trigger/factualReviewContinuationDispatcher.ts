import { idempotencyKeys, schedules, tasks } from "@trigger.dev/sdk";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { factualReviewResumeSchedule } from "@/lib/factualReviewResume";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";

const FACTUAL_REVIEW_CONTINUATION_LIMIT = 25;

type PendingFactualReviewResume = {
  runId: string;
  channelId: string;
  invocationSha256: string;
  checkpointId: string;
  checkpointFingerprint: string;
  approvalFingerprint: string;
  attempt: number;
  scheduledPlan?: {
    planItemId: string;
    topic: string;
    title: string;
    thumbnailKey: string;
    scheduledAt?: number;
  };
};

const factualReviewCheckpointsApi = (api as unknown as {
  readonly factualReviewCheckpoints: {
    readonly listPendingResumes: never;
    readonly reapExpiredQueuedResumes: never;
    readonly markResumeQueued: never;
    readonly recordResumeEnqueueFailure: never;
  };
}).factualReviewCheckpoints;

/**
 * Delivers only an already owner-approved immutable receipt. It performs no
 * browser/model/render work and is deliberately separate from Pipeline Doctor
 * so an approval does not wait for a daily diagnostics sweep.
 */
export async function dispatchPendingFactualReviewContinuations(input?: {
  ownerId?: string;
  convex?: ConvexHttpClient;
  log?: (message: string) => void;
}): Promise<{ pending: number; triggered: number }> {
  const ownerId = input?.ownerId ?? process.env.STUDIO_OWNER_ID ?? "owner_daniel";
  const log = input?.log ?? ((message: string) => console.log(`[factual-review-continuation-dispatcher] ${message}`));
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url && !input?.convex) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  const convex = input?.convex ?? new ConvexHttpClient(url!);
  const queuedRecovery = await convex.mutation(factualReviewCheckpointsApi.reapExpiredQueuedResumes, {
    ownerId,
    now: Date.now(),
    limit: FACTUAL_REVIEW_CONTINUATION_LIMIT,
  } as never) as unknown as { requeued: number; blocked: number };
  if (queuedRecovery.requeued > 0 || queuedRecovery.blocked > 0) {
    log(
      `factual-review queued delivery recovery: ${queuedRecovery.requeued} reissued, ${queuedRecovery.blocked} manual-blocked`,
    );
  }
  const pending = await convex.query(factualReviewCheckpointsApi.listPendingResumes, {
    ownerId,
    limit: FACTUAL_REVIEW_CONTINUATION_LIMIT,
  } as never) as unknown as PendingFactualReviewResume[];
  let triggered = 0;

  for (const receipt of pending.slice(0, FACTUAL_REVIEW_CONTINUATION_LIMIT)) {
    const request = factualReviewResumeSchedule(
      {
        channelId: receipt.channelId,
        runId: receipt.runId,
        invocationSha256: receipt.invocationSha256,
        factualReviewResume: {
          checkpointId: receipt.checkpointId,
          checkpointFingerprint: receipt.checkpointFingerprint,
          approvalFingerprint: receipt.approvalFingerprint,
          invocationSha256: receipt.invocationSha256,
        },
        ...(receipt.scheduledPlan ? { scheduledPlan: receipt.scheduledPlan } : {}),
      },
      { deliveryAttempt: receipt.attempt + 1 },
    );
    try {
      const idempotencyKey = await idempotencyKeys.create(request.idempotencySeed, { scope: "global" });
      const triggeredRun = await tasks.trigger("run-pipeline", request.payload, {
        concurrencyKey: request.concurrencyKey,
        idempotencyKey,
      });
      // Trigger may claim the run before this acknowledgement is persisted;
      // `markResumeQueued` treats its consumed state as idempotent rather than
      // launching another continuation on the next minute tick.
      const triggerRunId = typeof (triggeredRun as { id?: unknown }).id === "string"
        ? (triggeredRun as { id: string }).id
        : request.idempotencySeed;
      try {
        await convex.mutation(factualReviewCheckpointsApi.markResumeQueued, {
          ownerId,
          channelId: receipt.channelId as Id<"channels">,
          runId: receipt.runId as Id<"runs">,
          checkpointId: receipt.checkpointId as Id<"factualReviewCheckpoints">,
          checkpointFingerprint: receipt.checkpointFingerprint,
          approvalFingerprint: receipt.approvalFingerprint,
          triggerRunId,
          queuedAt: Date.now(),
        } as never);
        triggered++;
        log(`queued factual-review continuation ${receipt.runId} (${triggerRunId})`);
      } catch (stateError) {
        // The globally idempotent Trigger request was accepted; leave the
        // pending receipt in place for safe reconciliation, not a new run.
        log(
          `factual-review continuation acknowledgement pending for ${receipt.runId}: ${
            stateError instanceof Error ? stateError.message : String(stateError)
          }`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await convex.mutation(factualReviewCheckpointsApi.recordResumeEnqueueFailure, {
          ownerId,
          channelId: receipt.channelId as Id<"channels">,
          runId: receipt.runId as Id<"runs">,
          checkpointId: receipt.checkpointId as Id<"factualReviewCheckpoints">,
          checkpointFingerprint: receipt.checkpointFingerprint,
          approvalFingerprint: receipt.approvalFingerprint,
          error: message,
          failedAt: Date.now(),
        } as never);
      } catch (stateError) {
        log(
          `factual-review continuation failure state write failed for ${receipt.runId}: ${
            stateError instanceof Error ? stateError.message : String(stateError)
          }`,
        );
      }
      log(`factual-review continuation enqueue failed for ${receipt.runId}: ${message}`);
    }
  }
  return { pending: pending.length, triggered };
}

export const factualReviewContinuationDispatcher = schedules.task({
  id: "factual-review-continuation-dispatcher",
  // Empty ticks are an indexed owner-scoped outbox read. This does not admit
  // fresh work and does not call a model/browser/render provider.
  cron: "* * * * *",
  maxDuration: 120,
  retry: { maxAttempts: 1 },
  run: async () => dispatchPendingFactualReviewContinuations(),
});
