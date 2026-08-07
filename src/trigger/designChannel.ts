/**
 * Real channel creation entrypoint. The implementation is split into typed,
 * resumable Channel Inception modules in `designChannelInception.ts`; this task
 * owns Trigger retry identity only.
 */
import { task } from "@trigger.dev/sdk";
import {
  executeDesignChannel,
  type DesignChannelArgs,
} from "@/trigger/designChannelInception";

export type { DesignChannelArgs } from "@/trigger/designChannelInception";

export const designChannelTask = task({
  id: "design-channel",
  maxDuration: 3600,
  // Stage leases, checkpoints and content-addressed keys make automatic retry
  // safe. The previous no-retry policy left interrupted channels unrecoverable.
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 10_000,
    maxTimeoutInMs: 120_000,
    factor: 2,
  },
  run: async (payload: DesignChannelArgs, { ctx }) =>
    executeDesignChannel(payload, {
      runId: ctx.run.id,
      attempt: ctx.attempt.number,
    }),
});
