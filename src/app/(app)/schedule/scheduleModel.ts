import {
  civilDateForTimestamp,
  civilDayKey,
  planReadiness,
  projectPlanSchedule,
  validTimeZone,
  type PlanReadiness,
} from "@/lib/scheduleCalendar";

export type PlanItem = {
  _id: string;
  channelId: string;
  channelName: string;
  channelSlug: string;
  cadence: string;
  order: number;
  topic: string;
  title?: string;
  thumbnailKey?: string;
  status: string;
  scheduledAt?: number;
  frequency?: string;
  days?: number[];
};

export type ChannelSchedule = {
  frequency: string;
  days?: number[];
  timezone?: string;
  localTime?: string;
  enabled?: boolean;
};

export type ChannelRow = {
  _id: string;
  name: string;
  slug: string;
  status: string;
  identity?: { cadence?: string; palette?: string[]; imageKey?: string };
  schedule?: ChannelSchedule;
};

export type PublishedVideo = {
  _id: string;
  title: string;
  channelId: string;
  youtubeVideoId: string;
  thumbnailKey?: string | null;
  publishedAt: number;
  publicationKind: "scheduled" | "public" | "unlisted";
};

export type CalendarEvent = {
  key: string;
  type: "planned" | "published";
  title: string;
  channelId: string;
  channel: string;
  slug?: string;
  color: string;
  date: Date;
  timestamp?: number;
  timeZone: string;
  youtubeVideoId?: string;
  thumbnailKey?: string | null;
  status?: string;
  readiness: PlanReadiness | "published";
  id?: string;
  pinned?: boolean;
  usesScheduleDefaults?: boolean;
};

export type CalendarModel = {
  byDay: Map<string, CalendarEvent[]>;
  flat: CalendarEvent[];
  excluded: CalendarExclusions;
};

export type CalendarExclusions = {
  orphan: number;
  inactive: number;
  disabled: number;
  total: number;
  labels: string[];
};

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const CHANNEL_COLORS = [
  "#f0ae73", "#70d6c5", "#8ab4f8", "#c4b5fd",
  "#f9a8d4", "#f6cf65", "#86dca0", "#f69a9a",
  "#67d8e8", "#d7a2f2", "#9cc76b", "#e4a5c7",
  "#79b8ff", "#e8c17c", "#9ad0ba", "#b8a9ef",
];

const DAY_MS = 86_400_000;

/**
 * UTC ledger window covering the civil dates in a calendar grid for every IANA
 * time zone. One day of padding on each side covers the full UTC−12…UTC+14
 * offset range without reading unrelated months.
 */
export function publishedTimestampRange(cells: Date[]): { startAt: number; endAt: number } {
  if (cells.length === 0) throw new Error("calendar cells are required");
  const first = cells[0];
  const last = cells[cells.length - 1];
  const firstUtc = Date.UTC(first.getFullYear(), first.getMonth(), first.getDate());
  const afterLastUtc = Date.UTC(last.getFullYear(), last.getMonth(), last.getDate() + 1);
  return { startAt: firstUtc - DAY_MS, endAt: afterLastUtc + DAY_MS };
}

const STATUS_LABEL: Record<PlanReadiness | "published", string> = {
  ready: "Ready",
  building: "Building",
  attention: "Needs attention",
  queued: "Queued",
  published: "Published",
};

export function channelHref(
  slug?: string,
  tab?: "week-ahead" | "settings",
  planId?: string,
) {
  if (!slug) return "/channels";
  const base = `/channels/${encodeURIComponent(slug)}`;
  const query = new URLSearchParams();
  if (tab) query.set("tab", tab);
  if (planId) query.set("plan", planId);
  const search = query.size ? `?${query.toString()}` : "";
  const hash = planId ? `#plan-${encodeURIComponent(planId)}` : "";
  return `${base}${search}${hash}`;
}

export function frequencyLabel(frequency: string) {
  if (frequency === "daily") return "Daily";
  if (frequency === "biweekly") return "Every 2 weeks";
  if (frequency === "monthly") return "Monthly";
  return "Weekly";
}

export function eventStatusLabel(event: CalendarEvent) {
  if (event.type === "published") return event.status === "scheduled" ? "Scheduled" : "Published";
  if (event.status === "failed") return "Failed";
  if (event.status === "ready" && event.readiness === "attention") return "Missing thumbnail";
  return STATUS_LABEL[event.readiness];
}

