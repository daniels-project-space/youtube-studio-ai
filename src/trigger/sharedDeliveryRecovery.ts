import { schedules } from "@trigger.dev/sdk";
import { deliveryRecoveryMode } from "@/lib/deliveryRecoveryMode";
import { dispatchDueBundleFanouts } from "./bundleFanoutDispatcher";
import { dispatchPendingFactualReviewContinuations } from "./factualReviewContinuationDispatcher";
import { dispatchPendingMusicAuditionContinuations } from "./musicAuditionContinuationDispatcher";
import { dispatchPendingReviewedDataStoryInitialRuns } from "./reviewedDataStoryInitialDispatcher";
import { dispatchPendingRouteQualificationBenchmarks } from "./routeQualificationBenchmarkDispatcher";
import { dispatchDueSerializedProgramEpisodeRetries } from "./serializedProgramEpisodeRetryDispatcher";

export const sharedDeliveryRecovery = schedules.task({
  id: "shared-delivery-recovery",
  ...(deliveryRecoveryMode() === "shared" ? { cron: "* * * * *" } : {}),
  maxDuration: 120,
  retry: { maxAttempts: 1 },
  run: async (_payload, options) => {
    if (deliveryRecoveryMode() !== "shared") return { skipped: "individual-delivery-recovery" };
    const dispatchContext = options?.ctx
      ? { projectId: options.ctx.project.id, environmentId: options.ctx.environment.id }
      : undefined;
    const deliveries = [
      ["bundle", () => dispatchDueBundleFanouts()],
      ["factual", () => dispatchPendingFactualReviewContinuations({ dispatchContext })],
      ["music", () => dispatchPendingMusicAuditionContinuations({ dispatchContext })],
      ["reviewed-data-story", () => dispatchPendingReviewedDataStoryInitialRuns()],
      ["route-qualification", () => dispatchPendingRouteQualificationBenchmarks()],
      ["serialized-episode", () => dispatchDueSerializedProgramEpisodeRetries({ dispatchContext })],
    ] as const;
    // A rejected delivery must not prevent another outbox from being serviced.
    // Invoke directly: spawning six child tasks would retain the idle start cost.
    const outcomes = await Promise.allSettled(deliveries.map(async ([, dispatch]) => dispatch()));
    const failed = outcomes.flatMap((outcome, index) => outcome.status === "rejected" ? [deliveries[index][0]] : []);
    if (failed.length) {
      // Avoid copying arbitrary provider/transport error bodies into the aggregate error.
      throw new Error(`Delivery recovery failed for: ${failed.join(", ")}`);
    }
    return Object.fromEntries(outcomes.map((outcome, index) => [
      deliveries[index][0], outcome.status === "fulfilled" ? outcome.value : null,
    ]));
  },
});
