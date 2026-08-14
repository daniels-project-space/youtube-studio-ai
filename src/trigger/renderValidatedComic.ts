/**
 * Retired standalone proof renderer.
 *
 * It previously called the production motion-comic image renderer directly,
 * outside an authenticated compiler reservation and signed provider lifecycle.
 * Keep the task id registered so queued legacy invocations fail explicitly,
 * but make it a zero-spend terminal path. Use the admitted channel pipeline
 * and its held-out render gate for any new proof instead.
 */
import { task } from "@trigger.dev/sdk";

export interface RenderValidatedComicInput {
  /** Retained for deterministic failure messages on already-queued invocations. */
  runId?: string;
  topic?: string;
  facts?: string;
}

const RETIRED_REASON =
  "render-validated-comic is retired: standalone paid rendering has no signed compiler reservation or provider lifecycle. Run an admitted channel pipeline proof instead.";

export const renderValidatedComicTask = task({
  id: "render-validated-comic",
  machine: "large-2x",
  maxDuration: 1800,
  retry: { maxAttempts: 1 },
  run: async (_input: RenderValidatedComicInput) => {
    throw new Error(RETIRED_REASON);
  },
});
