/**
 * Retired legacy Trigger task.
 *
 * It remains registered solely so jobs accepted by an older deployment finish
 * safely after this deployment is active.  It deliberately has no Browserbase,
 * Stagehand, model, OAuth, or Convex side effects.  New creation requests must
 * use `youtube-create-channel`, which has the approval/claim boundary.
 */
import { task } from "@trigger.dev/sdk";

export interface ProvisionYoutubeArgs {
  /** Retained only so queued jobs from older deployments can be decoded. */
  appChannelId: string;
  /** Retained only so queued jobs from older deployments can be decoded. */
  name: string;
}

export const provisionYoutubeTask = task({
  id: "provision-youtube",
  maxDuration: 60,
  retry: { maxAttempts: 1 },
  run: async (_payload: ProvisionYoutubeArgs) => {
    void _payload;
    console.warn("[yt-provision] rejected retired legacy task");
    return {
      ok: false,
      retired: true,
      nonRetryable: true,
      error: "Legacy YouTube provisioning is retired. Use the approved youtube-create-channel flow.",
    };
  },
});
