export type FolderAwareChannel = {
  folder?: string | null;
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
