import { taskContext } from "@trigger.dev/core/v3";
import { wait } from "@trigger.dev/sdk/v3";

export interface NovitaRenderPollWaitRequest {
  milliseconds: number;
  idempotencyKey: string;
}

export type NovitaRenderPollWait = (request: NovitaRenderPollWaitRequest) => Promise<void>;

interface NovitaRenderPollWaitDependencies {
  isInsideTriggerTask: () => boolean;
  checkpointWait: (options: { seconds: number; idempotencyKey: string }) => Promise<void>;
  sleep: (milliseconds: number) => Promise<void>;
}

/**
 * Route long render polling delays through Trigger waitpoints when a task is
 * executing. Trigger checkpoints waits longer than five seconds, so the task
 * does not keep a billed worker alive while the external GPU job is running.
 * Plain Node callers retain an ordinary timer, and tests can inject both paths.
 */
export function createNovitaRenderPollWait(
  dependencies: NovitaRenderPollWaitDependencies,
): NovitaRenderPollWait {
  return async ({ milliseconds, idempotencyKey }) => {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
      throw new Error("novitaRenderFarm: poll wait must be a positive finite duration");
    }
    if (dependencies.isInsideTriggerTask()) {
      await dependencies.checkpointWait({
        // The production backoff starts at 30s. Keep a >5s floor here so even
        // a future/test override cannot accidentally turn this into billed wait.
        seconds: Math.max(6, milliseconds / 1_000),
        idempotencyKey,
      });
      return;
    }
    await dependencies.sleep(milliseconds);
  };
}

export const waitForNovitaRenderPoll = createNovitaRenderPollWait({
  isInsideTriggerTask: () => taskContext.isInsideTask,
  checkpointWait: (options) => wait.for(options),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
});
