import { tasks } from "@trigger.dev/sdk";
import {
  publishPipelineResumeTriggerRequest,
  publishRetryTriggerRequest,
  type DurablePipelineRunForPublishResume,
  type PublishPipelineResumeTriggerRequest,
  type PublishRetryTriggerRequest,
  type RetryablePublishIntent,
  type UploadedPublishIntentForPipelineResume,
} from "@/lib/publishRetrySchedule";

export type PublishRetryTrigger = (
  taskId: PublishRetryTriggerRequest["taskId"],
  payload: PublishRetryTriggerRequest["payload"],
  options: PublishRetryTriggerRequest["options"],
) => Promise<{ id: string }>;

export type PublishPipelineResumeTrigger = (
  taskId: PublishPipelineResumeTriggerRequest["taskId"],
  payload: PublishPipelineResumeTriggerRequest["payload"],
  options: PublishPipelineResumeTriggerRequest["options"],
) => Promise<{ id: string }>;

export async function enqueuePublishIntentRetry(
  intent: RetryablePublishIntent,
  trigger: PublishRetryTrigger = async (taskId, payload, options) =>
    await tasks.trigger(taskId, payload, options),
): Promise<{ runId: string; scheduledFor: number; idempotencyKey: string } | undefined> {
  const request = publishRetryTriggerRequest(intent);
  if (!request) return undefined;
  const handle = await trigger(
    request.taskId,
    request.payload,
    request.options,
  );
  return {
    runId: handle.id,
    scheduledFor: request.options.delay.getTime(),
    idempotencyKey: request.options.idempotencyKey,
  };
}

export async function enqueueFailedPipelineResume(
  intent: UploadedPublishIntentForPipelineResume,
  run: DurablePipelineRunForPublishResume | null | undefined,
  trigger: PublishPipelineResumeTrigger = async (taskId, payload, options) =>
    await tasks.trigger(taskId, payload, options),
): Promise<{ runId: string; idempotencyKey: string } | undefined> {
  const request = publishPipelineResumeTriggerRequest(intent, run);
  if (!request) return undefined;
  const handle = await trigger(
    request.taskId,
    request.payload,
    request.options,
  );
  return {
    runId: handle.id,
    idempotencyKey: request.options.idempotencyKey,
  };
}
