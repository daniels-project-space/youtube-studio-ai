export interface YoutubeChannelCreationApproval {
  autoYoutube?: boolean;
  youtubeCreationActor?: string;
  youtubeCreationEvidence?: string;
}

/**
 * YouTube account/channel creation is an external, consequential action. It is
 * never inferred from omission: the dedicated wizard toggle and authenticated
 * creation evidence installed by the server route must both be present.
 */
export function isYoutubeChannelCreationApproved(
  approval: YoutubeChannelCreationApproval,
): boolean {
  return approval.autoYoutube === true &&
    approval.youtubeCreationActor?.trim().startsWith("authenticated-operator:") === true &&
    Boolean(approval.youtubeCreationEvidence?.trim());
}
