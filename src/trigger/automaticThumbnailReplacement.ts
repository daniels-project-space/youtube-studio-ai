import { schedules } from "@trigger.dev/sdk";

import { dispatchAutomaticThumbnailReplacements } from "./automaticThumbnailReplacementCore";

/** Recovers completed candidates created before or between worker releases. */
export const automaticThumbnailReplacementDispatcher = schedules.task({
  id: "automatic-thumbnail-replacement-dispatcher",
  // Production cadence is frozen; see docs/trigger-schedule-freeze-20260927.md.
  maxDuration: 120,
  run: async () => dispatchAutomaticThumbnailReplacements(),
});
