/**
 * Retired Trigger identifier retained solely so already-discovered task names
 * fail safely. Channel creation must use the signed `design-channel` workflow.
 */
import { task } from "@trigger.dev/sdk";

export interface BuildChannelArgs {
  seed: string;
  ownerId?: string;
  budget?: number;
}

export const LEGACY_CHANNEL_PACKAGE_RETIRED =
  "build-channel-package is retired: seed-only creation bypasses the signed modular Channel Inception contract; submit a structured design to design-channel.";

export const buildChannelPackageTask = task({
  id: "build-channel-package",
  maxDuration: 60,
  run: async (_payload: BuildChannelArgs) => {
    void _payload;
    // Deliberately the first action: no secrets, database, model, or renderer
    // is initialized for a stale/discovered legacy task invocation.
    throw new Error(LEGACY_CHANNEL_PACKAGE_RETIRED);
  },
});
