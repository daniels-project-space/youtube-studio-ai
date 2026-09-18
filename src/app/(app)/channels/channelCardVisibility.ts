export type FolderAwareChannel = {
  folder?: string | null;
};

export const CHANNEL_PAGE_SIZE = 8;

/** A room member belongs to that room, never the standalone fleet as well. */
export function isMainFleetChannel(channel: FolderAwareChannel): boolean {
  return !channel.folder?.trim();
}

export type ChannelPage<T> = {
  visible: T[];
  total: number;
  remaining: number;
  nextBatchSize: number;
};

/**
 * A null folder is the standalone fleet view. Folder membership is the single
 * source of truth: legacy `groupId` metadata may be absent, stale, or belong
 * to a different organizational feature, and must never duplicate a room
 * member in the main fleet. An explicit room selection always exposes its real
 * members.
 */
export function channelsVisibleForFolder<T extends FolderAwareChannel>(
  channels: readonly T[],
  openFolder: string | null,
): T[] {
  if (openFolder === null) return channels.filter(isMainFleetChannel);
  return channels.filter((channel) => channel.folder === openFolder);
}

/** Two desktop rows are enough for fleet scanning; every remaining card stays reachable. */
export function pageChannels<T>(channels: readonly T[], requestedLimit?: number): ChannelPage<T> {
  const limit = Math.max(
    CHANNEL_PAGE_SIZE,
    Number.isFinite(requestedLimit) ? Math.floor(requestedLimit as number) : CHANNEL_PAGE_SIZE,
  );
  const visible = channels.slice(0, limit);
  const remaining = Math.max(0, channels.length - visible.length);

  return {
    visible,
    total: channels.length,
    remaining,
    nextBatchSize: Math.min(CHANNEL_PAGE_SIZE, remaining),
  };
}
