import { task } from "@trigger.dev/sdk";
import { deliveryRecoveryMode } from "@/lib/deliveryRecoveryMode";
import { armDeliveryRecoveryWatchdog } from "@/lib/deliveryRecoveryWatchdog";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import { dispatchDueBundleFanouts } from "./bundleFanoutDispatcher";
import { dispatchPendingFactualReviewContinuations } from "./factualReviewContinuationDispatcher";
import { dispatchPendingMusicAuditionContinuations } from "./musicAuditionContinuationDispatcher";
import { dispatchPendingReviewedDataStoryInitialRuns } from "./reviewedDataStoryInitialDispatcher";
import { dispatchPendingRouteQualificationBenchmarks } from "./routeQualificationBenchmarkDispatcher";
import { dispatchDueSerializedProgramEpisodeRetries } from "./serializedProgramEpisodeRetryDispatcher";
import { dispatchPendingThumbnailRefreshCandidates } from "./thumbnailRefreshCandidate";
import { dispatchAutomaticThumbnailReplacements } from "./automaticThumbnailReplacementCore";
import { dispatchDuePublishIntents } from "./publishScheduler";

const recoveryMode = deliveryRecoveryMode();

export const sharedDeliveryRecovery = task({
  id: "shared-delivery-recovery",
  // Inherit the project ceiling, as serialized recovery did before consolidation.
  // A shorter aggregate deadline could terminate still-valid delivery batches.
  retry: { maxAttempts: 1 },
  run: async (payload: { ownerId?: string } = {}, options) => {
    if (recoveryMode !== "shared") return { skipped: "individual-delivery-recovery" };
    if (payload.ownerId) {
      const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
      if (!url) throw new Error("shared delivery recovery: Convex URL is unavailable");
      const active = await new StudioConvexHttpClient(url).query(api.runs.listActive, { ownerId: payload.ownerId });
      if (active.length) await armDeliveryRecoveryWatchdog(payload.ownerId);
    }
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
      ["thumbnail-refresh", () => dispatchPendingThumbnailRefreshCandidates()],
      ["thumbnail-replacement", () => dispatchAutomaticThumbnailReplacements()],
      ["publish-intent", () => dispatchDuePublishIntents()],
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
