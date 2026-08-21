/**
 * Heavy render child task (P1→P2 split).
 *
 * The memory-heavy local composites (timeline_assemble — large-1x OOMs on its
 * overlay+xfade pass — and documotion_short, which renders 1080p frames in a
 * pool and ffmpeg-composites the 9:16 master) run HERE on large-2x, dispatched
 * by run-pipeline through the engine's `remoteBlocks` hook. The run-pipeline
 * orchestrator runs every other block (LLM/TTS/footage/idle waits) on a cheaper
 * machine and SUSPENDS (unbilled) while this child renders — so it stops paying
 * the large-2x rate to sit idle waiting on external APIs (~50% of every run was
 * idle-billing).
 *
 * The OTHER two remote render blocks (novita_render_images / novita_render_video)
 * do their GPU work off-machine and are billed on the cheaper `render-block-light`
 * task instead — see ./render-block-light.ts. Routing for both lives in
 * `renderBlockMachineClass` (src/lib/pipelineInvocationSnapshot.ts) and the shared
 * body in ./renderBlockRunner.ts.
 *
 * That shared body rebuilds the engine store from the run's already-completed
 * upstream blocks (rehydrated from R2 onto THIS worker — footage via footageKeys,
 * intro via introCardKey, narration via narrationKey, etc.), runs the single
 * render block, and returns its patch. Isolating the render on its own 16GB
 * worker also cuts the overlay/xfade OOMs (SYSTEM_FAILURE) the shared monolith
 * was hitting.
 */
import { task } from "@trigger.dev/sdk/v3";
import { executeRenderBlock, type RenderBlockInput } from "@/trigger/renderBlockRunner";

export type { RenderBlockInput };

export const renderBlockTask = task({
  id: "render-block",
  machine: "large-2x",
  // Wall-clock ceiling for the render (matches the orchestrator's old budget).
  maxDuration: 5400,
  // OOM/crash retry — the render block re-runs cleanly (it re-reads its inputs).
  retry: { maxAttempts: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 30000, factor: 2 },
  run: async (payload: RenderBlockInput) =>
    executeRenderBlock(payload, { taskLabel: "render-block", machineClass: "heavy" }),
});
