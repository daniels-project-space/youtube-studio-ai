export type FolderAwareChannel = {
  folder?: string | null;
};

export const CHANNEL_PAGE_SIZE = 8;

export type ChannelPage<T> = {
  visible: T[];
  total: number;
  remaining: number;
  nextBatchSize: number;
};

/**
 * A null folder is the unfiltered fleet view. Folder chips are filters, not
 * containers that are allowed to make channels disappear from the landing
 * page.
 */
export function channelsVisibleForFolder<T extends FolderAwareChannel>(
  channels: readonly T[],
  openFolder: string | null,
): T[] {
  if (openFolder === null) return [...channels];
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
