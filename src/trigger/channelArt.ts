/**
 * `generate-channel-art` — generate a channel's avatar + banner via Flux and
 * persist the R2 keys onto the channel identity. Callable for backfill and
 * reused by the package builder (Stage 2). Cheap (two Flux stills); not a video
 * render.
 */
import { task } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { generateChannelArt } from "@/lib/channelArt";

export interface ChannelArtArgs {
  channelId: string;
}

export const generateChannelArtTask = task({
  id: "generate-channel-art",
  maxDuration: 600,
  run: async (payload: ChannelArtArgs) => {
    const log = (m: string, x?: Record<string, unknown>) =>
      console.log(`[generate-channel-art] ${m}`, x ?? "");
    await bootstrapSecrets(log);

    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
    const convex = new ConvexHttpClient(url);

    const channelId = payload.channelId as Id<"channels">;
    const channel = await convex.query(api.channels.getChannel, { channelId });
    if (!channel) throw new Error(`channel not found: ${payload.channelId}`);

    const art = await generateChannelArt(
      channel.ownerId,
      channel.slug,
      {
        name: channel.name,
        persona: channel.identity?.persona,
        styleGrammar: channel.identity?.styleGrammar,
        palette: channel.identity?.palette,
        niche: channel.identity?.niche,
      },
      log,
    );

    await convex.mutation(api.channels.updateChannel, {
      channelId,
      identity: { ...channel.identity, ...art },
    });
    log("channel art persisted", { ...art });
    return { ok: true, ...art };
  },
});
