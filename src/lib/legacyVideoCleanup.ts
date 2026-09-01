export const LEGACY_VIDEO_RETIREMENT_REASONS = [
  "failed_run_uploaded",
  "channel_identity_mismatch",
  "unqualified_family_legacy",
] as const;

export type LegacyVideoRetirementReason =
  (typeof LEGACY_VIDEO_RETIREMENT_REASONS)[number];

export type LegacyVideoCleanupAssessment = Readonly<
  | {
      action: "keep";
      reason: "no_youtube_video" | "retained_channel_content";
      explanation: string;
    }
  | {
      action: "retire";
      reason: LegacyVideoRetirementReason;
      explanation: string;
    }
>;

function hasLofiIdentity(title: string): boolean {
  return /\b(?:lo[\s-]?fi|lofi)\b/i.test(title);
}

/**
 * Selects only the narrow legacy cases Daniel explicitly asked to remove.
 * It does not infer quality from age, views, or a missing thumbnail, and it
 * never turns an ordinary retained master into a deletion candidate.
 */
export function assessLegacyVideoCleanup(input: {
  youtubeVideoId?: string | null;
  runStatus: string;
  title: string;
  channelFamily?: string;
  releaseEvidenceStatus?: string;
}): LegacyVideoCleanupAssessment {
  if (!input.youtubeVideoId?.trim()) {
    return {
      action: "keep",
      reason: "no_youtube_video",
      explanation: "No YouTube video is bound to this run.",
    };
  }
  if (input.runStatus === "failed") {
    return {
      action: "retire",
      reason: "failed_run_uploaded",
      explanation: "A failed pipeline run left a YouTube upload behind.",
    };
  }
  if (input.channelFamily !== "music_loop" && hasLofiIdentity(input.title)) {
    return {
      action: "retire",
      reason: "channel_identity_mismatch",
      explanation: "The video is LoFi content on a channel with a different identity.",
    };
  }
  if (
    input.channelFamily === "music_loop" &&
    input.releaseEvidenceStatus !== "release_evidence_recorded"
  ) {
    return {
      action: "retire",
      reason: "unqualified_family_legacy",
      explanation: "This legacy LoFi upload predates a qualified music-loop release.",
    };
  }
  return {
    action: "keep",
    reason: "retained_channel_content",
    explanation: "The video remains part of the channel's retained content.",
  };
}
