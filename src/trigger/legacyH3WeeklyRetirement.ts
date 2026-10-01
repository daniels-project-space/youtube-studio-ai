import { AbortTaskRunError } from "@trigger.dev/sdk";

/** Old task handles remain recognizable, but cannot admit provider work. */
export function rejectRetiredWeeklyH3Task(): never {
  throw new AbortTaskRunError(
    "Studio weekly H3 provider route is retired; stage the request through Render Engine.",
  );
}
