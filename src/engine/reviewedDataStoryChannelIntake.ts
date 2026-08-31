import type { ChannelProgramBrief } from "@/engine/channelProgramBrief";
import type { ResolvedCreativeCapabilitySelection } from "@/engine/creative/creativeCapabilityCatalog";

/**
 * A channel shell for source-attributed work is intentionally not an
 * automatic channel. It exists solely so an owner can attach one immutable,
 * reviewed source ledger and begin one review-paused episode later.
 *
 * Keep this separate from the automatic creator: accepting the same design
 * inputs must never accidentally authorize research, setup spending, a probe,
 * YouTube creation, or publication.
 */
export const REVIEWED_DATA_STORY_CHANNEL_INTAKE_MODE = "reviewed_data_story_intake/v1" as const;

export interface ReviewedDataStoryChannelIntakeInput {
  readonly mode: unknown;
  readonly programBrief: ChannelProgramBrief;
  readonly selections: readonly ResolvedCreativeCapabilitySelection[];
  readonly publishMode?: unknown;
  readonly approvedForPublish?: unknown;
  readonly approveSetupSpend?: unknown;
  readonly runProbe?: unknown;
  readonly autoYoutube?: unknown;
  /** Raw factual evidence belongs to the later immutable reviewed pack. */
  readonly dataStory?: unknown;
  readonly sourceReferences?: unknown;
  readonly claimEvidence?: unknown;
}

export function isReviewedDataStoryChannelIntakeMode(value: unknown): value is typeof REVIEWED_DATA_STORY_CHANNEL_INTAKE_MODE {
  return value === REVIEWED_DATA_STORY_CHANNEL_INTAKE_MODE;
}

export function assertReviewedDataStoryChannelIntake(
  input: ReviewedDataStoryChannelIntakeInput,
): void {
  if (!isReviewedDataStoryChannelIntakeMode(input.mode)) {
    throw new Error("reviewed data-story channel intake requires its exact mode");
  }
  if (input.programBrief.family !== "narrated_stock") {
    throw new Error("reviewed data-story channel intake is available only for Narrated + Stock Footage");
  }
  if (
    input.selections.length !== 1 ||
    input.selections[0]?.selection.capability !== "source_attributed_data_story"
  ) {
    throw new Error("reviewed data-story channel intake requires exactly the source-attributed data-story capability");
  }
  if (input.publishMode !== undefined && input.publishMode !== "draft") {
    throw new Error("reviewed data-story channel intake is draft-only");
  }
  if (
    input.approvedForPublish === true ||
    input.approveSetupSpend === true ||
    input.runProbe === true ||
    input.autoYoutube === true
  ) {
    throw new Error("reviewed data-story channel intake cannot authorize setup, rendering, YouTube creation, or publication");
  }
  if (
    input.dataStory !== undefined ||
    input.sourceReferences !== undefined ||
    input.claimEvidence !== undefined
  ) {
    throw new Error("reviewed data-story source material must be submitted only through the immutable reviewed-ledger desk");
  }
}
