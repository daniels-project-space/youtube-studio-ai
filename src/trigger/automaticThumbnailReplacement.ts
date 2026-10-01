import { task } from "@trigger.dev/sdk";

import { dispatchAutomaticThumbnailReplacements } from "./automaticThumbnailReplacementCore";

/** Recovers completed candidates created before or between worker releases. */
export const automaticThumbnailReplacementDispatcher = task({
  id: "automatic-thumbnail-replacement-dispatcher",
  maxDuration: 120,
  run: async () => dispatchAutomaticThumbnailReplacements(),
});
