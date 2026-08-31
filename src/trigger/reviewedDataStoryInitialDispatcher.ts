import { schedules, tasks, idempotencyKeys } from "@trigger.dev/sdk";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { reviewedDataStoryInitialDispatchSchedule } from "@/lib/reviewedDataStoryInitialDispatch";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";

const REVIEWED_DATA_STORY_INITIAL_DISPATCH_LIMIT = 25;

type PendingReviewedDataStoryInitialDispatch = {
  readonly runId: Id<"runs">;
  readonly channelId: Id<"channels">;
  readonly selector: { readonly packId: Id<"reviewedEvidencePacks">; readonly contentFingerprint: string };
  readonly admissionFingerprint: string;
  readonly attempt: number;
};

const reviewedDataStoryRunAdmissionsApi = (api as unknown as {
  readonly reviewedDataStoryRunAdmissions: {
    readonly listPending: never;
    readonly markQueued: never;
    readonly recordEnqueueFailure: never;
    readonly reapExpiredQueued: never;
  };
}).reviewedDataStoryRunAdmissions;

/**
 * Replays only server-created, immutable first-run admissions. It is an
 * indexed outbox scan; it never creates a source ledger, calls a provider, or
 * consults a content calendar.
 */
export async function dispatchPendingReviewedDataStoryInitialRuns(input?: {
  readonly ownerId?: string;
  readonly convex?: ConvexHttpClient;
  readonly log?: (message: string) => void;
}): Promise<{ readonly pending: number; readonly triggered: number }> {
  const ownerId = input?.ownerId ?? process.env.STUDIO_OWNER_ID ?? "owner_daniel";
  const log = input?.log ?? ((message: string) => console.log(`[reviewed-data-story-initial-dispatcher] ${message}`));
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url && !input?.convex) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  const convex = input?.convex ?? new ConvexHttpClient(url!);
  const recovery = await convex.mutation(reviewedDataStoryRunAdmissionsApi.reapExpiredQueued, {
    ownerId,
    now: Date.now(),
    limit: REVIEWED_DATA_STORY_INITIAL_DISPATCH_LIMIT,
  } as never) as unknown as { checked: number; requeued: number; blocked: number };
  if (recovery.requeued || recovery.blocked) {
    log(`reviewed data-story queued delivery recovery: ${recovery.requeued} reissued, ${recovery.blocked} manual-blocked`);
  }
  const pending = await convex.query(reviewedDataStoryRunAdmissionsApi.listPending, {
    ownerId,
    limit: REVIEWED_DATA_STORY_INITIAL_DISPATCH_LIMIT,
  } as never) as unknown as PendingReviewedDataStoryInitialDispatch[];
  let triggered = 0;
  for (const receipt of pending.slice(0, REVIEWED_DATA_STORY_INITIAL_DISPATCH_LIMIT)) {
    const request = reviewedDataStoryInitialDispatchSchedule(
      {
        channelId: String(receipt.channelId),
        runId: String(receipt.runId),
        reviewedEvidencePackSelector: {
          packId: String(receipt.selector.packId),
          contentFingerprint: receipt.selector.contentFingerprint,
        },
        reviewedDataStoryInitialAdmission: {
          admissionFingerprint: receipt.admissionFingerprint,
        },
      },
      { deliveryAttempt: receipt.attempt + 1 },
    );
    try {
      const idempotencyKey = await idempotencyKeys.create(request.idempotencySeed, { scope: "global" });
      const task = await tasks.trigger("run-pipeline", request.payload, {
        concurrencyKey: request.concurrencyKey,
        idempotencyKey,
      });
      const triggerRunId = typeof (task as { id?: unknown }).id === "string"
        ? (task as { id: string }).id
        : request.idempotencySeed;
      try {
        await convex.mutation(reviewedDataStoryRunAdmissionsApi.markQueued, {
          ownerId,
          channelId: receipt.channelId,
          runId: receipt.runId,
          admissionFingerprint: receipt.admissionFingerprint,
          triggerRunId,
          queuedAt: Date.now(),
        } as never);
        triggered++;
        log(`queued reviewed data-story initial run ${receipt.runId} (${triggerRunId})`);
      } catch (error) {
        log(
          `reviewed data-story initial dispatch acknowledgement pending for ${receipt.runId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await convex.mutation(reviewedDataStoryRunAdmissionsApi.recordEnqueueFailure, {
          ownerId,
          channelId: receipt.channelId,
          runId: receipt.runId,
          admissionFingerprint: receipt.admissionFingerprint,
          error: message,
          failedAt: Date.now(),
        } as never);
      } catch (stateError) {
        log(
          `reviewed data-story initial dispatch failure state write failed for ${receipt.runId}: ` +
          `${stateError instanceof Error ? stateError.message : String(stateError)}`,
        );
      }
      log(`reviewed data-story initial dispatch enqueue failed for ${receipt.runId}: ${message}`);
    }
  }
  return { pending: pending.length, triggered };
}

export const reviewedDataStoryInitialDispatcher = schedules.task({
  id: "reviewed-data-story-initial-dispatcher",
  // This provider-free minute scanner is the only component that turns an
  // owner-created immutable admission into a Trigger delivery.
  cron: "* * * * *",
  maxDuration: 120,
  retry: { maxAttempts: 1 },
  run: async () => dispatchPendingReviewedDataStoryInitialRuns(),
});
