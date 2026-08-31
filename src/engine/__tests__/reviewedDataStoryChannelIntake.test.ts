import assert from "node:assert/strict";

import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import {
  creativeCapabilitySelection,
  validateCreativeCapabilitySelections,
} from "@/engine/creative/creativeCapabilityCatalog";
import { briefToCreativeCapabilityIntent } from "@/engine/channelProgramBrief";
import {
  assertReviewedDataStoryChannelIntake,
  REVIEWED_DATA_STORY_CHANNEL_INTAKE_MODE,
} from "@/engine/reviewedDataStoryChannelIntake";

const brief = createChannelProgramBrief({
  family: "narrated_stock",
  nicheKey: "educational",
  locale: "en",
  concept: "Source-attributed data storytelling that turns reviewed public data into a clear visual story.",
});
const selections = validateCreativeCapabilitySelections({
  family: brief.family,
  selections: [creativeCapabilitySelection("source_attributed_data_story")],
  intent: briefToCreativeCapabilityIntent(brief),
});

const valid = {
  mode: REVIEWED_DATA_STORY_CHANNEL_INTAKE_MODE,
  programBrief: brief,
  selections,
} as const;

assert.doesNotThrow(() => assertReviewedDataStoryChannelIntake(valid));
assert.throws(
  () => assertReviewedDataStoryChannelIntake({ ...valid, mode: true }),
  /exact mode/i,
  "a normal automatic request cannot take the supervised bypass",
);
assert.throws(
  () => assertReviewedDataStoryChannelIntake({ ...valid, autoYoutube: true }),
  /cannot authorize/i,
  "intake creates no external YouTube action",
);
assert.throws(
  () => assertReviewedDataStoryChannelIntake({ ...valid, claimEvidence: [{ claim: "unreviewed" }] }),
  /immutable reviewed-ledger desk/i,
  "factual material cannot hitchhike on the channel shell",
);
assert.throws(
  () => assertReviewedDataStoryChannelIntake({ ...valid, selections: [] }),
  /requires exactly/i,
  "a generic narrated-stock channel cannot use the supervised bypass",
);

console.log("Reviewed data-story channel-intake tests passed");
