import { setTimeout as wait } from "node:timers/promises";
import { classifyExecutionError, executionRetryDelayMs, ExecutionError } from "@/engine/executionErrors";
import { putObjectFromFile, type PutOptions } from "./storage";

/** Retry only a completed file's idempotent upload, never its paid producer. */
export async function persistRenderedFile(
  key: string,
  path: string,
  options: Omit<PutOptions, "ifNoneMatch"> = {},
  controls: {
    beforeAttempt?: () => void | Promise<void>;
    /** Test clock only; production callers use the bounded backoff below. */
    wait?: (milliseconds: number) => Promise<unknown>;
  } = {},
): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    // A changed execution/review authority is not a storage retry signal.
    await controls.beforeAttempt?.();
    try {
      return await putObjectFromFile(key, path, options);
    } catch (error) {
      const classification = classifyExecutionError(error);
      if (!classification.retryable || attempt === 3) {
        throw Object.assign(new ExecutionError(
          `Completed render upload failed after ${attempt} storage attempt(s): ${classification.message}`,
          { code: "RENDERED_FILE_PERSISTENCE_FAILED", retryable: false },
        ), { cause: error });
      }
      await (controls.wait ?? wait)(executionRetryDelayMs(classification, attempt));
    }
  }
  throw new Error("Completed render persistence exhausted its bounded attempts");
}
