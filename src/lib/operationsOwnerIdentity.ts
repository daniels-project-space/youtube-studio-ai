type KnownYouTubeIdentity = {
  ytChannelId?: string | null;
  status?: string | null;
};

function configuredOwnerChannelIds(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Owner verification accepts only a YouTube channel already bound to this
 * studio: an active connector, a recorded created destination, a channel that
 * owns a retained published video, or an explicit deployment allowlist entry.
 */
export function isKnownOperationsOwnerChannel(args: {
  selectedChannelId: string | null | undefined;
  connectors: KnownYouTubeIdentity[];
  createdDestinations: KnownYouTubeIdentity[];
  publishedVideoChannelIds: string[];
  configuredChannelIds?: string;
}): boolean {
  const selected = args.selectedChannelId?.trim();
  if (!selected) return false;
  const admitted = new Set([
    ...configuredOwnerChannelIds(args.configuredChannelIds),
    ...args.connectors
      .filter((connector) => connector.status === "active")
      .flatMap((connector) => connector.ytChannelId ? [connector.ytChannelId] : []),
    ...args.createdDestinations.flatMap((channel) => channel.ytChannelId ? [channel.ytChannelId] : []),
    ...args.publishedVideoChannelIds,
  ]);
  return admitted.has(selected);
}
