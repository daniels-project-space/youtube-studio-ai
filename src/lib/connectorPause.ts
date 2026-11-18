import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";

/** Connector changes remain effective even if a locked channel cannot be paused. */
export async function pauseAfterConnectorChange(client: StudioConvexHttpClient, channelId: Id<"channels">, ownerId: string): Promise<boolean> {
  try { await client.mutation(api.channels.updateChannel, { channelId, status: "paused" }); } catch { /* Read back after an uncertain write. */ }
  try {
    const channel = await client.query(api.channels.getChannel, { channelId });
    return channel?.ownerId === ownerId && channel.status === "paused";
  } catch { return false; }
}
