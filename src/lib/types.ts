/**
 * Shared client view types. These mirror the shapes returned by the Convex
 * read queries (listRecent / listActive enrichment, listChannels rows) so
 * components can be strongly typed without importing server internals.
 */
export type RunRow = {
  _id: string;
  status: string;
  startedAt?: number;
  finishedAt?: number;
  costTotal: number;
  youtubeVideoId?: string;
  error?: string;
  channelName: string;
  channelSlug: string;
};

export type ChannelRow = {
  _id: string;
  name: string;
  slug: string;
  status: string;
  template: string;
  budget: number;
};
