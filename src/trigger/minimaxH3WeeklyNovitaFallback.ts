/** Tombstone for queued legacy jobs. The direct fallback cannot spend again. */
import { task } from "@trigger.dev/sdk";
import { assertMiniMaxH3WeeklyBatchArgs, type MiniMaxH3WeeklyBatchArgs } from "./minimaxH3WeeklyBatch";

export const minimaxH3WeeklyNovitaFallbackTask = task({
  id: "minimax-h3-weekly-novita-fallback",
  maxDuration: 120,
  retry: { maxAttempts: 1 },
  run: async (rawPayload: MiniMaxH3WeeklyBatchArgs) => {
    const payload = assertMiniMaxH3WeeklyBatchArgs(rawPayload);
    throw new Error(`MiniMax H3 weekly order ${payload.orderKey} requires Render Engine reconciliation`);
  },
});
