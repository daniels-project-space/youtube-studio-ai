import { task } from "@trigger.dev/sdk";
import { api } from "../../convex/_generated/api";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { assertAutomationModelAllowed, assertAutomationNarrationProviderAllowed } from "@/lib/automationModelPolicy";

/** Read-only local worker proof; it does not execute a pipeline or model. */
export const workshopRuntimeReadiness = task({
  id: "workshop-runtime-readiness",
  machine: "micro",
  maxDuration: 45,
  retry: { maxAttempts: 1 },
  run: async () => {
    if (process.env.YOUTUBE_STUDIO_WORKSHOP_PRIVATE !== "1" ||
        process.env.CONVEX_URL !== "http://172.30.240.1:39403" ||
        process.env.STUDIO_CONVEX_AUDIENCE !== "youtube-studio-workshop-vps" ||
        process.env.VAULT_ACCESS_TOKEN) throw new Error("Studio worker isolation is not configured");
    let proBlocked = false, otherVoiceBlocked = false;
    try { assertAutomationModelAllowed("gemini-3-pro-image"); } catch { proBlocked = true; }
    try { assertAutomationNarrationProviderAllowed("elevenlabs"); } catch { otherVoiceBlocked = true; }
    if (!proBlocked || !otherVoiceBlocked) throw new Error("Studio worker model restrictions are missing");
    const client = new StudioConvexHttpClient(process.env.CONVEX_URL);
    const drafts = await client.query(api.workshopPipelineDrafts.list, { ownerId: process.env.STUDIO_OWNER_ID ?? "" });
    return { ok: true, localDatabase: true, modelRestrictions: true, draftCount: drafts.length, providerJobsStarted: 0 };
  },
});
