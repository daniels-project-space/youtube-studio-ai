import {
  normalizeScheduledPlanPayload,
  type ScheduledPlanRunPayload,
} from "@/lib/scheduledPlanRuntime";
import { assertPlanWeekPreparationPointer } from "@/lib/planWeekPreparation";
import {
  normalizePipelineInvocationSnapshot,
  type PipelineInvocationSnapshot,
} from "@/lib/pipelineInvocationSnapshot";
import { pipelineInvocationSha256 as hashPipelineInvocation } from "@/lib/pipelineInvocationHash";

export const PUBLISH_DISPATCH_TASK_ID = "dispatch-publish-intent" as const;
export const RUN_PIPELINE_TASK_ID = "run-pipeline" as const;
export const PUBLISH_RETRY_IDEMPOTENCY_TTL = "30d" as const;
// A post-upload pipeline resume is safe only while it is tied to the exact
// immutable uploaded intent. Keep the durable delivery budget deliberately
// short: a receipt that cannot start twice needs an operator, not another
// unbounded Trigger loop.
export const MAX_PUBLISH_CONTINUATION_ENQUEUE_ATTEMPTS = 2;

export interface RetryablePublishIntent {
  _id: string;
  channelId: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: number;
}

export interface PublishRetryTriggerRequest {
  taskId: typeof PUBLISH_DISPATCH_TASK_ID;
  payload: { intentId: string };
  options: {
    delay: Date;
    idempotencyKey: string;
    idempotencyKeyTTL: typeof PUBLISH_RETRY_IDEMPOTENCY_TTL;
    concurrencyKey: string;
  };
}

export interface UploadedPublishIntentForPipelineResume {
  _id: string;
  ownerId: string;
  channelId: string;
  runId?: string;
  status: string;
  videoArtifactId: string;
  youtubeVideoId?: string;
}

export interface DurablePipelineRunForPublishResume {
  _id: string;
  ownerId: string;
  channelId: string;
  status: string;
  youtubeVideoId?: string;
  planItemId?: string;
  plannedTopic?: string;
  plannedTitle?: string;
  plannedThumbnailKey?: string;
  plannedPublishAt?: number;
  plannedPreparationVersion?: string;
  plannedPreparationManifestKey?: string;
  plannedPreparationManifestSha256?: string;
  pipelineInvocationSnapshot?: unknown;
  pipelineInvocationSha256?: string;
  blockedPublishIntentId?: string;
  blockedPublishArtifactId?: string;
  publishContinuationState?: string;
  publishContinuationIntentId?: string;
  publishContinuationArtifactId?: string;
  publishContinuationVideoId?: string;
  publishContinuationAttempts?: number;
}

export interface PublishPipelineResumeTriggerRequest {
  taskId: typeof RUN_PIPELINE_TASK_ID;
  payload: {
    channelId: string;
    runId: string;
    invocationSha256: string;
    publishResume: {
      intentId: string;
      videoArtifactId: string;
      youtubeVideoId: string;
    };
    scheduledPlan?: ScheduledPlanRunPayload;
  };
  options: {
    idempotencyKey: string;
    idempotencyKeyTTL: typeof PUBLISH_RETRY_IDEMPOTENCY_TTL;
    concurrencyKey: string;
  };
  enqueueAttempt: number;
}

/**
 * Select the immutable Trigger delivery key for a durable continuation
 * receipt. A queued receipt reuses its acknowledged delivery; a reaped
 * pending receipt moves forward exactly once. This means a late acknowledgement
 * from the older delivery can be recognized as stale without re-opening the
 * newer receipt.
 */
export function publishPipelineResumeEnqueueAttempt(
  run: Pick<
    DurablePipelineRunForPublishResume,
    "publishContinuationState" | "publishContinuationAttempts"
  >,
): number {
  const attempts = run.publishContinuationAttempts ?? 0;
  if (!Number.isSafeInteger(attempts) || attempts < 0) {
    throw new Error("failed pipeline run has an invalid publish continuation delivery count");
  }
  if (run.publishContinuationState === "queued") {
    if (attempts < 1) {
      throw new Error("queued failed pipeline run has an invalid publish continuation delivery count");
    }
    return attempts;
  }
  if (run.publishContinuationState !== "pending") {
    throw new Error("failed pipeline run is not pending a publish continuation delivery");
  }
  return attempts + 1;
}

/**
 * Build one globally-idempotent delayed run for the persisted ledger attempt.
 * A different provider attempt receives a different key because Convex first
 * increments attempts and then persists its exact nextAttemptAt.
 */
export function publishRetryTriggerRequest(
  intent: RetryablePublishIntent,
): PublishRetryTriggerRequest | undefined {
  if (intent.status !== "retry_wait" || intent.attempts >= intent.maxAttempts) {
    return undefined;
  }
  if (
    !intent._id ||
    !intent.channelId ||
    !Number.isInteger(intent.attempts) ||
    intent.attempts < 1 ||
    !Number.isInteger(intent.maxAttempts) ||
    intent.maxAttempts < 1 ||
    !Number.isSafeInteger(intent.nextAttemptAt) ||
    intent.nextAttemptAt < 0
  ) {
    throw new Error("invalid retryable publish intent timing");
  }
  const intentId = String(intent._id);
  const nextAttemptAt = intent.nextAttemptAt;
  return {
    taskId: PUBLISH_DISPATCH_TASK_ID,
    payload: { intentId },
    options: {
      delay: new Date(nextAttemptAt),
      idempotencyKey: `publish-retry:${intentId}:attempt:${intent.attempts}:at:${nextAttemptAt}`,
      idempotencyKeyTTL: PUBLISH_RETRY_IDEMPOTENCY_TTL,
      concurrencyKey: `publish:${String(intent.channelId)}`,
    },
  };
}

