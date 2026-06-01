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

/**
 * A finished-video row as returned by `videos.listVideos` (Tranche 4). Mirrors
 * the enrichment shape in convex/videos.ts so the Library UI is strongly typed.
 */
export type VideoRow = {
  _id: string;
  status: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  youtubeVideoId?: string;
  channelId: string;
  channelName: string;
  channelSlug: string;
  title: string;
  /** r2Key of the generated thumbnail asset; presign via /api/asset-url. */
  thumbnailKey: string | null;
  /** r2Key of the rendered video asset; lightbox <video> fallback. */
  videoKey: string | null;
  /** claude_flux thumbnail intelligence (surfaced in the lightbox). */
  thumbnailTitle?: string;
  visualRationale?: string;
  estimatedViews?: number;
  estimatedViewsSource?: string;
  durationSec?: number;
};
