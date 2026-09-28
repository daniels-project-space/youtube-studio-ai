/** Tombstone for historical interactive H3 task IDs. It cannot start a provider or spend. */
import { task } from "@trigger.dev/sdk";

export const minimaxH3OnDemandTask = task({
  id: "minimax-h3-on-demand",
  maxDuration: 60,
  retry: { maxAttempts: 1 },
  run: async () => {
    throw new Error("MiniMax H3 on-demand rendering requires a qualified Render Engine workflow");
  },
});
