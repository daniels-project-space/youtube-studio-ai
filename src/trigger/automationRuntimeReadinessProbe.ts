import { task } from "@trigger.dev/sdk";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { resolveHyperYoutubeProject } from "@/lib/hyperYoutubeProject";
import { assertAutomationModelAllowed, assertAutomationNarrationProviderAllowed } from "@/lib/automationModelPolicy";

/** Read-only preflight: no model job, GPU operation or media generation. */
export const automationRuntimeReadinessProbe = task({
  id: "automation-runtime-readiness-probe",
  machine: "micro",
  maxDuration: 45,
  retry: { maxAttempts: 1 },
  run: async () => {
    if (process.env.YOUTUBE_AUTOMATION_PRIVATE !== "1") throw new Error("Private Automation mode is not active");
    await bootstrapSecrets(() => {}, { services: ["cloudflare"], required: ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] });
    const binding = await resolveHyperYoutubeProject();
    if (binding.outputBucket !== "youtube-automation") throw new Error("Render project does not target the Automation bucket");
    let proBlocked = false;
    try { assertAutomationModelAllowed("gemini-3-pro-image"); }
    catch (error) { if (error instanceof Error && error.message.includes("Nano Banana Pro is disabled")) proBlocked = true; else throw error; }
    if (!proBlocked) throw new Error("Nano Banana Pro is not blocked");
    let elevenBlocked = false;
    try { assertAutomationNarrationProviderAllowed("elevenlabs"); }
    catch (error) { if (error instanceof Error && error.message.includes("requires an explicitly selected Qwen")) elevenBlocked = true; else throw error; }
    if (!elevenBlocked) throw new Error("Non-Qwen narration is not blocked");
    assertAutomationNarrationProviderAllowed("qwen3");
    return { ok: true, scopedStorageReady: true, isolatedRenderProjectBound: true, nanoBananaProBlocked: true, nonQwenNarrationBlocked: true, submittedJobs: 0 };
  },
});
