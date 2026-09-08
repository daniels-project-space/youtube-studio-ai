import { schedules } from "@trigger.dev/sdk";

import { dispatchAutomaticThumbnailReplacements } from "./automaticThumbnailReplacementCore";

/** Recovers completed candidates created before or between worker releases. */
export const automaticThumbnailReplacementDispatcher = schedules.task({
  id: "automatic-thumbnail-replacement-dispatcher",
  cron: "* * * * *",
  maxDuration: 120,
  run: async () => dispatchAutomaticThumbnailReplacements(),
});
