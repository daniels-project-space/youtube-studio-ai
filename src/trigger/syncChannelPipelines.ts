import { task } from "@trigger.dev/sdk";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { syncChannelPipelines } from "@/lib/goldenChannelSync";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";

async function runSync(ownerId: string, dryRun: boolean) {
  await bootstrapSecrets((message) => console.log(`[channel-pipeline-sync] ${message}`));
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");

  return syncChannelPipelines({
    convex: new StudioConvexHttpClient(url),
    ownerId,
    dryRun,
    log: (message) => console.log(`[channel-pipeline-sync] ${message}`),
  });
}

/**
 * Lightweight, provider-free migration task. It performs no renders, model
 * calls, publishing, or asset writes; only validated channel.pipeline patches.
 */
export const syncChannelPipelinesTask = task({
  id: "sync-channel-pipelines",
  maxDuration: 300,
  run: async (payload: { ownerId?: string; dryRun?: boolean }) =>
    runSync(
      payload.ownerId ?? process.env.STUDIO_OWNER_ID ?? "owner_daniel",
      payload.dryRun === true,
    ),
});
