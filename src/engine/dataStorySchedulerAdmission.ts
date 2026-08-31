/**
 * Pre-claim scheduler gate for Source-attributed Data Story.
 *
 * A reviewed evidence pack is intentionally not a normal content-plan item.
 * Until the owner has selected and bound one through the supervised workflow,
 * cadence must not lease a topic or dispatch a generic run that would later
 * fail at the provider-free reviewed-evidence admission boundary.
 */
import { assertPersistedProgramBriefIdentity } from "@/engine/channelProgramBrief";
import {
  assertChannelProgramRouteBinding,
  assertChannelProgramRoutePipelineCompatibility,
  channelProgramRouteRunSeed,
} from "@/engine/channelProgramRoute";
import {
  assertChannelShowProfilePipelineCompatibility,
  channelShowProfileFingerprint,
} from "@/engine/channelShowProfile";
import { resolveContentLane } from "@/engine/contentLane";
import {
  dataStoryProductionReadiness,
  hasSourceAttributedDataStoryParams,
} from "@/engine/dataStory";
import { requiresReviewedEvidencePackForSourceDataStory } from "@/engine/reviewedEvidenceRunAdmission";
import type { PipelineEntry } from "@/engine/types";

const SOURCE_ATTRIBUTED_DATA_STORY_CAPABILITY = "source_attributed_data_story";

export interface SourceDataStorySchedulerAdmissionInput {
  readonly identity?: unknown;
  readonly contentLane?: unknown;
  readonly family?: unknown;
  readonly pipeline?: unknown;
}

export interface SourceDataStorySchedulerAdmission {
  /** True only when ordinary scheduler cadence may continue for this channel. */
  readonly automatic: boolean;
  /** Human-readable reason retained in the scheduler log when cadence is skipped. */
  readonly reason: string;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/**
 * A malformed row that still claims this capability must fail closed as well.
 * Treating it as an ordinary channel would merely turn the next cadence tick
 * into a false plan failure. This marker never grants execution authority.
 */
function claimsSourceDataStory(input: SourceDataStorySchedulerAdmissionInput): boolean {
  const identity = object(input.identity);
  const showProfile = object(identity?.["showProfile"]);
  const selectedCapabilityKeys = showProfile?.["selectedCapabilityKeys"];
  if (
    Array.isArray(selectedCapabilityKeys) &&
    selectedCapabilityKeys.includes(SOURCE_ATTRIBUTED_DATA_STORY_CAPABILITY)
  ) {
    return true;
  }
  return Array.isArray(input.pipeline) && input.pipeline.some((entry) => {
    const record = object(entry);
    const params = object(record?.["params"]);
    return params !== undefined && hasSourceAttributedDataStoryParams(params);
  });
}

function manualReviewedEvidenceReason(detail?: string): string {
  const readiness = dataStoryProductionReadiness();
  return [
    "Source-attributed Data Story is supervised only: cadence cannot choose a topic or start a generic run.",
    "An owner-selected immutable reviewed evidence pack must bind this exact episode before any run begins.",
    ...readiness.blockers,
    ...(detail ? [detail] : []),
  ].join(" ");
}

/**
 * Revalidates the same sealed route/profile/capability identities that the
 * worker uses later. The false result is a skip, not an automatic admission.
 */
export function sourceDataStorySchedulerAdmission(
  input: SourceDataStorySchedulerAdmissionInput,
): SourceDataStorySchedulerAdmission {
  const readiness = dataStoryProductionReadiness();
  if (readiness.autonomous) {
    return { automatic: true, reason: "source-attributed data-story automatic admission is enabled" };
  }

  try {
    const programBrief = assertPersistedProgramBriefIdentity(input.identity, {
      context: "source-attributed data-story scheduler channel identity",
      requireProgramBrief: true,
    });
    if (!programBrief) throw new Error("canonical channel program brief is missing");
    const identity = object(input.identity);
    if (identity?.["programRoute"] === undefined) {
      throw new Error("sealed channel program route is missing");
    }
    if (identity["showProfile"] === undefined) {
      throw new Error("sealed channel Show Profile is missing");
    }
    if (!Array.isArray(input.pipeline)) {
      throw new Error("persisted channel pipeline is missing");
    }

    const pipeline = input.pipeline as PipelineEntry[];
    const route = assertChannelProgramRouteBinding({
      route: identity["programRoute"],
      programBrief,
    });
    assertChannelProgramRoutePipelineCompatibility({ route, programBrief, pipeline });
    const showProfile = assertChannelShowProfilePipelineCompatibility({
      profile: identity["showProfile"],
      programBrief,
      pipeline,
    });
    if (!showProfile.programRoute || showProfile.programRoute.fingerprint !== route.fingerprint) {
      throw new Error("sealed channel Show Profile does not match its Program Route");
    }
    const lane = resolveContentLane({
      stored: input.contentLane,
      family: input.family,
      pipeline,
    });
    if (lane.key !== route.contentLaneKey) {
      throw new Error("sealed channel Program Route does not match its content lane");
    }

    const requiresReviewedEvidence = requiresReviewedEvidencePackForSourceDataStory({
      route: channelProgramRouteRunSeed({ route, programBrief }),
      showProfileFingerprint: channelShowProfileFingerprint(showProfile),
      selectedCapabilityKeys: showProfile.selectedCapabilityKeys,
    });
    if (!requiresReviewedEvidence) {
      return { automatic: true, reason: "channel does not select source-attributed data story" };
    }
    return { automatic: false, reason: manualReviewedEvidenceReason() };
  } catch (error) {
    if (!claimsSourceDataStory(input)) {
      // The scheduler retains legacy ordinary-channel behavior unless the row
      // actually claims this supervised capability. The worker remains the
      // final provider-free validator for any malformed non-data-story row.
      return { automatic: true, reason: "channel does not claim source-attributed data story" };
    }
    const detail = error instanceof Error
      ? `The existing data-story route/profile seal could not be revalidated (${error.message}); repair it through the supervised workflow.`
      : "The existing data-story route/profile seal could not be revalidated; repair it through the supervised workflow.";
    return { automatic: false, reason: manualReviewedEvidenceReason(detail) };
  }
}
