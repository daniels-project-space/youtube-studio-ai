import { task } from "@trigger.dev/sdk";

import { admitStudioBatchToRenderEngine } from "@/lib/renderEngineStudioBatchAdmission";

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) {
    throw new Error(`Render Engine Studio ${label} is invalid`);
  }
  return value;
}

/** Manual-only frozen-batch handoff. It cannot schedule a provider or publish a video. */
export const renderEngineStudioBatchAdmissionTask = task({
  id: "render-engine-studio-batch-admission",
  maxDuration: 60,
  retry: { maxAttempts: 1 },
  queue: { concurrencyLimit: 1 },
  run: async (payload: { ownerId: string; batchId: string }) => {
    const admission = await admitStudioBatchToRenderEngine({
      ownerId: identifier(payload.ownerId, "owner ID"),
      batchId: identifier(payload.batchId, "batch ID"),
    });
    return { ...admission, gpuScheduled: false, publishingScheduled: false };
  },
});
