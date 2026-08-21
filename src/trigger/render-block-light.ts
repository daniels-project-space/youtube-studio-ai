/**
 * Offloaded render child task (cost pass, Aug 2026).
 *
 * Sibling of ./render-block.ts. Same body (./renderBlockRunner.ts), different
 * machine tier — because `novita_render_images` and `novita_render_video` do
 * NOT composite media on this worker. They submit to the Novita RTX 4090 fleet
 * and then checkpoint-wait via `wait.for()` (src/lib/novitaPollWait.ts), which
 * suspends the task unbilled while the GPU renders off-machine. The billed
 * local work is job submission, manifest/schema validation, and QA sampling —
 * one ffprobe plus three single-frame grabs per shot.
 *
 * Machine: `medium-1x` (1 vCPU / 2GB) rather than large-2x (8 vCPU / 16GB).
 * Deliberately NOT the `small-1x`/`micro` tier the pure-orchestration probes
 * (convex-auth-probe, verify-mastra, browser-automation-probe) use: those never
 * touch media, whereas this path buffers a clip through `getObjectBytes` and
 * decodes frames with ffmpeg. medium-1x keeps real headroom over that working
 * set while still cutting the per-second rate substantially versus large-2x.
 *
 * `maxDuration` and `retry` are intentionally left identical to render-block.
 * The wall clock here is dominated by the external GPU queue, not by local
 * compute, so a shorter ceiling would only add a new way for a slow-but-healthy
 * fleet render to fail.
 */
import { task } from "@trigger.dev/sdk/v3";
import { executeRenderBlock, type RenderBlockInput } from "@/trigger/renderBlockRunner";

export const renderBlockLightTask = task({
  id: "render-block-light",
  machine: "medium-1x",
  maxDuration: 5400,
  retry: { maxAttempts: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 30000, factor: 2 },
  run: async (payload: RenderBlockInput) =>
    executeRenderBlock(payload, { taskLabel: "render-block-light", machineClass: "offloaded" }),
});