export function buildChannelColors(channels: ChannelRow[]): Map<string, string> {
  const colors = new Map<string, string>();
  [...channels]
    .sort((a, b) => a._id.localeCompare(b._id))
    .forEach((channel, index) => colors.set(channel._id, CHANNEL_COLORS[index % CHANNEL_COLORS.length]));
  return colors;
}

export function buildCalendarModel({
  plan,
  publishedVideos,
  channelById,
  channelColors,
  scope,
  todayMs,
}: {
  plan: PlanItem[];
  publishedVideos: PublishedVideo[];
  channelById: Map<string, ChannelRow>;
  channelColors: Map<string, string>;
  scope: string;
  todayMs: number;
}): CalendarModel {
  const byDay = new Map<string, CalendarEvent[]>();
  const flat: CalendarEvent[] = [];
  const excludedCounts = { orphan: 0, inactive: 0, disabled: 0 };
  const add = (event: CalendarEvent) => {
    const key = civilDayKey(event.date);
    const existing = byDay.get(key) ?? [];
    existing.push(event);
    byDay.set(key, existing);
    flat.push(event);
  };

  const plansByChannel = new Map<string, PlanItem[]>();
  for (const item of plan) {
    if (scope !== "all" && item.channelId !== scope) continue;
    const channel = channelById.get(item.channelId);
    if (!channel) {
      excludedCounts.orphan += 1;
      continue;
    }
    if (channel.status !== "active") {
      excludedCounts.inactive += 1;
      continue;
    }
    const isPinned = item.scheduledAt !== undefined && Number.isFinite(item.scheduledAt);
    if (channel.schedule?.enabled === false && !isPinned) {
      excludedCounts.disabled += 1;
      continue;
    }
    const items = plansByChannel.get(item.channelId) ?? [];
    items.push(item);
    plansByChannel.set(item.channelId, items);
  }

  for (const [channelId, items] of plansByChannel) {
    const channel = channelById.get(channelId);
    const projections = projectPlanSchedule({
      items,
      schedule: channel?.schedule,
      cadence: items[0]?.frequency ?? items[0]?.cadence,
      fromTimestamp: todayMs,
    });

    projections.forEach((projection) => {
      const { item, date, timestamp, timeZone, pinned, usesScheduleDefaults } = projection;
      add({
        key: `plan:${item._id}`,
        type: "planned",
        title: item.title || item.topic,
        channelId,
        channel: channel?.name ?? item.channelName,
        slug: channel?.slug ?? item.channelSlug,
        color: channelColors.get(channelId) ?? CHANNEL_COLORS[0],
        date,
        timestamp,
        timeZone,
        thumbnailKey: item.thumbnailKey,
        status: item.status,
        readiness: planReadiness(item.status, item.thumbnailKey),
        id: item._id,
        pinned,
        usesScheduleDefaults,
      });
    });
  }

  for (const video of publishedVideos) {
    if (scope !== "all" && video.channelId !== scope) continue;
    const channel = channelById.get(video.channelId);
    const timeZone = validTimeZone(channel?.schedule?.timezone);
    const date = civilDateForTimestamp(video.publishedAt, timeZone);
    if (!date) continue;
    add({
      key: `video:${video._id}`,
      type: "published",
      title: video.title,
      channelId: video.channelId,
      channel: channel?.name ?? "(unknown)",
      slug: channel?.slug,
      color: channelColors.get(video.channelId) ?? "var(--color-ok)",
      date,
      timestamp: video.publishedAt,
      timeZone,
      youtubeVideoId: video.youtubeVideoId,
      thumbnailKey: video.thumbnailKey,
      status:
        video.publicationKind === "scheduled" && video.publishedAt > todayMs
          ? "scheduled"
          : "published",
      readiness: "published",
    });
  }

  for (const events of byDay.values()) {
    events.sort((a, b) => Number(a.type === "published") - Number(b.type === "published"));
  }
  const total = excludedCounts.orphan + excludedCounts.inactive + excludedCounts.disabled;
  const labels = [
    excludedCounts.orphan ? `${excludedCounts.orphan} deleted-channel item${excludedCounts.orphan === 1 ? "" : "s"}` : null,
    excludedCounts.inactive ? `${excludedCounts.inactive} paused/draft item${excludedCounts.inactive === 1 ? "" : "s"}` : null,
    excludedCounts.disabled ? `${excludedCounts.disabled} scheduler-disabled item${excludedCounts.disabled === 1 ? "" : "s"}` : null,
  ].filter((label): label is string => Boolean(label));
  return {
    byDay,
    flat,
    excluded: { ...excludedCounts, total, labels },
  };
}
