/**
 * Retired channel-art backfill task.
 *
 * Channel art may now be generated only from an admitted stage that supplies
 * both an aggregate provider envelope and durable lifecycle. This legacy task
 * accepted only a channel id, so it could not prove either condition.
 */
import { task } from "@trigger.dev/sdk";

export interface ChannelArtArgs {
  channelId: string;
}

const RETIRED_REASON =
  "generate-channel-art is retired: a channel id alone is not a signed provider budget or lifecycle. Use the admitted channel-inception art stages instead.";

export const generateChannelArtTask = task({
  id: "generate-channel-art",
  maxDuration: 600,
  run: async (_payload: ChannelArtArgs) => {
    void _payload;
    throw new Error(RETIRED_REASON);
  },
});
