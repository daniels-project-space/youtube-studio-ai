import { AbortTaskRunError } from "@trigger.dev/sdk/v3";
import {
  classifyExecutionError,
  type ExecutionErrorClassification,
} from "@/engine/executionErrors";

/**
 * Trigger should repeat a task only when the failure may change on another
 * worker. Deterministic input/configuration/provider failures are converted to
 * AbortTaskRunError so Trigger does not multiply cost after the engine's own
 * bounded recovery has already finished.
 */
export function taskErrorForRetryPolicy(error: unknown): {
  classification: ExecutionErrorClassification;
  error: unknown;
} {
  const classification = classifyExecutionError(error);
  return {
    classification,
    error:
      classification.kind === "deterministic"
        ? new AbortTaskRunError(classification.message)
        : error,
  };
}

export function throwForTaskRetryPolicy(error: unknown): never {
  throw taskErrorForRetryPolicy(error).error;
}