/**
 * Build the one post-upload continuation for a failed owning pipeline run.
 * The Trigger task performs the normal admission checks again; this preflight
 * prevents a forged intent/run relationship from entering that queue at all.
 */
export function publishPipelineResumeTriggerRequest(
  intent: UploadedPublishIntentForPipelineResume,
  run: DurablePipelineRunForPublishResume | null | undefined,
): PublishPipelineResumeTriggerRequest | undefined {
  if (intent.runId === undefined) return undefined;
  const intentId = intent._id.trim();
  const runId = intent.runId.trim();
  const channelId = intent.channelId.trim();
  const videoArtifactId = intent.videoArtifactId.trim();
  const videoId = intent.youtubeVideoId?.trim();
  if (
    intent.status !== "uploaded" ||
    !intentId ||
    !runId ||
    !channelId ||
    !intent.ownerId.trim() ||
    !/^sha256:[a-f0-9]{64}$/.test(videoArtifactId) ||
    !videoId
  ) {
    throw new Error("invalid uploaded publish intent pipeline link");
  }
  if (!run) throw new Error(`uploaded publish intent run not found: ${runId}`);
  if (
    String(run._id) !== runId ||
    run.ownerId !== intent.ownerId ||
    String(run.channelId) !== channelId
  ) {
    throw new Error("uploaded publish intent run ownership/channel mismatch");
  }
  if (run.youtubeVideoId !== undefined && run.youtubeVideoId !== videoId) {
    throw new Error("uploaded publish intent/run YouTube video mismatch");
  }
  if (run.status !== "failed") return undefined;
  // An exhausted receipt is intentionally terminal. A late dispatcher may
  // observe it, but it must not mint another provider task or overwrite the
  // manual-recovery evidence.
  if (run.publishContinuationState === "manual_recovery_required") return undefined;
  if (
    run.youtubeVideoId !== videoId ||
    run.blockedPublishIntentId !== intentId ||
    run.blockedPublishArtifactId !== videoArtifactId ||
    run.publishContinuationIntentId !== intentId ||
    run.publishContinuationArtifactId !== videoArtifactId ||
    run.publishContinuationVideoId !== videoId ||
    !["pending", "queued"].includes(run.publishContinuationState ?? "")
  ) {
    throw new Error("uploaded publish intent does not match the run continuation fence");
  }
  const enqueueAttempt = publishPipelineResumeEnqueueAttempt(run);
  if (enqueueAttempt > MAX_PUBLISH_CONTINUATION_ENQUEUE_ATTEMPTS) {
    throw new Error(
      `publish continuation exhausted ${MAX_PUBLISH_CONTINUATION_ENQUEUE_ATTEMPTS} bounded delivery attempts`,
    );
  }
  const invocationSha256 = run.pipelineInvocationSha256?.trim();
  if (
    !invocationSha256 ||
    !/^[a-f0-9]{64}$/.test(invocationSha256) ||
    run.pipelineInvocationSnapshot === undefined
  ) {
    throw new Error("failed pipeline run has no valid durable invocation snapshot hash");
  }
  const invocation = normalizePipelineInvocationSnapshot(
    run.pipelineInvocationSnapshot as PipelineInvocationSnapshot,
  );
  if (
    invocation.ownerId !== intent.ownerId ||
    invocation.runId !== runId ||
    invocation.channelId !== channelId ||
    hashPipelineInvocation(invocation) !== invocationSha256
  ) {
    throw new Error("failed pipeline run durable invocation snapshot identity/hash mismatch");
  }

  const hasPlanItem = run.planItemId !== undefined;
  const hasPlanSnapshot = [
    run.plannedTopic,
    run.plannedTitle,
    run.plannedThumbnailKey,
    run.plannedPublishAt,
    run.plannedPreparationVersion,
    run.plannedPreparationManifestKey,
    run.plannedPreparationManifestSha256,
  ].some((value) => value !== undefined);
  if (!hasPlanItem && hasPlanSnapshot) {
    throw new Error("failed pipeline run has a partial scheduled-plan snapshot");
  }
  const scheduledPlan = hasPlanItem
    ? normalizeScheduledPlanPayload({
        planItemId: String(run.planItemId),
        topic: run.plannedTopic ?? "",
        title: run.plannedTitle ?? "",
        thumbnailKey: run.plannedThumbnailKey ?? "",
        ...(run.plannedPublishAt !== undefined
          ? { scheduledAt: run.plannedPublishAt }
          : {}),
        ...(
          run.plannedPreparationVersion !== undefined ||
          run.plannedPreparationManifestKey !== undefined ||
          run.plannedPreparationManifestSha256 !== undefined
            ? {
                preparation: assertPlanWeekPreparationPointer({
                  version: run.plannedPreparationVersion,
                  manifestKey: run.plannedPreparationManifestKey,
                  manifestSha256: run.plannedPreparationManifestSha256,
                }),
              }
            : {}
        ),
      })
    : undefined;

  return {
    taskId: RUN_PIPELINE_TASK_ID,
    payload: {
      channelId,
      runId,
      invocationSha256,
      publishResume: {
        intentId,
        videoArtifactId,
        youtubeVideoId: videoId,
      },
      ...(scheduledPlan ? { scheduledPlan } : {}),
    },
    options: {
      idempotencyKey: `publish-resume:${intentId}:run:${runId}:snapshot:${invocationSha256}:video:${videoId}:attempt:${enqueueAttempt}`,
      idempotencyKeyTTL: PUBLISH_RETRY_IDEMPOTENCY_TTL,
      concurrencyKey: channelId,
    },
    enqueueAttempt,
  };
}
