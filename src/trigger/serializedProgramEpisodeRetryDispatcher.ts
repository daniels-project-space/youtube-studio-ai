import { idempotencyKeys, schedules, tasks } from "@trigger.dev/sdk";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import {
  serializedProgramEpisodeBusyRetrySchedule,
} from "@/lib/serializedProgramEpisode";
import { bootstrapSecrets } from "@/lib/bootstrap";
import type { ScheduledPlanRunPayload } from "@/lib/scheduledPlanRuntime";
import type { RunPipelineInput } from "./runPipeline";

const SERIALIZED_PROGRAM_EPISODE_RETRY_DISPATCH_LIMIT = 50;

type DueRetryReceipt = {
  runId: string;
  channelId: string;
  invocationSha256: string;
  retryAt: number;
  attempt: number;
  scheduledPlan?: ScheduledPlanRunPayload;
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
}): Promise<{ due: number; triggered: number }> {
  await bootstrapSecrets((message) =>
    console.log(`[serialized-program-episode-retry-dispatcher] ${message}`),
  );
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  const ownerId = input?.ownerId ?? process.env.STUDIO_OWNER_ID ?? "owner_daniel";
  const now = input?.now ?? Date.now();
  const convex = new ConvexHttpClient(url);
  const due = (await convex.query(api.runs.listDueSerializedProgramEpisodeRetries, {
    ownerId,
    now,
  })) as DueRetryReceipt[];

  let triggered = 0;
  for (const receipt of due.slice(0, SERIALIZED_PROGRAM_EPISODE_RETRY_DISPATCH_LIMIT)) {
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
      // Mirror the original durable enqueue's not-before fence. Even a clock
      // edge must never let this global receipt complete successfully early.
      delay: new Date(request.retryAt),
      concurrencyKey: request.concurrencyKey,
      idempotencyKey,
    });
    triggered++;
  }
  return { due: due.length, triggered };
}

export const serializedProgramEpisodeRetryDispatcher = schedules.task({
  id: "serialized-program-episode-retry-dispatcher",
  // A durable outbox retry must recover well before the queued-run lease can
  // expire. This performs only one indexed Convex read when no receipt exists.
  cron: "* * * * *",
  run: async () => dispatchDueSerializedProgramEpisodeRetries(),
});
