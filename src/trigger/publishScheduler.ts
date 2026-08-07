import { schedules, task, tasks } from "@trigger.dev/sdk";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { dispatchPublishIntent } from "@/lib/publishDispatcher";
import { requireInternalQuerySecret } from "@/lib/youtubeConnector";

function convexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

export const dispatchPublishIntentTask = task({
  id: "dispatch-publish-intent",
  maxDuration: 28_800,
  // Provider failures persist retry_wait and enqueue a delayed successor. These
  // short retries only recover a failed Trigger enqueue; claim/not_due then
  // deduplicates the same delayed successor without another provider call.
  retry: { maxAttempts: 3, minTimeoutInMs: 5_000, maxTimeoutInMs: 30_000, factor: 2 },
  queue: { concurrencyLimit: 3 },
  run: async (payload: { intentId: string }) => {
    const workerId = `trigger:${payload.intentId}:${Date.now()}`;
    return await dispatchPublishIntent({
      intentId: payload.intentId as Id<"publishIntents">,
      workerId,
      log: (message) => console.log(`[publisher] ${message}`),
    });
  },
});

export const publishIntentScheduler = schedules.task({
  id: "publish-intent-scheduler",
  // Deliberately manual until the operator explicitly enables autonomous live
  // publishing. Add `cron: "*/5 * * * *"` only at that transition.
  run: async () => {
    await bootstrapSecrets((message) => console.log(`[publisher-scheduler] ${message}`));
    if ((process.env.STUDIO_AUTOPILOT ?? "").toLowerCase() === "off") {
      return { triggered: 0, disabled: true };
    }
    const convex = convexClient();
    const due = await convex.query(api.publishIntents.listDue, {
      secret: requireInternalQuerySecret(),
      now: Date.now(),
      limit: 100,
    });
    let triggered = 0;
    for (const intent of due) {
      await tasks.trigger(
        "dispatch-publish-intent",
        { intentId: String(intent._id) },
        { concurrencyKey: `publish:${String(intent.channelId)}` },
      );
      triggered++;
    }
    return { triggered, due: due.length, disabled: false };
  },
});
