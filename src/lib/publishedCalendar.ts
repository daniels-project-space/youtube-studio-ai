export type CalendarPublicationKind = "scheduled" | "public" | "unlisted";

export type PublishedCalendarItem = {
  _id: string;
  channelId: string;
  title: string;
  youtubeVideoId: string;
  thumbnailKey: string | null;
  publishedAt: number;
  publicationKind: CalendarPublicationKind;
};

export type PublishLedgerCalendarRow = {
  _id: string;
  channelId: string;
  title: string;
  status: string;
  privacyStatus: "private" | "public" | "unlisted";
  publishAt?: number;
  completedAt?: number;
  youtubeVideoId?: string;
  thumbnailArtifactKey?: string;
};

/**
 * Converts the durable YouTube upload ledger into one truthful calendar row.
 * Native schedules use their exact public timestamp; immediate public/unlisted
 * uploads use durable completion time. Private drafts are intentionally absent.
 */
export function publishedCalendarItem(
  row: PublishLedgerCalendarRow,
): PublishedCalendarItem | null {
  const youtubeVideoId = row.youtubeVideoId?.trim();
  if (row.status !== "uploaded" || !youtubeVideoId) return null;

  const scheduledAt = Number.isFinite(row.publishAt) ? row.publishAt : undefined;
  const uploadedAt = Number.isFinite(row.completedAt) ? row.completedAt : undefined;
  if (scheduledAt === undefined && row.privacyStatus === "private") return null;

  const publishedAt = scheduledAt ?? uploadedAt;
  if (publishedAt === undefined) return null;
  const publicationKind: CalendarPublicationKind = scheduledAt !== undefined
    ? "scheduled"
    : row.privacyStatus === "public"
      ? "public"
      : "unlisted";

  return {
    _id: row._id,
    channelId: row.channelId,
    title: row.title.trim() || "Untitled video",
    youtubeVideoId,
    thumbnailKey: row.thumbnailArtifactKey?.trim() || null,
    publishedAt,
    publicationKind,
  };
}
