import { task } from "@trigger.dev/sdk";
import type { MiniMaxH3WeeklyBatchArgs } from "./minimaxH3WeeklyBatch";
import { rejectRetiredWeeklyH3Task } from "./legacyH3WeeklyRetirement";

// Preserve stale task identities while refusing every direct provider attempt.
export const minimaxH3WeeklyOpenRelayFallbackTask = task({
  id: "minimax-h3-weekly-openrelay-fallback",
  maxDuration: 3_600,
  retry: { maxAttempts: 1 },
  queue: { concurrencyLimit: 1 },
  run: async (_rawPayload: MiniMaxH3WeeklyBatchArgs) => {
    void _rawPayload;
    return rejectRetiredWeeklyH3Task();
  },
});
