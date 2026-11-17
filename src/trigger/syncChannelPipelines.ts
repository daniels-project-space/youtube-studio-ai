import { task } from "@trigger.dev/sdk";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { syncChannelPipelines } from "@/lib/goldenChannelSync";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";

async function runSync(ownerId: string) {
  await bootstrapSecrets((message) => console.log(`[channel-pipeline-sync] ${message}`));
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");

  return syncChannelPipelines({
    convex: new StudioConvexHttpClient(url),
    ownerId,
    dryRun: true,
    log: (message) => console.log(`[channel-pipeline-sync] ${message}`),
  });
}

/**
 * Provider-free proposal task. Channel pipeline releases require separate
 * per-channel approval; this legacy fleet task cannot apply changes.
 */
export const syncChannelPipelinesTask = task({
  id: "sync-channel-pipelines",
  maxDuration: 300,
  run: async (payload: { ownerId?: string; dryRun?: boolean }) =>
    runSync(payload.ownerId ?? process.env.STUDIO_OWNER_ID ?? "owner_daniel"),
});
